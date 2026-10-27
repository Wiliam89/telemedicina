/**
 * =====================================================================
 * TESTES DE NOTIFICACOES E INDICADORES (ADR-0019) - CONTRA O POSTGRES
 * =====================================================================
 *
 *   - lembrete de 24 h entra uma vez so, mesmo rodando o agendador de novo
 *   - duas instancias juntas: cada e-mail sai UMA vez (SKIP LOCKED)
 *   - cancelar avisa a outra parte; a central lista e marca como lida
 *   - indicadores: so a administracao, e os numeros batem
 *
 * Precisa de DATABASE_URL; sem ele os testes sao pulados.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBanco } from "@tele/db";
import { ArmazenamentoEmMemoriaDeAnexos } from "./anexos/armazenamento.js";
import type { Ambiente } from "./ambiente.js";
import { EnviadorConsole, rodarAgendador } from "./notificacoes/index.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);

const AMBIENTE = {
  NODE_ENV: "test" as const,
  PORT: 3994,
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
const clinicaId = randomUUID();
const consultaAmanha = randomUUID();
const consultaParaCancelar = randomUUID();
const slug = `teste-notif-${Date.now()}`;
const pessoas: string[] = [paciente, medico, admin];
const autenticarFalso = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let banco: ReturnType<typeof criarBanco>;
const chamar = (quem: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${quem}`, "x-clinica": slug }, ...(payload === undefined ? {} : { payload: payload as object }) });

beforeAll(async () => {
  if (!temBanco) return;
  banco = criarBanco(DATABASE_URL!);
  const sql = banco.$client;
  for (const id of pessoas) await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
  await sql`insert into perfis (id, nome_completo) values (${paciente}, 'Paciente Aviso'), (${medico}, 'Dr. Aviso'), (${admin}, 'Admin Aviso')`;
  await sql`insert into medicos (perfil_id, crm, crm_uf) values (${medico}, '555001', 'SP')`;
  await sql`insert into pacientes (perfil_id, data_nascimento) values (${paciente}, '1980-08-08')`;
  await sql`insert into clinicas (id, slug, nome_fantasia, razao_social, cnpj, status, fuso_horario)
    values (${clinicaId}, ${slug}, 'Clinica Aviso', 'Clinica Aviso LTDA', ${String(Date.now() + 9).slice(-14).padStart(14, "5")}, 'ativa', 'America/Sao_Paulo')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel, status) values
    (${paciente}, ${clinicaId}, 'paciente', 'ativo'), (${medico}, ${clinicaId}, 'medico', 'ativo'), (${admin}, ${clinicaId}, 'admin_clinica', 'ativo')`;
  const em = (min: number) => new Date(Date.now() + min * 60000).toISOString();
  await sql`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status) values
    (${consultaAmanha}, ${clinicaId}, ${paciente}, ${medico}, ${em(24 * 60)}, ${em(24 * 60 + 30)}, 'agendada'),
    (${consultaParaCancelar}, ${clinicaId}, ${paciente}, ${medico}, ${em(3 * 24 * 60)}, ${em(3 * 24 * 60 + 30)}, 'agendada')`;
  // Uma concluida e uma cancelada no passado, para os indicadores.
  await sql`insert into consultas (clinica_id, paciente_id, medico_id, inicio, fim, status) values (${clinicaId}, ${paciente}, ${medico}, ${em(-5 * 24 * 60)}, ${em(-5 * 24 * 60 + 30)}, 'concluida')`;
  await sql`insert into consultas (clinica_id, paciente_id, medico_id, inicio, fim, status, cancelado_em, cancelado_por, motivo_cancelamento)
    values (${clinicaId}, ${paciente}, ${medico}, ${em(-3 * 24 * 60)}, ${em(-3 * 24 * 60 + 30)}, 'cancelada', ${em(-4 * 24 * 60)}, ${paciente}, 'teste')`;
  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar: autenticarFalso, provedorDeVideo: new ProvedorLocalDeVideo(), armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos() }));
});

afterAll(async () => {
  if (!temBanco) return;
  const sql = banco.$client;
  await sql`delete from notificacoes where perfil_id in ${sql(pessoas)}`;
  await sql`delete from auditoria where clinica_id = ${clinicaId}`;
  await sql`delete from consultas where clinica_id = ${clinicaId}`;
  await sql`delete from vinculos where clinica_id = ${clinicaId}`;
  await sql`delete from clinicas where id = ${clinicaId}`;
  await sql`delete from auth.users where id in ${sql(pessoas)}`;
  await app?.close();
  await banco.$client.end({ timeout: 2 });
});

const meusAvisos = (perfil: string, tipo: string) => banco.$client`select * from notificacoes where perfil_id = ${perfil} and tipo = ${tipo}`;

describe.skipIf(!temBanco)("notificacoes", () => {
  it("1. o lembrete de 24 h entra para os dois, e uma vez so", async () => {
    const enviador = new EnviadorConsole();
    await rodarAgendador(banco, enviador, { urlDoSite: "http://localhost:3000", plataforma: "Teste" });
    await rodarAgendador(banco, enviador, { urlDoSite: "http://localhost:3000", plataforma: "Teste" });
    expect(await meusAvisos(paciente, "lembrete_24h")).toHaveLength(1);
    expect(await meusAvisos(medico, "lembrete_24h")).toHaveLength(1);
    const [aviso] = await meusAvisos(paciente, "lembrete_24h");
    expect(aviso?.corpo).toContain("Dr. Aviso");
    // Sem dado clinico no texto que vai por e-mail.
    expect(aviso?.corpo).not.toMatch(/motivo|cid|diagn/i);
  });

  it("2. duas instancias juntas: cada e-mail sai uma vez", async () => {
    // Reabre o envio dos avisos deste teste e roda dois agendadores ao mesmo tempo.
    await banco.$client`update notificacoes set email_enviado_em = null, email_tentativas = 0 where perfil_id in ${banco.$client(pessoas)}`;
    const a = new EnviadorConsole();
    const b = new EnviadorConsole();
    await Promise.all([
      rodarAgendador(banco, a, { urlDoSite: "http://x", plataforma: "Teste" }),
      rodarAgendador(banco, b, { urlDoSite: "http://x", plataforma: "Teste" }),
    ]);
    const meusEmails = [...a.enviados, ...b.enviados].filter((e) => e.para.endsWith("@teste.local") && pessoas.some((p) => e.para.startsWith(p)));
    const porDestino = new Map<string, number>();
    for (const e of meusEmails) porDestino.set(`${e.para}|${e.assunto}`, (porDestino.get(`${e.para}|${e.assunto}`) ?? 0) + 1);
    expect(meusEmails.length).toBeGreaterThanOrEqual(2);
    expect([...porDestino.values()].every((n) => n === 1)).toBe(true);
  });

  it("3. cancelar avisa o medico, nao quem cancelou", async () => {
    const r = await chamar(paciente, "POST", `/consultas/${consultaParaCancelar}/cancelar`, { motivo: "Imprevisto no trabalho" });
    expect(r.statusCode).toBe(200);
    expect(await meusAvisos(medico, "consulta_cancelada")).toHaveLength(1);
    expect(await meusAvisos(paciente, "consulta_cancelada")).toHaveLength(0);
  });

  it("4. a central lista, conta as nao lidas e marca como lidas", async () => {
    const antes = (await chamar(medico, "GET", "/notificacoes")).json().dados;
    expect(antes.naoLidas).toBeGreaterThanOrEqual(2);
    await chamar(medico, "POST", `/notificacoes/${antes.itens[0].id}/lida`);
    expect((await chamar(medico, "GET", "/notificacoes")).json().dados.naoLidas).toBe(antes.naoLidas - 1);
    await chamar(medico, "POST", "/notificacoes/lidas");
    expect((await chamar(medico, "GET", "/notificacoes")).json().dados.naoLidas).toBe(0);
    // Ninguem marca a notificacao de outra pessoa.
    const doPaciente = (await chamar(paciente, "GET", "/notificacoes")).json().dados;
    await chamar(medico, "POST", `/notificacoes/${doPaciente.itens[0].id}/lida`);
    expect((await chamar(paciente, "GET", "/notificacoes")).json().dados.naoLidas).toBe(doPaciente.naoLidas);
  });
});

describe.skipIf(!temBanco)("indicadores", () => {
  it("5. so a administracao ve", async () => {
    expect((await chamar(medico, "GET", "/indicadores")).statusCode).toBe(403);
    expect((await chamar(admin, "GET", "/indicadores")).statusCode).toBe(200);
  });

  it("6. os numeros do periodo batem com o que aconteceu", async () => {
    const d = (await chamar(admin, "GET", "/indicadores?dias=30")).json().dados;
    // No periodo (ultimos 30 dias ate agora): 1 concluida e 2 canceladas
    // (a do passado e a cancelada no teste 3 fica no futuro - fora).
    expect(d.consultas.concluidas).toBe(1);
    expect(d.consultas.canceladas).toBe(1);
    expect(d.consultas.taxaCancelamento).toBeCloseTo(0.5);
    expect(d.pacientes.atendidos).toBe(1);
    expect(d.consultas.porMedico[0]).toMatchObject({ medico: "Dr. Aviso", concluidas: 1 });
  });
});
