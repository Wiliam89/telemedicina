/**
 * =====================================================================
 * TESTES DO PRONTUARIO DO PACIENTE (ADR-0015) - CONTRA O POSTGRES
 * =====================================================================
 *
 * A pergunta que importa aqui e de ACESSO: quem le dado clinico?
 *
 *   - o medico que atende o paciente: sim
 *   - outro medico da mesma clinica, sem consulta com ele: nao
 *   - recepcao: ve o cadastro, nao a ficha
 *   - o proprio paciente: sim
 *   - outro paciente: nem sabe que a pessoa existe (404)
 *
 * E de INTEGRIDADE: ficha ganha versao em vez de ser reescrita, e nem o
 * dono do banco altera um registro clinico (o gatilho recusa).
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
  PORT: 3998,
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

const medico = randomUUID();
const outroMedico = randomUUID();
const recepcao = randomUUID();
const paciente = randomUUID();
const outroPaciente = randomUUID();
const clinicaId = randomUUID();
const consultaId = randomUUID();
const slug = `teste-pront-${Date.now()}`;
const pessoas: string[] = [medico, outroMedico, recepcao, paciente, outroPaciente];

const autenticarFalso = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let banco: ReturnType<typeof criarBanco>;
const armazenamento = new ArmazenamentoEmMemoriaDeAnexos();

const chamar = (quem: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${quem}`, "x-clinica": slug }, ...(payload === undefined ? {} : { payload: payload as object }) });

/** Monta um multipart/form-data na mao (app.inject nao tem FormData). */
function multipart(campos: Record<string, string>, arquivo: { nome: string; tipo: string; bytes: Uint8Array }) {
  const limite = `----teste${Date.now()}`;
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\nContent-Type: ${arquivo.tipo}\r\n\r\n`));
  partes.push(Buffer.from(arquivo.bytes));
  partes.push(Buffer.from(`\r\n--${limite}--\r\n`));
  return { corpo: Buffer.concat(partes), tipo: `multipart/form-data; boundary=${limite}` };
}

const enviarAnexo = (quem: string, campos: Record<string, string>, arquivo: { nome: string; tipo: string; bytes: Uint8Array }) => {
  const m = multipart(campos, arquivo);
  return app.inject({
    method: "POST",
    url: `/pacientes/${paciente}/anexos`,
    headers: { authorization: `Bearer ${quem}`, "x-clinica": slug, "content-type": m.tipo },
    payload: m.corpo,
  });
};

const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"));
const EXE = new Uint8Array(Buffer.from("MZ\x90\x00\x03\x00\x00\x00binario"));

beforeAll(async () => {
  if (!temBanco) return;
  banco = criarBanco(DATABASE_URL!);
  const sql = banco.$client;
  for (const id of pessoas) await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
  await sql`insert into perfis (id, nome_completo) values
    (${medico}, 'Dra. Atende'), (${outroMedico}, 'Dr. Outro'), (${recepcao}, 'Recepcao Teste'),
    (${paciente}, 'Paciente Teste'), (${outroPaciente}, 'Outro Paciente')`;
  await sql`insert into medicos (perfil_id, crm, crm_uf) values (${medico}, '654321', 'SP'), (${outroMedico}, '654322', 'SP')`;
  await sql`insert into pacientes (perfil_id, data_nascimento) values (${paciente}, '1980-02-10'), (${outroPaciente}, '1992-07-01')`;
  await sql`insert into clinicas (id, slug, nome_fantasia, razao_social, cnpj, status, fuso_horario)
    values (${clinicaId}, ${slug}, 'Clinica Pront', 'Clinica Pront LTDA', ${String(Date.now() + 7).slice(-14).padStart(14, "2")}, 'ativa', 'America/Sao_Paulo')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel, status) values
    (${medico}, ${clinicaId}, 'medico', 'ativo'), (${outroMedico}, ${clinicaId}, 'medico', 'ativo'),
    (${recepcao}, ${clinicaId}, 'recepcao', 'ativo'),
    (${paciente}, ${clinicaId}, 'paciente', 'ativo'), (${outroPaciente}, ${clinicaId}, 'paciente', 'ativo')`;
  const ontem = new Date(Date.now() - 86400000).toISOString();
  const ontemMaisMeia = new Date(Date.now() - 86400000 + 1800000).toISOString();
  await sql`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, motivo)
    values (${consultaId}, ${clinicaId}, ${paciente}, ${medico}, ${ontem}, ${ontemMaisMeia}, 'concluida', 'Primeira consulta')`;

  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar: autenticarFalso, provedorDeVideo: new ProvedorLocalDeVideo(), armazenamentoDeAnexos: armazenamento }));
});

afterAll(async () => {
  if (!temBanco) return;
  const sql = banco.$client;
  // Registro clinico e somente insercao - ate para o dono do banco. Para
  // limpar o que o TESTE criou, os gatilhos sao desligados dentro de uma
  // transacao (ninguem mais escreve nessas tabelas enquanto ela dura).
  await sql.begin(async (tx) => {
    for (const t of ["fichas_clinicas", "sinais_vitais", "anexos"]) await tx.unsafe(`alter table ${t} disable trigger ${t}_imutaveis`);
    await tx`delete from fichas_clinicas where clinica_id = ${clinicaId}`;
    await tx`delete from sinais_vitais where clinica_id = ${clinicaId}`;
    await tx`delete from anexos where clinica_id = ${clinicaId}`;
    for (const t of ["fichas_clinicas", "sinais_vitais", "anexos"]) await tx.unsafe(`alter table ${t} enable trigger ${t}_imutaveis`);
  });
  await sql`delete from auditoria where clinica_id = ${clinicaId}`;
  await sql`delete from consultas where clinica_id = ${clinicaId}`;
  await sql`delete from vinculos where clinica_id = ${clinicaId}`;
  await sql`delete from clinicas where id = ${clinicaId}`;
  await sql`delete from auth.users where id in ${sql(pessoas)}`;
  await app?.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("prontuario do paciente: quem acessa", () => {
  it("1. a recepcao lista os pacientes; o paciente nao lista ninguem", async () => {
    const r = await chamar(recepcao, "GET", "/pacientes");
    expect(r.statusCode).toBe(200);
    const nomes = r.json().dados.map((p: { nomeCompleto: string }) => p.nomeCompleto);
    expect(nomes).toEqual(expect.arrayContaining(["Paciente Teste", "Outro Paciente"]));
    expect((await chamar(paciente, "GET", "/pacientes")).statusCode).toBe(403);
  });

  it("2. a busca encontra pelo nome, e 'meus' traz so quem o medico atende", async () => {
    const busca = await chamar(recepcao, "GET", "/pacientes?busca=outro");
    expect(busca.json().dados.map((p: { nomeCompleto: string }) => p.nomeCompleto)).toEqual(["Outro Paciente"]);
    const meus = await chamar(medico, "GET", "/pacientes?meus=1");
    expect(meus.json().dados.map((p: { id: string }) => p.id)).toEqual([paciente]);
    expect(meus.json().dados[0].totalConsultas).toBe(1);
  });

  it("3. acessoClinico: sim para quem atende e para o proprio; nao para os outros", async () => {
    const ver = async (quem: string) => (await chamar(quem, "GET", `/pacientes/${paciente}`)).json().dados.acessoClinico;
    expect(await ver(medico)).toBe(true);
    expect(await ver(paciente)).toBe(true);
    expect(await ver(outroMedico)).toBe(false);
    expect(await ver(recepcao)).toBe(false);
  });

  it("4. ficha: recepcao e outro medico recebem 403; outro paciente recebe 404", async () => {
    expect((await chamar(recepcao, "GET", `/pacientes/${paciente}/ficha`)).statusCode).toBe(403);
    expect((await chamar(outroMedico, "GET", `/pacientes/${paciente}/ficha`)).statusCode).toBe(403);
    expect((await chamar(outroPaciente, "GET", `/pacientes/${paciente}/ficha`)).statusCode).toBe(404);
  });
});

describe.skipIf(!temBanco)("prontuario do paciente: ficha com versoes", () => {
  it("5. o medico cria a ficha e depois a atualiza: duas versoes, a atual e a 2", async () => {
    const v1 = await chamar(medico, "POST", `/pacientes/${paciente}/ficha`, { alergias: ["Dipirona"], medicamentosEmUso: ["Losartana 50 mg"], tipoSanguineo: "O+" });
    expect(v1.statusCode).toBe(201);
    expect(v1.json().dados.versao).toBe(1);

    const v2 = await chamar(medico, "POST", `/pacientes/${paciente}/ficha`, { alergias: ["Dipirona", "Penicilina"], comorbidades: "Hipertensão" });
    expect(v2.json().dados.versao).toBe(2);
    expect(v2.json().dados.alergias).toEqual(["Dipirona", "Penicilina"]);

    const lida = await chamar(paciente, "GET", `/pacientes/${paciente}/ficha`);
    expect(lida.json().dados.versao).toBe(2);
    const [linha] = await banco.$client`select count(*)::int as n from fichas_clinicas where paciente_id = ${paciente}`;
    expect(linha?.n).toBe(2);
  });

  it("6. 'nega alergias' junto com alergias e recusado", async () => {
    const r = await chamar(medico, "POST", `/pacientes/${paciente}/ficha`, { negaAlergias: true, alergias: ["Dipirona"] });
    expect(r.statusCode).toBe(400);
  });

  it("7. o paciente le a propria ficha mas nao a altera", async () => {
    expect((await chamar(paciente, "POST", `/pacientes/${paciente}/ficha`, { alergias: [] })).statusCode).toBe(403);
  });

  it("8. nem o dono do banco reescreve a ficha: o gatilho recusa", async () => {
    await expect(banco.$client`update fichas_clinicas set alergias = '{}' where paciente_id = ${paciente}`).rejects.toThrow(/nao se altera/);
  });
});

describe.skipIf(!temBanco)("prontuario do paciente: sinais vitais e anexos", () => {
  it("9. pressao com sistolica menor que a diastolica e recusada", async () => {
    const r = await chamar(medico, "POST", `/pacientes/${paciente}/sinais`, { pressaoSistolica: 70, pressaoDiastolica: 90 });
    expect(r.statusCode).toBe(400);
  });

  it("10. o medico registra (origem profissional, com IMC); o paciente informa (origem paciente)", async () => {
    const m = await chamar(medico, "POST", `/pacientes/${paciente}/sinais`, { pesoKg: 80, alturaCm: 175, pressaoSistolica: 130, pressaoDiastolica: 85, consultaId });
    expect(m.statusCode).toBe(201);
    expect(m.json().dados).toMatchObject({ origem: "profissional", imc: 26.1, pressaoSistolica: 130 });

    const p = await chamar(paciente, "POST", `/pacientes/${paciente}/sinais`, { glicemiaMgDl: 98 });
    expect(p.json().dados.origem).toBe("paciente");

    const lista = await chamar(medico, "GET", `/pacientes/${paciente}/sinais`);
    expect(lista.json().dados).toHaveLength(2);
  });

  it("11. anexo: executavel disfarcado e recusado pelo conteudo, PDF entra", async () => {
    const exe = await enviarAnexo(paciente, { categoria: "exame_laboratorial", titulo: "Hemograma" }, { nome: "hemograma.pdf", tipo: "application/pdf", bytes: EXE });
    expect(exe.statusCode).toBe(415);

    const pdf = await enviarAnexo(paciente, { categoria: "exame_laboratorial", titulo: "Hemograma completo", dataDoExame: "2026-10-01" }, { nome: "hemograma.pdf", tipo: "application/pdf", bytes: PDF });
    expect(pdf.statusCode).toBe(201);
    expect(pdf.json().dados).toMatchObject({ titulo: "Hemograma completo", origem: "paciente", tipoArquivo: "application/pdf" });
  });

  it("12. baixar anexo: o medico que atende recebe o link; a recepcao nao", async () => {
    const lista = await chamar(medico, "GET", `/pacientes/${paciente}/anexos`);
    const id = lista.json().dados[0].id;
    const r = await chamar(medico, "GET", `/anexos/${id}/arquivo`);
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.url).toMatch(/^memoria:\/\//);
    expect((await chamar(recepcao, "GET", `/anexos/${id}/arquivo`)).statusCode).toBe(403);
  });

  it("13. a linha do tempo junta consulta, ficha, sinais e anexo - do mais novo ao mais antigo", async () => {
    const r = await chamar(medico, "GET", `/pacientes/${paciente}/linha-do-tempo`);
    expect(r.statusCode).toBe(200);
    const eventos = r.json().dados as { tipo: string; em: string }[];
    expect(new Set(eventos.map((e) => e.tipo))).toEqual(new Set(["consulta", "ficha", "sinais", "anexo"]));
    const datas = eventos.map((e) => e.em);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it("14. toda leitura do medico ficou na auditoria; as do paciente nao precisam", async () => {
    const linhas = await banco.$client`select quem, tabela from auditoria where clinica_id = ${clinicaId} and acao = 'prontuario.lido'`;
    expect(linhas.every((l) => l.quem === medico)).toBe(true);
    expect(linhas.map((l) => l.tabela)).toEqual(expect.arrayContaining(["sinais_vitais", "anexos", "linha_do_tempo"]));
  });
});
