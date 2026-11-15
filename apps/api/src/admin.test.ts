/**
 * =====================================================================
 * AREA DA ADMINISTRACAO E REPASSE AOS MEDICOS (ADR-0026) - CONTRA O POSTGRES
 * =====================================================================
 *
 * Precisa de DATABASE_URL; sem ele os testes sao pulados.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBanco } from "@tele/db";
import { VERSOES_LEGAIS } from "@tele/shared/lgpd";
import type { Ambiente } from "./ambiente.js";
import { ArmazenamentoEmMemoriaDeAnexos } from "./anexos/armazenamento.js";
import { ProvedorLocalDePagamento } from "./pagamento/index.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);
const slug = `admin-${Date.now()}`;

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
  DB_POOL_MAX: 8,
  LIMITE_POR_MINUTO: 100000,
  PAGAMENTO_WEBHOOK_SEGREDO: "segredo-de-teste-do-webhook",
  PLATAFORMA_SLUG: slug,
} satisfies Ambiente;

const admin = randomUUID();
const medicoA = randomUUID();
const medicoB = randomUUID();
const paciente = randomUUID();
const pessoas: string[] = [admin, medicoA, medicoB, paciente];
const clinicaId = randomUUID();
const autenticar = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
const banco = temBanco ? criarBanco(DATABASE_URL!, { max: 3 }) : (null as never);

function chamar(quem: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${quem}`, "x-clinica": slug, ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload: payload as object } : {}),
  });
}

let hora = 30;
/** Uma consulta CONCLUIDA e paga (Pix confirmado), com a porcentagem congelada informada. */
async function consultaPaga(medico: string, valor: number, bps: number | null, opcoes: { status?: string; diasAtras?: number } = {}) {
  const id = randomUUID();
  hora += 1;
  const inicio = new Date(Date.now() - (opcoes.diasAtras ?? 2) * 86400000 - hora * 3600000);
  await banco.$client`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por, repasse_medico_bps, linha, cancelado_em, cancelado_por, motivo_cancelamento)
    values (${id}, ${clinicaId}, ${paciente}, ${medico}, ${inicio.toISOString()}::timestamptz, ${new Date(inicio.getTime() + 1800000).toISOString()}::timestamptz,
            ${opcoes.status ?? "concluida"}, ${paciente}, ${bps}, 'pronto_atendimento',
            ${opcoes.status === "cancelada" ? new Date().toISOString() : null}::timestamptz, ${opcoes.status === "cancelada" ? paciente : null}, ${opcoes.status === "cancelada" ? "teste" : null})`;
  const cobranca = await new ProvedorLocalDePagamento().cobrar({ accessToken: "x", contaId: "x" }, {
    chaveIdempotencia: randomUUID(), metodo: "pix", valorCentavos: valor, comissaoPlataformaCentavos: 0, descricao: "t", pagador: { nome: "p", email: "" }, urlDeNotificacao: "http://x",
  });
  ProvedorLocalDePagamento.confirmarNoBanco(cobranca.idNoProvedor);
  const [p] = await banco.$client`insert into pagamentos (clinica_id, pagador_id, consulta_id, metodo, status, valor_centavos, valor_clinica_centavos, valor_plataforma_centavos, provedor, provedor_id, chave_idempotencia, confirmado_em)
    values (${clinicaId}, ${paciente}, ${id}, 'pix', 'confirmado', ${valor}, ${valor}, 0, 'local_teste', ${cobranca.idNoProvedor}, ${randomUUID()}, now()) returning id`;
  return { consultaId: id, pagamentoId: p!.id as string };
}

const saldoDe = async (medico: string) =>
  ((await chamar(admin, "GET", "/admin/medicos")).json().dados as { id: string; saldoCentavos: number }[]).find((m) => m.id === medico)!.saldoCentavos;

