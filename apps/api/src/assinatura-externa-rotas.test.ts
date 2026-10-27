/**
 * Ponta a ponta da assinatura externa (ADR-0017), contra o Postgres:
 * emitir -> baixar o PDF -> "assinar no programa do medico" -> enviar.
 * Precisa de DATABASE_URL; sem ele os testes sao pulados.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBanco } from "@tele/db";
import { ArmazenamentoEmMemoriaDeAnexos } from "./anexos/armazenamento.js";
import type { Ambiente } from "./ambiente.js";
import { assinarPdf, prepararPdfParaAssinatura, ProvedorLocalDeTeste, type ArmazenamentoDeDocumentos } from "./assinatura/index.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);

const AMBIENTE = {
  NODE_ENV: "test" as const,
  PORT: 3996,
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

function cpfValido(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b: number[]) => {
    const r = (b.reduce((acc, d, i) => acc + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}

const medico = randomUUID();
const paciente = randomUUID();
const clinicaId = randomUUID();
const consultaId = randomUUID();
const slug = `teste-assext-${Date.now()}`;
const cpfDoMedico = cpfValido();
const pessoas: string[] = [medico, paciente];
const autenticarFalso = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

/** Armazenamento de documentos em memoria (o real e o Supabase Storage). */
const guardados = new Map<string, Uint8Array>();
const armazenamento = {
  async guardar(caminho: string, pdf: Uint8Array) {
    guardados.set(caminho, pdf);
    return { caminho, hash: createHash("sha256").update(pdf).digest("hex") };
  },
  async ler(caminho: string) {
    return guardados.get(caminho)!;
  },
  async linkTemporario(caminho: string) {
    return `memoria://${caminho}`;
  },
} as unknown as ArmazenamentoDeDocumentos;

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let banco: ReturnType<typeof criarBanco>;
const cab = (quem: string) => ({ authorization: `Bearer ${quem}`, "x-clinica": slug });

async function assinarFora(pdf: Uint8Array, cpf: string) {
  const preparado = await prepararPdfParaAssinatura(pdf, { motivo: "teste", local: "teste", nomeDoAssinante: "Medico" });
  const p = new ProvedorLocalDeTeste();
  return (await assinarPdf(preparado, p, await p.autorizar({ cpf, otp: ProvedorLocalDeTeste.OTP_DE_TESTE }, "unica"), "teste")).pdfAssinado;
}

function enviar(documentoId: string, bytes: Uint8Array) {
  const limite = "----limite";
  const corpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="arquivo"; filename="assinado.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${limite}--\r\n`),
  ]);
  return app.inject({ method: "POST", url: `/documentos/${documentoId}/assinatura-externa`, headers: { ...cab(medico), "content-type": `multipart/form-data; boundary=${limite}` }, payload: corpo });
}

async function emitir() {
  const r = await app.inject({
    method: "POST",
    url: "/documentos",
    headers: cab(medico),
    payload: { consultaId, tipo: "receita_simples", conteudo: { itens: [{ medicamento: "Dipirona 500 mg", posologia: "1 comprimido se dor" }] } },
  });
  return r.json().dados.id as string;
}

beforeAll(async () => {
  if (!temBanco) return;
  banco = criarBanco(DATABASE_URL!);
  const sql = banco.$client;
  for (const id of pessoas) await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
  await sql`insert into perfis (id, nome_completo, cpf) values (${medico}, 'Medico de Teste', ${cpfDoMedico}), (${paciente}, 'Paciente Assinatura', null)`;
  await sql`insert into medicos (perfil_id, crm, crm_uf) values (${medico}, '888001', 'SP')`;
  await sql`insert into pacientes (perfil_id, data_nascimento) values (${paciente}, '1985-05-05')`;
  await sql`insert into clinicas (id, slug, nome_fantasia, razao_social, cnpj, status, fuso_horario)
    values (${clinicaId}, ${slug}, 'Clinica Assinatura', 'Clinica Assinatura LTDA', ${String(Date.now()).slice(-14).padStart(14, "3")}, 'ativa', 'America/Sao_Paulo')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel, status) values (${medico}, ${clinicaId}, 'medico', 'ativo'), (${paciente}, ${clinicaId}, 'paciente', 'ativo')`;
  const ate = new Date(Date.now() + 365 * 86400000).toISOString();
  await sql`insert into verificacoes_crm (medico_id, clinica_id, resultado, metodo, crm, crm_uf, nome_no_conselho, situacao_no_conselho, verificado_por, valido_ate)
    values (${medico}, ${clinicaId}, 'verificado', 'consulta_manual_cfm', '888001', 'SP', 'MEDICO DE TESTE', 'Ativo', ${medico}, ${ate})`;
  const inicio = new Date(Date.now() - 600000).toISOString();
  const fim = new Date(Date.now() + 1200000).toISOString();
  await sql`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status) values (${consultaId}, ${clinicaId}, ${paciente}, ${medico}, ${inicio}, ${fim}, 'em_andamento')`;
  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar: autenticarFalso, provedorDeVideo: new ProvedorLocalDeVideo(), armazenamento, armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos() }));
});

