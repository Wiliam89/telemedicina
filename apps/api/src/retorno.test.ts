/**
 * =====================================================================
 * RETORNO SEM CUSTO, FALTAS, AVALIACAO, RESTRICAO, INDICADORES E PLANILHA
 * (ADR-0027) - CONTRA O POSTGRES
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
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);
const slug = `retorno-${Date.now()}`;

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
  DB_POOL_MAX: 8,
  LIMITE_POR_MINUTO: 100000,
  PAGAMENTO_WEBHOOK_SEGREDO: "segredo-de-teste-do-webhook",
  PLATAFORMA_SLUG: slug,
} satisfies Ambiente;

const admin = randomUUID();
const medicoA = randomUUID();
const medicoB = randomUUID();
const paciente = randomUUID();
const paciente2 = randomUUID();
const pessoas: string[] = [admin, medicoA, medicoB, paciente, paciente2];
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

let hora = 3;
/** Uma consulta inserida direto, com o status e o inicio pedidos (minutos a partir de agora). */
async function consulta(opcoes: { medico?: string; paciente?: string; status: string; minutos: number; pago?: number; retornoAte?: Date }) {
  const id = randomUUID();
  hora += 1;
  const inicio = new Date(Date.now() + opcoes.minutos * 60000 - (opcoes.minutos < 0 ? hora * 60000 : 0));
  await banco.$client`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por, linha, repasse_medico_bps, retorno_ate)
    values (${id}, ${clinicaId}, ${opcoes.paciente ?? paciente}, ${opcoes.medico ?? medicoA}, ${inicio.toISOString()}::timestamptz, ${new Date(inicio.getTime() + 1800000).toISOString()}::timestamptz,
            ${opcoes.status}, ${paciente}, 'pronto_atendimento', 7000, ${opcoes.retornoAte?.toISOString() ?? null}::timestamptz)`;
  if (opcoes.pago) {
    await banco.$client`insert into pagamentos (clinica_id, pagador_id, consulta_id, metodo, status, valor_centavos, valor_clinica_centavos, valor_plataforma_centavos, provedor, provedor_id, chave_idempotencia, confirmado_em)
      values (${clinicaId}, ${opcoes.paciente ?? paciente}, ${id}, 'pix', 'confirmado', ${opcoes.pago}, ${opcoes.pago}, 0, 'local_teste', ${randomUUID()}, ${randomUUID()}, now())`;
  }
  return id;
}

async function horarios(medico: string, diasAFrente: number) {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + diasAFrente * 86400000));
  return (await chamar(paciente, "GET", `/horarios?medicoId=${medico}&data=${dia}`)).json().dados as { inicio: string }[];
}