beforeAll(async () => {
  if (!temBanco) return;
  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar, provedorDeVideo: new ProvedorLocalDeVideo(), armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos() }));
  const sql = banco.$client;
  for (const id of pessoas) {
    await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
    await sql`insert into perfis (id, nome_completo) values (${id}, ${`Pessoa ${id.slice(0, 6)}`})`;
  }
  await sql`insert into clinicas (id, nome_fantasia, razao_social, cnpj, slug, status) values (${clinicaId}, 'Plataforma Admin', 'Plataforma Admin LTDA', ${`${Date.now()}`.slice(-14).padStart(14, "4")}, ${slug}, 'ativa')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${admin}, ${clinicaId}, 'admin_clinica')`;
  await sql`insert into pacientes (perfil_id, data_nascimento) values (${paciente}, '1990-01-01')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${paciente}, ${clinicaId}, 'paciente')`;
  await sql`insert into consentimentos (perfil_id, tipo, acao, versao) values (${paciente}, 'telemedicina', 'aceito', ${VERSOES_LEGAIS.telemedicina})`;
  const validade = new Date(Date.now() + 86400000 * 300).toISOString();
  for (const [id, n] of [[medicoA, 1], [medicoB, 2]] as const) {
    const crm = `${Date.now() + n}`.slice(-6);
    await sql`insert into medicos (perfil_id, crm, crm_uf) values (${id}, ${crm}, 'SC')`;
    await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${id}, ${clinicaId}, 'medico')`;
    await sql`insert into verificacoes_crm (medico_id, clinica_id, resultado, metodo, crm, crm_uf, valido_ate, verificado_por)
      values (${id}, ${clinicaId}, 'verificado', 'consulta_manual_cfm', ${crm}, 'SC', ${validade}::timestamptz, ${admin})`;
  }
  for (let d = 0; d < 7; d++) {
    await sql`insert into disponibilidades (clinica_id, medico_id, dia_semana, hora_inicio, hora_fim, duracao_minutos) values (${clinicaId}, ${medicoA}, ${d}, '00:00', '23:30', 30)`;
  }
});

afterAll(async () => {
  if (!temBanco) return;
  await app.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("area da administracao (ADR-0026)", () => {
  it("1. so a administracao entra; o medico so ve os proprios ganhos", async () => {
    for (const rota of ["/admin/resumo", "/admin/medicos", "/admin/financeiro", "/admin/auditoria", "/admin/configuracoes"]) {
      expect((await chamar(medicoA, "GET", rota)).statusCode, rota).toBe(403);
      expect((await chamar(paciente, "GET", rota)).statusCode, rota).toBe(403);
      expect((await chamar(admin, "GET", rota)).statusCode, rota).toBe(200);
    }
    expect((await chamar(paciente, "GET", "/meus-ganhos")).statusCode).toBe(403);
    expect((await chamar(medicoA, "GET", "/meus-ganhos")).statusCode).toBe(200);
  });

  it("2. sem porcentagem definida o painel avisa; valores fora de 0 a 100% sao recusados", async () => {
    const r = (await chamar(admin, "GET", "/admin/resumo")).json().dados;
    expect(r.plataforma.repassePadraoBps).toBeNull();
    expect(r.pendencias.medicosSemPercentual).toBe(2);
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { repassePadraoBps: 10001 })).statusCode).toBe(400);
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { repassePadraoBps: 70.5 })).statusCode).toBe(400);
    expect((await chamar(admin, "PUT", `/admin/medicos/${medicoA}/percentual`, { percentualBps: -1 })).statusCode).toBe(400);
  });

  it("3. a porcentagem e congelada na consulta: mudar a regra nao muda o que ja foi marcado", async () => {
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { repassePadraoBps: 7000 })).statusCode).toBe(200);
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 3 * 86400000));
    const livres = (await chamar(paciente, "GET", `/horarios?medicoId=${medicoA}&data=${dia}`)).json().dados as { inicio: string }[];
    const marcada = await chamar(paciente, "POST", "/consultas", { medicoId: medicoA, inicio: livres[3]!.inicio, linha: "teleconsulta" });
    expect(marcada.statusCode).toBe(201);

    expect((await chamar(admin, "PUT", `/admin/medicos/${medicoA}/percentual`, { percentualBps: 5000 })).statusCode).toBe(200);
    const [c] = await banco.$client`select repasse_medico_bps from consultas where id = ${marcada.json().dados.id as string}`;
    expect(c!.repasse_medico_bps).toBe(7000);

    const lista = (await chamar(admin, "GET", "/admin/medicos")).json().dados as { id: string; percentualProprioBps: number | null; percentualEmVigorBps: number }[];
    expect(lista.find((m) => m.id === medicoA)).toMatchObject({ percentualProprioBps: 5000, percentualEmVigorBps: 5000 });
    expect(lista.find((m) => m.id === medicoB)).toMatchObject({ percentualProprioBps: null, percentualEmVigorBps: 7000 });
    // Voltar ao padrao.
    expect((await chamar(admin, "PUT", `/admin/medicos/${medicoA}/percentual`, { percentualBps: null })).statusCode).toBe(200);
    await chamar(paciente, "POST", `/consultas/${marcada.json().dados.id as string}/cancelar`, { motivo: "teste" });
  });

  it("4. o repasse conta so consulta concluida e paga, com a porcentagem dela, arredondando para baixo", async () => {
    await consultaPaga(medicoA, 10000, 7000); // 7000
    await consultaPaga(medicoA, 3333, 7000); // 2333,1 -> 2333
    await consultaPaga(medicoA, 20000, 5000); // 10000
    await consultaPaga(medicoA, 9999, 7000, { status: "cancelada" }); // nao entra
    await consultaPaga(medicoB, 15000, null); // regra atual: padrao 70% -> 10500

    expect(await saldoDe(medicoA)).toBe(7000 + 2333 + 10000);
    expect(await saldoDe(medicoB)).toBe(10500);
    const f = (await chamar(admin, "GET", "/admin/financeiro")).json().dados;
    const a = (f.porMedico as { medicoId: string; consultas: number; faturadoCentavos: number; repasseCentavos: number }[]).find((m) => m.medicoId === medicoA)!;
    expect(a).toMatchObject({ consultas: 3, faturadoCentavos: 33333, repasseCentavos: 19333 });
    expect(f.margemCentavos).toBe(f.receitaBrutaCentavos - f.repasseDoPeriodoCentavos);
  });

  it("5. registrar repasse: nao passa do saldo, nem com dois cliques ao mesmo tempo", async () => {
    const corpo = (valor: number) => ({ medicoId: medicoB, valorCentavos: valor, pagoEm: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), referencia: "Pix" });
    expect((await chamar(admin, "POST", "/admin/repasses", corpo(10501))).json().erro.codigo).toBe("ACIMA_DO_SALDO");
    expect((await chamar(admin, "POST", "/admin/repasses", { ...corpo(100), pagoEm: "2999-01-01" })).json().erro.codigo).toBe("DATA_FUTURA");
    expect((await chamar(medicoB, "POST", "/admin/repasses", corpo(100))).statusCode).toBe(403);

    const juntos = await Promise.all([chamar(admin, "POST", "/admin/repasses", corpo(6000)), chamar(admin, "POST", "/admin/repasses", corpo(6000))]);
    expect(juntos.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await saldoDe(medicoB)).toBe(4500);
  });

  it("6. cancelar exige motivo, devolve o saldo e o registro nao some nem muda pelo banco", async () => {
    const [r] = await banco.$client`select id from repasses_medicos where medico_id = ${medicoB} and cancelado_em is null`;
    const id = r!.id as string;
    expect((await chamar(admin, "POST", `/admin/repasses/${id}/cancelar`, { motivo: "x" })).statusCode).toBe(400);
    expect((await chamar(admin, "POST", `/admin/repasses/${id}/cancelar`, { motivo: "valor digitado errado" })).statusCode).toBe(200);
    expect((await chamar(admin, "POST", `/admin/repasses/${id}/cancelar`, { motivo: "valor digitado errado" })).statusCode).toBe(404);
    expect(await saldoDe(medicoB)).toBe(10500);
    await expect(banco.$client`delete from repasses_medicos where id = ${id}`).rejects.toThrow();
    await expect(banco.$client`update repasses_medicos set valor_centavos = 1 where id = ${id}`).rejects.toThrow();
  });

  it("7. o medico ve o proprio saldo e os proprios repasses, e so eles", async () => {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    expect((await chamar(admin, "POST", "/admin/repasses", { medicoId: medicoA, valorCentavos: 9333, pagoEm: hoje, referencia: "TED 123" })).statusCode).toBe(201);
    const a = (await chamar(medicoA, "GET", "/meus-ganhos")).json().dados;
    expect(a).toMatchObject({ ganhoTotalCentavos: 19333, pagoCentavos: 9333, saldoCentavos: 10000, percentualEmVigorBps: 7000 });
    expect(a.repasses).toHaveLength(1);
    const b = (await chamar(medicoB, "GET", "/meus-ganhos")).json().dados;
    expect(b.repasses.map((r: { referencia: string }) => r.referencia)).not.toContain("TED 123");
  });

  it("8. reembolso: so de pagamento confirmado, uma vez so, e a consulta sai do repasse", async () => {
    const { pagamentoId } = await consultaPaga(medicoB, 5000, 7000);
    expect(await saldoDe(medicoB)).toBe(10500 + 3500);
    expect((await chamar(admin, "POST", `/admin/pagamentos/${pagamentoId}/reembolsar`, { motivo: "x" })).statusCode).toBe(400);
    const juntos = await Promise.all([1, 2].map(() => chamar(admin, "POST", `/admin/pagamentos/${pagamentoId}/reembolsar`, { motivo: "paciente sem atendimento" })));
    expect(juntos.every((r) => r.statusCode === 200)).toBe(true);
    const [p] = await banco.$client`select status from pagamentos where id = ${pagamentoId}`;
    expect(p!.status).toBe("estornado");
    expect((await banco.$client`select 1 from auditoria where acao = 'pagamento.reembolsado' and registro_id = ${pagamentoId}`).length).toBe(1);
    expect(await saldoDe(medicoB)).toBe(10500);
    expect((await chamar(medicoB, "POST", `/admin/pagamentos/${pagamentoId}/reembolsar`, { motivo: "tentativa indevida" })).statusCode).toBe(403);
  });

  it("9. auditoria: mostra quem fez o que, filtra por assunto e nao entrega os detalhes", async () => {
    const r = (await chamar(admin, "GET", "/admin/auditoria?grupo=financeiro")).json().dados;
    const acoes = (r.eventos as { acao: string; descricao: string }[]).map((e) => e.acao);
    expect(acoes).toContain("repasse.registrado");
    expect(acoes.every((a) => /^(pagamento|repasse|precos|cartao)\./.test(a))).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/saldoAntes|detalhes/);
  });

  it("10. responsavel tecnico precisa ser medico ativo com CRM verificado; mudanca fica na auditoria", async () => {
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { responsavelTecnicoId: paciente })).json().erro.codigo).toBe("RT_INVALIDO");
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { responsavelTecnicoId: medicoA, nomeFantasia: "Plataforma Nova" })).statusCode).toBe(200);
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { cnpj: "00000000000000" })).statusCode).toBe(400);
    const c = (await chamar(admin, "GET", "/admin/configuracoes")).json().dados;
    expect(c).toMatchObject({ nomeFantasia: "Plataforma Nova", responsavelTecnicoId: medicoA, repassePadraoBps: 7000 });
    expect((await banco.$client`select 1 from auditoria where acao = 'clinica.configuracoes_alteradas' and clinica_id = ${clinicaId}`).length).toBe(1);
  });
});
