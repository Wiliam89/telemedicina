/**
 * =====================================================================
 * TESTES DA LGPD (ADR-0018) - CONTRA O POSTGRES
 * =====================================================================
 *
 *   - consentimento: pendente ate aceitar a versao atual; revogar volta a
 *     pendente; o registro nao se reescreve
 *   - acesso: o titular baixa os proprios dados e ve quem acessou o prontuario
 *   - pedidos: vao para a clinica certa, com prazo; so ela responde, e uma vez
 *   - correcao do cadastro
 *
 * Precisa de DATABASE_URL; sem ele os testes sao pulados.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBanco } from "@tele/db";
import { ArmazenamentoEmMemoriaDeAnexos } from "./anexos/armazenamento.js";
import type { Ambiente } from "./ambiente.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);

const AMBIENTE = {
  NODE_ENV: "test" as const,
  PORT: 3995,
  SUPABASE_URL: "https://exemplo.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_1234567890abcdefghijklmnop",
  DATABASE_URL: DATABASE_URL ?? "postgresql://nao/usado",
  ORIGEM_PERMITIDA: "http://localhost:3000",
  ASSINATURA_PROVEDOR: "local_teste" as const,
  PERMITIR_ASSINATURA_SEM_VALOR_LEGAL: false,
  VIDEO_PROVEDOR: "local_teste" as const,
  PERMITIR_VIDEO_SIMULADO: false,
  EMAIL_PROVEDOR: "console" as const,
  NOME_PLATAFORMA: "Teste",
  DB_POOL_MAX: 3,
  LIMITE_POR_MINUTO: 10000,
} satisfies Ambiente;

const paciente = randomUUID();
const medico = randomUUID();
const admin = randomUUID();
const adminDeOutra = randomUUID();
const clinicaId = randomUUID();
const outraClinicaId = randomUUID();
const slug = `teste-lgpd-${Date.now()}`;
const outroSlug = `teste-lgpd-outra-${Date.now()}`;
const pessoas: string[] = [paciente, medico, admin, adminDeOutra];
const autenticarFalso = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let banco: ReturnType<typeof criarBanco>;
const chamar = (quem: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, clinica?: string) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${quem}`, ...(clinica ? { "x-clinica": clinica } : {}) }, ...(payload === undefined ? {} : { payload: payload as object }) });

beforeAll(async () => {
  if (!temBanco) return;
  banco = criarBanco(DATABASE_URL!);
  const sql = banco.$client;
  for (const id of pessoas) await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
  await sql`insert into perfis (id, nome_completo) values (${paciente}, 'Titular Teste'), (${medico}, 'Dra. Leitora'), (${admin}, 'Admin LGPD'), (${adminDeOutra}, 'Admin Outra')`;
  await sql`insert into medicos (perfil_id, crm, crm_uf) values (${medico}, '999001', 'SP')`;
  await sql`insert into pacientes (perfil_id, data_nascimento) values (${paciente}, '1991-03-03')`;
  const cnpj = (n: number) => String(Date.now() + n).slice(-14).padStart(14, "4");
  await sql`insert into clinicas (id, slug, nome_fantasia, razao_social, cnpj, status, fuso_horario) values
    (${clinicaId}, ${slug}, 'Clinica LGPD', 'Clinica LGPD LTDA', ${cnpj(1)}, 'ativa', 'America/Sao_Paulo'),
    (${outraClinicaId}, ${outroSlug}, 'Outra Clinica', 'Outra LTDA', ${cnpj(2)}, 'ativa', 'America/Sao_Paulo')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel, status) values
    (${paciente}, ${clinicaId}, 'paciente', 'ativo'), (${medico}, ${clinicaId}, 'medico', 'ativo'),
    (${admin}, ${clinicaId}, 'admin_clinica', 'ativo'), (${adminDeOutra}, ${outraClinicaId}, 'admin_clinica', 'ativo')`;
  const ontem = new Date(Date.now() - 86400000).toISOString();
  const fim = new Date(Date.now() - 84600000).toISOString();
  await sql`insert into consultas (clinica_id, paciente_id, medico_id, inicio, fim, status) values (${clinicaId}, ${paciente}, ${medico}, ${ontem}, ${fim}, 'concluida')`;
  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar: autenticarFalso, provedorDeVideo: new ProvedorLocalDeVideo(), armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos() }));
});

afterAll(async () => {
  if (!temBanco) return;
  const sql = banco.$client;
  const ids = [clinicaId, outraClinicaId];
  await sql`delete from solicitacoes_titular where perfil_id in ${sql(pessoas)}`;
  await sql`delete from auditoria where clinica_id in ${sql(ids)} or quem in ${sql(pessoas)}`;
  await sql`delete from consultas where clinica_id in ${sql(ids)}`;
  await sql`delete from vinculos where clinica_id in ${sql(ids)}`;
  await sql`delete from clinicas where id in ${sql(ids)}`;
  // consentimentos saem em cascata com o perfil (o gatilho deixa a cascata passar).
  await sql`delete from auth.users where id in ${sql(pessoas)}`;
  await app?.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("LGPD: consentimento", () => {
  it("1. sem aceite, os tres textos estao pendentes", async () => {
    const r = await chamar(paciente, "GET", "/perfis/eu");
    expect(r.json().dados.consentimentosPendentes.sort()).toEqual(["politica_de_privacidade", "telemedicina", "termos_de_uso"]);
  });

  it("2. aceitando a versao atual, nada fica pendente", async () => {
    expect((await chamar(paciente, "POST", "/lgpd/consentimentos", { tipos: ["termos_de_uso", "politica_de_privacidade", "telemedicina"] })).statusCode).toBe(201);
    expect((await chamar(paciente, "GET", "/perfis/eu")).json().dados.consentimentosPendentes).toEqual([]);
  });

  it("3. revogar a telemedicina volta a pedir aceite dela; o historico nao se reescreve", async () => {
    await chamar(paciente, "POST", "/lgpd/consentimentos/revogar", { tipo: "telemedicina" });
    expect((await chamar(paciente, "GET", "/perfis/eu")).json().dados.consentimentosPendentes).toEqual(["telemedicina"]);
    const historico = (await chamar(paciente, "GET", "/lgpd/consentimentos")).json().dados as { tipo: string; acao: string }[];
    expect(historico.filter((h) => h.tipo === "telemedicina").map((h) => h.acao)).toEqual(["revogado", "aceito"]);
    await expect(banco.$client`update consentimentos set acao = 'aceito' where perfil_id = ${paciente}`).rejects.toThrow(/nao se altera/);
  });
});

describe.skipIf(!temBanco)("LGPD: acesso aos proprios dados", () => {
  it("4. o titular baixa a copia dos dados, e o download fica auditado", async () => {
    const r = await chamar(paciente, "GET", "/lgpd/meus-dados");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toContain("meus-dados-");
    const dados = JSON.parse(r.body);
    expect(dados.pessoa.nomeCompleto).toBe("Titular Teste");
    expect(dados.consultas).toHaveLength(1);
    const [a] = await banco.$client`select count(*)::int as n from auditoria where quem = ${paciente} and acao = 'lgpd.dados_exportados'`;
    expect(a?.n).toBe(1);
  });

  it("5. quando o medico le o prontuario, o titular ve quem foi", async () => {
    expect((await chamar(medico, "GET", `/pacientes/${paciente}/ficha`, undefined, slug)).statusCode).toBe(200);
    const acessos = (await chamar(paciente, "GET", "/lgpd/acessos")).json().dados as { quem: string; souEu: boolean; descricao: string }[];
    expect(acessos).toEqual(expect.arrayContaining([expect.objectContaining({ quem: "Dra. Leitora", souEu: false, descricao: "Consultou seu prontuário" })]));
  });
});

describe.skipIf(!temBanco)("LGPD: pedidos do titular", () => {
  let pedido = "";

  it("6. o pedido vai para a clinica, com prazo de 15 dias", async () => {
    const r = await chamar(paciente, "POST", "/lgpd/solicitacoes", { tipo: "correcao", descricao: "Minha data de nascimento está errada no cadastro.", clinica: slug });
    expect(r.statusCode).toBe(201);
    pedido = r.json().dados.id;
    const dias = (new Date(r.json().dados.prazo).getTime() - Date.now()) / 86400000;
    expect(dias).toBeGreaterThan(14.9);
    expect(dias).toBeLessThan(15.1);
  });

  it("7. nao se pede a uma clinica onde nao se tem vinculo", async () => {
    expect((await chamar(paciente, "POST", "/lgpd/solicitacoes", { tipo: "outro", descricao: "Pedido para clinica sem vinculo.", clinica: outroSlug })).statusCode).toBe(404);
  });

  it("8. a administracao desta clinica ve; a de outra nao responde", async () => {
    const lista = (await chamar(admin, "GET", "/lgpd/solicitacoes-da-clinica", undefined, slug)).json().dados as { id: string; titular: { nomeCompleto: string } }[];
    expect(lista.find((s) => s.id === pedido)?.titular.nomeCompleto).toBe("Titular Teste");
    expect((await chamar(adminDeOutra, "POST", `/lgpd/solicitacoes/${pedido}/responder`, { status: "concluida", resposta: "Resposta indevida aqui." }, outroSlug)).statusCode).toBe(404);
  });

  it("9. concluir exige resposta; respondido, o titular ve; nao se responde duas vezes", async () => {
    expect((await chamar(admin, "POST", `/lgpd/solicitacoes/${pedido}/responder`, { status: "concluida" }, slug)).statusCode).toBe(400);
    expect((await chamar(admin, "POST", `/lgpd/solicitacoes/${pedido}/responder`, { status: "concluida", resposta: "Data corrigida após conferência do documento." }, slug)).statusCode).toBe(200);
    const meus = (await chamar(paciente, "GET", "/lgpd/solicitacoes")).json().dados as { id: string; status: string; resposta: string }[];
    expect(meus.find((s) => s.id === pedido)).toMatchObject({ status: "concluida", resposta: "Data corrigida após conferência do documento." });
    expect((await chamar(admin, "POST", `/lgpd/solicitacoes/${pedido}/responder`, { status: "negada", resposta: "Mudando de ideia depois." }, slug)).statusCode).toBe(409);
  });

  it("10. o titular corrige o proprio telefone", async () => {
    const r = await chamar(paciente, "PATCH", "/perfis/eu", { telefone: "21988887777" });
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.telefone).toBe("21988887777");
  });
});