afterAll(async () => {
  if (!temBanco) return;
  const sql = banco.$client;
  await sql.begin(async (tx) => {
    await tx.unsafe("alter table documentos disable trigger documentos_imutaveis");
    await tx.unsafe("alter table verificacoes_crm disable trigger verificacoes_crm_imutaveis");
    await tx`delete from documentos where clinica_id = ${clinicaId}`;
    await tx`delete from verificacoes_crm where clinica_id = ${clinicaId}`;
    await tx.unsafe("alter table documentos enable trigger documentos_imutaveis");
    await tx.unsafe("alter table verificacoes_crm enable trigger verificacoes_crm_imutaveis");
  });
  await sql`delete from auditoria where clinica_id = ${clinicaId}`;
  await sql`delete from consultas where clinica_id = ${clinicaId}`;
  await sql`delete from vinculos where clinica_id = ${clinicaId}`;
  await sql`delete from clinicas where id = ${clinicaId}`;
  await sql`delete from auth.users where id in ${sql(pessoas)}`;
  await app?.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("assinatura externa: rotas", () => {
  it("1. baixar o PDF: so o medico que emitiu, e sempre o mesmo arquivo", async () => {
    const id = await emitir();
    const a = await app.inject({ method: "GET", url: `/documentos/${id}/pdf`, headers: cab(medico) });
    const b = await app.inject({ method: "GET", url: `/documentos/${id}/pdf`, headers: cab(medico) });
    expect(a.statusCode).toBe(200);
    expect(a.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.compare(a.rawPayload, b.rawPayload)).toBe(0);
    expect((await app.inject({ method: "GET", url: `/documentos/${id}/pdf`, headers: cab(paciente) })).statusCode).toBe(403);
  });

  it("2. o PDF assinado pelo proprio medico e aceito: o documento vira 'assinado'", async () => {
    const id = await emitir();
    const pdf = (await app.inject({ method: "GET", url: `/documentos/${id}/pdf`, headers: cab(medico) })).rawPayload;
    const r = await enviar(id, await assinarFora(new Uint8Array(pdf), cpfDoMedico));
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.status).toBe("assinado");
    const [linha] = await banco.$client`select assinatura_provedor, assinante_cpf from documentos where id = ${id}`;
    expect(linha).toMatchObject({ assinatura_provedor: "externa", assinante_cpf: cpfDoMedico });
    // Mandar de novo: ja esta assinado.
    expect((await enviar(id, await assinarFora(new Uint8Array(pdf), cpfDoMedico))).statusCode).toBe(409);
  });

  it("3. o PDF de outro documento e recusado, e o documento continua 'emitido'", async () => {
    const alvo = await emitir();
    const outro = await emitir();
    const pdfDoOutro = (await app.inject({ method: "GET", url: `/documentos/${outro}/pdf`, headers: cab(medico) })).rawPayload;
    const r = await enviar(alvo, await assinarFora(new Uint8Array(pdfDoOutro), cpfDoMedico));
    expect(r.statusCode).toBe(422);
    expect(r.json().erro.codigo).toBe("ASSINATURA_EXTERNA_RECUSADA");
    const [linha] = await banco.$client`select status from documentos where id = ${alvo}`;
    expect(linha?.status).toBe("emitido");
  });

  it("4. certificado de outra pessoa e recusado", async () => {
    const id = await emitir();
    const pdf = (await app.inject({ method: "GET", url: `/documentos/${id}/pdf`, headers: cab(medico) })).rawPayload;
    const r = await enviar(id, await assinarFora(new Uint8Array(pdf), "11144477735"));
    expect(r.statusCode).toBe(422);
    expect(r.json().erro.mensagem).toMatch(/outra pessoa/);
  });
});