beforeAll(async () => {
  if (!temBanco) return;
  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar, provedorDeVideo: new ProvedorLocalDeVideo(), armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos() }));
  const sql = banco.$client;
  for (const id of pessoas) {
    await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
    await sql`insert into perfis (id, nome_completo, cpf) values (${id}, ${`Pessoa ${id.slice(0, 6)}`}, ${`${Date.now()}${Math.floor(Math.random() * 9)}`.slice(-11)})`;
  }
  // Nome digitado com cara de formula: a planilha nao pode executa-lo.
  await sql`update perfis set nome_completo = '=HYPERLINK("http://mal.example")' where id = ${medicoB}`;
  await sql`insert into clinicas (id, nome_fantasia, razao_social, cnpj, slug, status, repasse_padrao_bps) values (${clinicaId}, 'Plataforma Retorno', 'Plataforma Retorno LTDA', ${`${Date.now()}`.slice(-14).padStart(14, "5")}, ${slug}, 'ativa', 7000)`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${admin}, ${clinicaId}, 'admin_clinica')`;
  for (const p of [paciente, paciente2]) {
    await sql`insert into pacientes (perfil_id, data_nascimento) values (${p}, '1990-01-01')`;
    await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${p}, ${clinicaId}, 'paciente')`;
    await sql`insert into consentimentos (perfil_id, tipo, acao, versao) values (${p}, 'telemedicina', 'aceito', ${VERSOES_LEGAIS.telemedicina})`;
  }
  const validade = new Date(Date.now() + 86400000 * 300).toISOString();
  for (const [id, n] of [[medicoA, 1], [medicoB, 2]] as const) {
    const crm = `${Date.now() + n}`.slice(-6);
    await sql`insert into medicos (perfil_id, crm, crm_uf, atende_pronto_atendimento) values (${id}, ${crm}, 'SC', true)`;
    await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${id}, ${clinicaId}, 'medico')`;
    await sql`insert into verificacoes_crm (medico_id, clinica_id, resultado, metodo, crm, crm_uf, valido_ate, verificado_por)
      values (${id}, ${clinicaId}, 'verificado', 'consulta_manual_cfm', ${crm}, 'SC', ${validade}::timestamptz, ${admin})`;
    for (let d = 0; d < 7; d++) {
      await sql`insert into disponibilidades (clinica_id, medico_id, dia_semana, hora_inicio, hora_fim, duracao_minutos) values (${clinicaId}, ${id}, ${d}, '00:00', '23:30', 30)`;
    }
  }
  const precos = await chamar(admin, "PUT", "/precos", { itens: [{ tipo: "pronto_agendado", valorCentavos: 7000 }, { tipo: "pronto_atendimento", valorCentavos: 6000 }] });
  expect(precos.statusCode).toBe(200);
});

afterAll(async () => {
  if (!temBanco) return;
  await app.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("retorno sem custo, faltas e gestao (ADR-0027)", () => {
  let original = "";
  let retornoId = "";

  it("1. so o medico que atendeu libera o retorno, no prazo que a plataforma aceita", async () => {
    original = await consulta({ status: "concluida", minutos: -24 * 60, pago: 7000 });
    const livres = await horarios(medicoA, 2);

    // Sem liberacao, nao ha retorno.
    expect((await chamar(paciente, "POST", "/consultas", { medicoId: medicoA, inicio: livres[3]!.inicio, linha: "pronto_atendimento", retornoDe: original })).json().erro.codigo).toBe("SEM_RETORNO");

    expect((await chamar(paciente, "POST", `/consultas/${original}/retorno`, { dias: 15 })).statusCode).toBe(403);
    expect((await chamar(medicoB, "POST", `/consultas/${original}/retorno`, { dias: 15 })).json().erro.codigo).toBe("NAO_E_SEU_ATENDIMENTO");
    expect((await chamar(medicoA, "POST", `/consultas/${original}/retorno`, { dias: 31 })).json().erro.codigo).toBe("PRAZO_INVALIDO");
    expect((await chamar(medicoA, "POST", `/consultas/${original}/retorno`, { dias: 0 })).json().erro.codigo).toBe("PRAZO_INVALIDO");

    const ok = await chamar(medicoA, "POST", `/consultas/${original}/retorno`, { dias: 15 });
    expect(ok.statusCode).toBe(200);
    const ate = new Date(ok.json().dados.retornoAte as string).getTime();
    expect(Math.abs(ate - (Date.now() + 15 * 86400000))).toBeLessThan(60000);

    // O paciente ve o retorno liberado na agenda (e e avisado).
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - 3 * 86400000));
    const lista = (await chamar(paciente, "GET", `/consultas?de=${dia}`)).json().dados as { id: string; retornoAte: string | null; retornoMarcado: boolean }[];
    expect(lista.find((c) => c.id === original)).toMatchObject({ retornoMarcado: false });
    expect(lista.find((c) => c.id === original)!.retornoAte).not.toBeNull();
    const [aviso] = await banco.$client`select titulo from notificacoes where perfil_id = ${paciente} and titulo = 'Retorno sem custo liberado'`;
    expect(aviso).toBeDefined();
  });

  it("2. o retorno e marcado sem custo, com o mesmo medico, uma vez so", async () => {
    const livres = await horarios(medicoA, 2);
    // Consulta normal no mesmo dia: reserva e pede o Pix (prova que ha preco).
    const normal = await chamar(paciente, "POST", "/consultas", { medicoId: medicoA, inicio: livres[1]!.inicio, linha: "pronto_atendimento" });
    expect(normal.json().dados).toMatchObject({ status: "aguardando_pagamento", valorCombinadoCentavos: 7000 });

    const livresB = await horarios(medicoB, 2);
    expect((await chamar(paciente, "POST", "/consultas", { medicoId: medicoB, inicio: livresB[5]!.inicio, linha: "pronto_atendimento", retornoDe: original })).json().erro.codigo).toBe("RETORNO_E_COM_O_MESMO_MEDICO");
    // Outro paciente nao usa o retorno de ninguem.
    expect((await chamar(paciente2, "POST", "/consultas", { medicoId: medicoA, inicio: livres[5]!.inicio, linha: "pronto_atendimento", retornoDe: original })).json().erro.codigo).toBe("CONSULTA_NAO_ENCONTRADA");

    const r = await chamar(paciente, "POST", "/consultas", { medicoId: medicoA, inicio: livres[5]!.inicio, linha: "teleconsulta", retornoDe: original });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados).toMatchObject({ status: "agendada", valorCombinadoCentavos: null, retornoDe: original, linha: "pronto_atendimento", formaDeCobranca: "antecipada" });
    retornoId = r.json().dados.id as string;

    expect((await chamar(paciente, "POST", "/consultas", { medicoId: medicoA, inicio: livres[7]!.inicio, linha: "pronto_atendimento", retornoDe: original })).json().erro.codigo).toBe("RETORNO_JA_MARCADO");
    expect((await chamar(medicoA, "POST", `/consultas/${original}/retorno`, { dias: 20 })).json().erro.codigo).toBe("RETORNO_JA_MARCADO");
    // Retorno de retorno nao existe: sintoma novo e consulta nova (CFM 1.958/2010).
    expect((await chamar(medicoA, "POST", `/consultas/${retornoId}/retorno`, { dias: 10 })).json().erro.codigo).toBe("RETORNO_DE_RETORNO");
    // E o banco recusa cobrar um retorno, mesmo que alguem tente direto.
    await expect(banco.$client`update consultas set valor_combinado_centavos = 5000 where id = ${retornoId}`).rejects.toThrow();

    // Cancelado o retorno, ele pode ser marcado de novo.
    expect((await chamar(paciente, "POST", `/consultas/${retornoId}/cancelar`, { motivo: "imprevisto" })).statusCode).toBe(200);
    const denovo = await chamar(paciente, "POST", "/consultas", { medicoId: medicoA, inicio: livres[9]!.inicio, linha: "pronto_atendimento", retornoDe: original });
    expect(denovo.statusCode).toBe(201);
    retornoId = denovo.json().dados.id as string;
  });

  it("3. fora do prazo, nao; e a administracao pode desligar o retorno pelo sistema", async () => {
    const curto = await consulta({ status: "concluida", minutos: -3 * 60, retornoAte: new Date(Date.now() + 86400000) });
    const livres = await horarios(medicoA, 3);
    expect((await chamar(paciente, "POST", "/consultas", { medicoId: medicoA, inicio: livres[4]!.inicio, linha: "pronto_atendimento", retornoDe: curto })).json().erro.codigo).toBe("RETORNO_FORA_DO_PRAZO");

    expect((await chamar(medicoA, "PATCH", "/admin/configuracoes", { retornoPrazoMaximoDias: 0 })).statusCode).toBe(403);
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { retornoPrazoMaximoDias: 91 })).statusCode).toBe(400);
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { retornoPrazoMaximoDias: 0 })).statusCode).toBe(200);
    const outra = await consulta({ status: "concluida", minutos: -4 * 60 });
    expect((await chamar(medicoA, "POST", `/consultas/${outra}/retorno`, { dias: 7 })).json().erro.codigo).toBe("RETORNO_DESLIGADO");
    expect((await chamar(admin, "PATCH", "/admin/configuracoes", { retornoPrazoMaximoDias: 45 })).statusCode).toBe(200);
    expect((await chamar(admin, "GET", "/admin/configuracoes")).json().dados.retornoPrazoMaximoDias).toBe(45);
    expect((await chamar(medicoA, "POST", `/consultas/${outra}/retorno`, { dias: 40 })).statusCode).toBe(200);
    const [a] = await banco.$client`select 1 from auditoria where clinica_id = ${clinicaId} and acao = 'clinica.regras_de_retorno_alteradas'`;
    expect(a).toBeDefined();
  });

  it("4. falta: quem registra e o outro lado, depois da tolerancia; a do medico gera estorno", async () => {
    const cedo = await consulta({ status: "agendada", minutos: 5 });
    expect((await chamar(medicoA, "POST", `/consultas/${cedo}/falta`, { quem: "paciente" })).json().erro.codigo).toBe("CEDO_PARA_FALTA");

    const faltou = await consulta({ status: "agendada", minutos: -40 });
    expect((await chamar(paciente, "POST", `/consultas/${faltou}/falta`, { quem: "paciente" })).statusCode).toBe(403);
    expect((await chamar(medicoB, "POST", `/consultas/${faltou}/falta`, { quem: "paciente" })).statusCode).toBe(403);
    const ok = await chamar(medicoA, "POST", `/consultas/${faltou}/falta`, { quem: "paciente" });
    expect(ok.statusCode).toBe(200);
    const [c] = await banco.$client`select status, ausencia, motivo_cancelamento from consultas where id = ${faltou}`;
    expect(c).toMatchObject({ status: "cancelada", ausencia: "paciente", motivo_cancelamento: "Paciente não compareceu" });
    expect((await chamar(medicoA, "POST", `/consultas/${faltou}/falta`, { quem: "paciente" })).json().erro.codigo).toBe("FALTA_SO_EM_AGENDADA");

    const semMedico = await consulta({ status: "agendada", minutos: -50, pago: 7000 });
    expect((await chamar(medicoA, "POST", `/consultas/${semMedico}/falta`, { quem: "medico" })).statusCode).toBe(403);
    expect((await chamar(paciente, "POST", `/consultas/${semMedico}/falta`, { quem: "medico" })).statusCode).toBe(200);
    const [pend] = await banco.$client`select 1 from auditoria a join pagamentos p on p.id::text = a.registro_id where p.consulta_id = ${semMedico} and a.acao = 'pagamento.pendente_de_estorno'`;
    expect(pend).toBeDefined();
    // A recepcao/administracao tambem registra.
    const outra = await consulta({ status: "agendada", minutos: -60 });
    expect((await chamar(admin, "POST", `/consultas/${outra}/falta`, { quem: "paciente" })).statusCode).toBe(200);
  });

  it("5. avaliacao: so o paciente, uma vez, de 0 a 10, e nao se altera", async () => {
    expect((await chamar(paciente, "POST", `/consultas/${original}/avaliacao`, { nota: 11 })).statusCode).toBe(400);
    expect((await chamar(medicoA, "POST", `/consultas/${original}/avaliacao`, { nota: 10 })).json().erro.codigo).toBe("SO_O_PACIENTE");
    expect((await chamar(paciente, "POST", `/consultas/${retornoId}/avaliacao`, { nota: 10 })).json().erro.codigo).toBe("CONSULTA_NAO_CONCLUIDA");
    const ok = await chamar(paciente, "POST", `/consultas/${original}/avaliacao`, { nota: 9, comentario: "Atendimento pontual e atencioso." });
    expect(ok.statusCode).toBe(201);
    expect((await chamar(paciente, "POST", `/consultas/${original}/avaliacao`, { nota: 2 })).json().erro.codigo).toBe("JA_AVALIADA");

    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - 3 * 86400000));
    const lista = (await chamar(paciente, "GET", `/consultas?de=${dia}`)).json().dados as { id: string; notaDaAvaliacao: number | null }[];
    expect(lista.find((c) => c.id === original)!.notaDaAvaliacao).toBe(9);
    await expect(banco.$client`update avaliacoes_consulta set nota = 0 where consulta_id = ${original}`).rejects.toThrow();
    await expect(banco.$client`delete from avaliacoes_consulta where consulta_id = ${original}`).rejects.toThrow();
    // A auditoria guarda a nota, nunca o texto livre.
    const [a] = await banco.$client`select detalhes from auditoria where acao = 'consulta.avaliada' and registro_id = ${original}`;
    expect(JSON.stringify(a!.detalhes)).not.toContain("pontual");
  });

  it("6. restricao: impede marcar e entrar na fila, mas o paciente continua vendo o que e dele", async () => {
    expect((await chamar(medicoA, "POST", `/admin/pacientes/${paciente2}/restringir`, { motivo: "fraude no pagamento" })).statusCode).toBe(403);
    expect((await chamar(admin, "POST", `/admin/pacientes/${paciente2}/restringir`, { motivo: "x" })).statusCode).toBe(400);
    expect((await chamar(admin, "POST", `/admin/pacientes/${paciente2}/restringir`, { motivo: "fraude no pagamento" })).statusCode).toBe(201);
    expect((await chamar(admin, "POST", `/admin/pacientes/${paciente2}/restringir`, { motivo: "fraude no pagamento" })).json().erro.codigo).toBe("JA_RESTRITO");

    const livres = await horarios(medicoA, 4);
    expect((await chamar(paciente2, "POST", "/consultas", { medicoId: medicoA, inicio: livres[2]!.inicio, linha: "pronto_atendimento" })).json().erro.codigo).toBe("PACIENTE_COM_RESTRICAO");
    expect((await chamar(paciente2, "POST", "/pagamentos/pronto-atendimento", { metodo: "pix", linha: "pronto_atendimento" })).json().erro?.codigo).toBe("PACIENTE_COM_RESTRICAO");
    expect((await chamar(paciente2, "GET", "/consultas")).statusCode).toBe(200);

    const lista = (await chamar(admin, "GET", "/admin/pacientes?filtro=restritos")).json().dados as { id: string; restricao: { motivo: string } | null }[];
    expect(lista.map((p) => p.id)).toEqual([paciente2]);
    await expect(banco.$client`delete from restricoes_pacientes where paciente_id = ${paciente2}`).rejects.toThrow();

    expect((await chamar(admin, "POST", `/admin/pacientes/${paciente2}/liberar`)).statusCode).toBe(200);
    expect((await chamar(admin, "POST", `/admin/pacientes/${paciente2}/liberar`)).json().erro.codigo).toBe("SEM_RESTRICAO");
    expect((await chamar(paciente2, "POST", "/consultas", { medicoId: medicoA, inicio: livres[2]!.inicio, linha: "pronto_atendimento" })).statusCode).toBe(201);
  });

  it("7. lista de pacientes: cadastro mascarado e numeros, filtros por falta", async () => {
    expect((await chamar(paciente, "GET", "/admin/pacientes")).statusCode).toBe(403);
    const todos = (await chamar(admin, "GET", "/admin/pacientes")).json().dados as { id: string; cpfMascarado: string; faltas: number; consultasConcluidas: number }[];
    const p = todos.find((x) => x.id === paciente)!;
    expect(p.cpfMascarado).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    expect(p.faltas).toBe(2);
    expect(p.consultasConcluidas).toBeGreaterThanOrEqual(3);
    const comFaltas = (await chamar(admin, "GET", "/admin/pacientes?filtro=com_faltas")).json().dados as { id: string }[];
    expect(comFaltas.map((x) => x.id)).toEqual([paciente]);
    // Busca nao aceita curinga do SQL como atalho.
    expect((await chamar(admin, "GET", "/admin/pacientes?busca=%25")).json().dados).toHaveLength(0);
  });

  it("8. indicadores de faltas e de satisfacao (NPS)", async () => {
    expect((await chamar(medicoA, "GET", "/admin/indicadores")).statusCode).toBe(403);
    const r = (await chamar(admin, "GET", "/admin/indicadores")).json().dados;
    expect(r.faltasDoPaciente).toBe(2);
    expect(r.faltasDoMedico).toBe(1);
    expect(r.taxaDeFaltaDoPaciente).toBeGreaterThan(0);
    expect(r.satisfacao).toMatchObject({ respostas: 1, nps: 100, promotores: 1, detratores: 0 });
    expect(r.comentarios[0].comentario).toBe("Atendimento pontual e atencioso.");
    expect(r.retornos.liberados).toBeGreaterThanOrEqual(2);
    expect(r.porMedico.find((m: { medicoId: string }) => m.medicoId === medicoA)).toMatchObject({ respostas: 1, nps: 100, faltasDoMedico: 1 });
  });

  it("9. planilha para o contador: CSV que o Excel abre, sem paciente, sem formula, auditada", async () => {
    await consulta({ medico: medicoB, status: "concluida", minutos: -5 * 60, pago: 10000 });
    expect((await chamar(medicoA, "GET", "/admin/financeiro/planilha")).statusCode).toBe(403);
    const r = await chamar(admin, "GET", "/admin/financeiro/planilha?tipo=consultas");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.body.charCodeAt(0)).toBe(0xfeff);
    const linhas = r.body.slice(1).trim().split("\r\n");
    expect(linhas[0]).toContain("Valor pago (R$)");
    // Pago 70,00 com 70% para o medico: 49,00 e 21,00.
    expect(linhas.some((l) => l.endsWith(";70,00;0,00;70,00;49,00;21,00"))).toBe(true);
    // O retorno aparece sem custo.
    expect(r.body).not.toContain(`Pessoa ${paciente.slice(0, 6)}`);
    // Nome com cara de formula vira texto.
    expect(r.body).toContain(`"'=HYPERLINK(""http://mal.example"")"`);

    const rep = await chamar(admin, "GET", "/admin/financeiro/planilha?tipo=repasses");
    expect(rep.body.slice(1).split("\r\n")[0]).toContain("Data do pagamento");
    const [a] = await banco.$client`select count(*)::int as n from auditoria where clinica_id = ${clinicaId} and acao = 'financeiro.planilha_exportada'`;
    expect(a!.n).toBe(2);
    expect((await chamar(admin, "GET", "/admin/financeiro/planilha?de=2026-01-10&ate=2026-01-01")).json().erro.codigo).toBe("PERIODO_INVALIDO");
  });
});
