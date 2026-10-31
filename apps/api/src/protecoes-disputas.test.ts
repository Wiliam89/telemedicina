/**
 * =====================================================================
 * DISPUTAS E CASOS DE BORDA (ADR-0021) - CONTRA O POSTGRES
 * =====================================================================
 *
 * Cada teste aqui foi conferido desligando a protecao correspondente: ele tem
 * de falhar sem ela. Os de disputa disparam os pedidos ao mesmo tempo, varias
 * rodadas, e exigem que nenhum termine em erro interno.
 *
 * Precisa de DATABASE_URL; sem ele os testes sao pulados.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { criarBanco } from "@tele/db";
import { VERSOES_LEGAIS } from "@tele/shared/lgpd";
import type { Ambiente } from "./ambiente.js";
import { ArmazenamentoEmMemoriaDeAnexos } from "./anexos/armazenamento.js";
import { ProvedorLocalDeTeste, type ArmazenamentoDeDocumentos } from "./assinatura/index.js";
import { ProvedorLocalDePagamento } from "./pagamento/provedor-local.js";
import { liberarReservasVencidas } from "./reservas.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);

const AMBIENTE = {
  NODE_ENV: "test" as const,
  PORT: 3993,
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
const medico2 = randomUUID();
const admin = randomUUID();
const recepcao = randomUUID();
const pacientes = Array.from({ length: 8 }, () => randomUUID());
const clinicaId = randomUUID();
const slug = `teste-disputas-${Date.now()}`;
const cpfDoMedico = cpfValido();
const pessoas: string[] = [medico, medico2, admin, recepcao, ...pacientes];
const autenticar = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

/** Uma copia do documento em memoria; o gancho permite simular algo acontecendo durante o envio. */
const guardados = new Map<string, Uint8Array>();
let duranteGuardar: (() => Promise<void>) | null = null;
const armazenamento = {
  async guardar(caminho: string, pdf: Uint8Array) {
    if (duranteGuardar) await duranteGuardar();
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

const provedorDeVideo = new ProvedorLocalDeVideo();
let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let appProducao: Awaited<ReturnType<typeof criarServidor>>["app"];
const banco = temBanco ? criarBanco(DATABASE_URL!, { max: 3 }) : (null as never);

function chamar(quem: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, naClinica = true, instancia = app) {
  return instancia.inject({
    method,
    url,
    headers: { authorization: `Bearer ${quem}`, ...(naClinica ? { "x-clinica": slug } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload: payload as object } : {}),
  });
}

let hora = 24;
async function novaConsulta(d: { paciente: string; status?: string; expiraEm?: Date | null; medicoId?: string }) {
  const id = randomUUID();
  hora += 1;
  const inicio = new Date(Math.ceil(Date.now() / 3600000) * 3600000 + hora * 3600 * 1000);
  const fim = new Date(inicio.getTime() + 30 * 60000);
  await banco.$client`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por, expira_reserva_em)
    values (${id}, ${clinicaId}, ${d.paciente}, ${d.medicoId ?? medico}, ${inicio.toISOString()}::timestamptz, ${fim.toISOString()}::timestamptz, ${d.status ?? "agendada"}, ${d.paciente}, ${d.expiraEm ? d.expiraEm.toISOString() : null}::timestamptz)`;
  return { id, inicio, fim };
}

const pagamentoConfirmado = async (quem: string) => {
  const [p] = await banco.$client`
    insert into pagamentos (clinica_id, pagador_id, metodo, status, valor_centavos, valor_clinica_centavos, valor_plataforma_centavos, provedor, chave_idempotencia, confirmado_em)
    values (${clinicaId}, ${quem}, 'pix', 'confirmado', 9000, 9000, 0, 'local_teste', ${randomUUID()}, now()) returning id`;
  return p!.id as string;
};

function avisarProvedor(idNoProvedor: string) {
  const { corpo, cabecalhos } = ProvedorLocalDePagamento.montarNotificacao(idNoProvedor, AMBIENTE.PAGAMENTO_WEBHOOK_SEGREDO);
  return app.inject({ method: "POST", url: "/webhooks/pagamento", headers: { ...cabecalhos, "content-type": "application/json" }, payload: corpo });
}

async function pix(paciente: string) {
  const c = await novaConsulta({ paciente, status: "aguardando_pagamento", expiraEm: new Date(Date.now() + 15 * 60000) });
  const r = await chamar(paciente, "POST", `/consultas/${c.id}/pagamento`, { metodo: "pix" });
  const [p] = await banco.$client`select id, provedor_id from pagamentos where id = ${r.json().dados.pagamentoId as string}`;
  return { consulta: c, pagamentoId: p!.id as string, idNoProvedor: p!.provedor_id as string };
}

const pendencias = async (pagamentoId: string) => (await banco.$client`select 1 from auditoria where acao = 'pagamento.pendente_de_estorno' and registro_id = ${pagamentoId}`).length;

beforeAll(async () => {
  if (!temBanco) return;
  const opcoes = { autenticar, provedorDeVideo, armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos(), armazenamento };
  ({ app } = await criarServidor({ ambiente: AMBIENTE, ...opcoes }));
  ({ app: appProducao } = await criarServidor({
    ambiente: { ...AMBIENTE, NODE_ENV: "production", PERMITIR_ASSINATURA_SEM_VALOR_LEGAL: true, PERMITIR_VIDEO_SIMULADO: true },
    ...opcoes,
  }));

  const sql = banco.$client;
  for (const id of pessoas) {
    await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
    await sql`insert into perfis (id, nome_completo, cpf) values (${id}, ${`Pessoa ${id.slice(0, 6)}`}, ${id === medico ? cpfDoMedico : null})`;
  }
  await sql`insert into clinicas (id, nome_fantasia, razao_social, cnpj, slug, status, fuso_horario)
    values (${clinicaId}, 'Clinica Disputas', 'Disputas LTDA', ${`${Date.now()}`.slice(-14).padStart(14, "2")}, ${slug}, 'ativa', 'America/Sao_Paulo')`;
  for (const id of pacientes) {
    await sql`insert into pacientes (perfil_id, data_nascimento) values (${id}, '1990-01-01')`;
    await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${id}, ${clinicaId}, 'paciente')`;
    await sql`insert into consentimentos (perfil_id, tipo, acao, versao) values (${id}, 'telemedicina', 'aceito', ${VERSOES_LEGAIS.telemedicina})`;
  }
  const validade = new Date(Date.now() + 86400000 * 300).toISOString();
  for (const [id, crm] of [[medico, `${Date.now()}`.slice(-7)], [medico2, `${Date.now() + 1}`.slice(-7)]] as const) {
    await sql`insert into medicos (perfil_id, crm, crm_uf) values (${id}, ${crm}, 'SP')`;
    await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${id}, ${clinicaId}, 'medico')`;
    await sql`insert into verificacoes_crm (medico_id, clinica_id, resultado, metodo, crm, crm_uf, valido_ate, verificado_por)
      values (${id}, ${clinicaId}, 'verificado', 'consulta_manual_cfm', ${crm}, 'SP', ${validade}::timestamptz, ${admin})`;
    await sql`insert into plantoes (clinica_id, medico_id, inicio, fim, status, aberto_em)
      values (${clinicaId}, ${id}, now() - interval '1 hour', now() + interval '5 hours', 'aberto', now())`;
  }
  await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${admin}, ${clinicaId}, 'admin_clinica'), (${recepcao}, ${clinicaId}, 'recepcao')`;
  await sql`insert into precos (clinica_id, tipo, valor_centavos) values (${clinicaId}, 'agendada', 15000), (${clinicaId}, 'pronto_atendimento', 9000)`;
  for (let d = 0; d < 7; d++) {
    await sql`insert into disponibilidades (clinica_id, medico_id, dia_semana, hora_inicio, hora_fim, duracao_minutos) values (${clinicaId}, ${medico2}, ${d}, '00:00', '23:30', 30)`;
  }
});

afterAll(async () => {
  if (!temBanco) return;
  await app.close();
  await appProducao.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("pedidos ao mesmo tempo", () => {
  it("1. cobranca da consulta: varias rodadas, uma cobranca e nenhum erro", async () => {
    for (let rodada = 0; rodada < 6; rodada++) {
      const c = await novaConsulta({ paciente: pacientes[0]!, status: "aguardando_pagamento", expiraEm: new Date(Date.now() + 15 * 60000) });
      const respostas = await Promise.all(Array.from({ length: 6 }, () => chamar(pacientes[0]!, "POST", `/consultas/${c.id}/pagamento`, { metodo: "pix" })));
      expect(respostas.map((r) => r.statusCode).filter((s) => s >= 300)).toEqual([]);
      expect(new Set(respostas.map((r) => r.json().dados?.pagamentoId)).size).toBe(1);
    }
  });

  it("2. pronto atendimento: varias rodadas, uma cobranca e nenhum erro", async () => {
    for (let rodada = 0; rodada < 6; rodada++) {
      const quem = pacientes[1]!;
      const respostas = await Promise.all(Array.from({ length: 6 }, () => chamar(quem, "POST", "/pagamentos/pronto-atendimento", { metodo: "pix" })));
      expect(respostas.map((r) => r.statusCode).filter((s) => s >= 300)).toEqual([]);
      expect(new Set(respostas.map((r) => r.json().dados?.pagamentoId)).size).toBe(1);
      await banco.$client`update pagamentos set status = 'expirado' where pagador_id = ${quem} and status = 'pendente'`;
    }
  });

  it("3. fila: clique duplo entra uma vez so, sem erro", async () => {
    for (let rodada = 0; rodada < 5; rodada++) {
      const quem = pacientes[2]!;
      const ids = await Promise.all(Array.from({ length: 4 }, () => pagamentoConfirmado(quem)));
      const respostas = await Promise.all(ids.map((pagamentoId) => chamar(quem, "POST", "/fila", { queixa: "febre e tosse ha dois dias", pagamentoId, consentimento: true })));
      expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
      await banco.$client`update fila_atendimento set status = 'desistiu', encerrado_em = now() where paciente_id = ${quem} and status = 'aguardando'`;
    }
  });

  it("4. dois medicos chamando: cada um leva um paciente diferente", async () => {
    const [a, b] = [pacientes[3]!, pacientes[4]!];
    for (const quem of [a, b]) {
      expect((await chamar(quem, "POST", "/fila", { queixa: "dor de garganta forte", pagamentoId: await pagamentoConfirmado(quem), consentimento: true })).statusCode).toBe(201);
    }
    const respostas = await Promise.all([chamar(medico, "POST", "/fila/proximo"), chamar(medico2, "POST", "/fila/proximo")]);
    expect(respostas.map((r) => r.statusCode)).toEqual([200, 200]);
    const chamados = respostas.map((r) => r.json().dados.pacienteId);
    expect(new Set(chamados).size).toBe(2);
    await banco.$client`update consultas set status = 'concluida' where clinica_id = ${clinicaId} and status = 'em_andamento'`;
    await banco.$client`update fila_atendimento set status = 'atendido', encerrado_em = now() where clinica_id = ${clinicaId} and status = 'em_atendimento'`;
  });
});

describe.skipIf(!temBanco)("chamar o proximo", () => {
  it("5. paciente ocupado e pulado; quem vem depois e chamado", async () => {
    const [ocupado, livre] = [pacientes[5]!, pacientes[6]!];
    for (const quem of [ocupado, livre]) {
      expect((await chamar(quem, "POST", "/fila", { queixa: "dor de garganta forte", pagamentoId: await pagamentoConfirmado(quem), consentimento: true })).statusCode).toBe(201);
    }
    const agora = new Date();
    await banco.$client`insert into consultas (clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por)
      values (${clinicaId}, ${ocupado}, ${medico2}, ${agora.toISOString()}::timestamptz, ${new Date(agora.getTime() + 30 * 60000).toISOString()}::timestamptz, 'em_andamento', ${ocupado})`;

    const r = await chamar(medico, "POST", "/fila/proximo");
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.pacienteId).toBe(livre);
    await banco.$client`update consultas set status = 'concluida' where clinica_id = ${clinicaId} and status = 'em_andamento'`;
    await banco.$client`update fila_atendimento set status = 'atendido', encerrado_em = now() where clinica_id = ${clinicaId} and status = 'em_atendimento'`;
  });

  it("6. medico ocupado recebe 409 e a fila nao muda", async () => {
    const agora = new Date();
    const [c] = await banco.$client`insert into consultas (clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por)
      values (${clinicaId}, ${pacientes[7]!}, ${medico}, ${agora.toISOString()}::timestamptz, ${new Date(agora.getTime() + 30 * 60000).toISOString()}::timestamptz, 'em_andamento', ${medico}) returning id`;
    const r = await chamar(medico, "POST", "/fila/proximo");
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("MEDICO_COM_CONSULTA");
    const [f] = await banco.$client`select status from fila_atendimento where paciente_id = ${pacientes[5]!} and clinica_id = ${clinicaId} order by entrou_em desc limit 1`;
    expect(f!.status).toBe("aguardando");
    await banco.$client`update consultas set status = 'concluida' where id = ${c!.id as string}`;
  });
});

describe.skipIf(!temBanco)("pagamento e estorno", () => {
  it("7. aviso atrasado de pendente nao desfaz o confirmado", async () => {
    const { pagamentoId, idNoProvedor } = await pix(pacientes[0]!);
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    await avisarProvedor(idNoProvedor);
    // O provedor simulado volta a dizer "pendente", como um aviso fora de ordem.
    const original = ProvedorLocalDePagamento.prototype.consultar;
    ProvedorLocalDePagamento.prototype.consultar = async (_c, id) => ({ idNoProvedor: id, status: "pendente", bruto: {} });
    try {
      expect((await avisarProvedor(idNoProvedor)).statusCode).toBe(200);
    } finally {
      ProvedorLocalDePagamento.prototype.consultar = original;
    }
    const [p] = await banco.$client`select status from pagamentos where id = ${pagamentoId}`;
    expect(p!.status).toBe("confirmado");
  });

  it("8. cancelar consulta paga registra a pendencia uma vez e avisa a clinica", async () => {
    const { consulta, pagamentoId, idNoProvedor } = await pix(pacientes[0]!);
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    await avisarProvedor(idNoProvedor);
    expect((await chamar(pacientes[0]!, "POST", `/consultas/${consulta.id}/cancelar`, { motivo: "imprevisto de trabalho" })).statusCode).toBe(200);
    expect(await pendencias(pagamentoId)).toBe(1);
    await avisarProvedor(idNoProvedor); // aviso repetido nao duplica
    expect(await pendencias(pagamentoId)).toBe(1);
    const avisos = await banco.$client`select perfil_id from notificacoes where chave = ${`pendente_de_estorno:${pagamentoId}`}`;
    expect(avisos.map((a) => a.perfil_id)).toContain(admin);
  });

  it("9. cancelar consulta nascida da fila registra a pendencia e nao vira atendida", async () => {
    const quem = pacientes[7]!;
    const pagamentoId = await pagamentoConfirmado(quem);
    // Os dois medicos ficam livres; a fila anda ate este paciente.
    await banco.$client`update fila_atendimento set status = 'desistiu', encerrado_em = now() where clinica_id = ${clinicaId} and status = 'aguardando'`;
    expect((await chamar(quem, "POST", "/fila", { queixa: "dor de garganta forte", pagamentoId, consentimento: true })).statusCode).toBe(201);
    const chamada = await chamar(medico, "POST", "/fila/proximo");
    const consultaId = chamada.json().dados.consultaId as string;
    expect((await chamar(medico, "POST", `/consultas/${consultaId}/cancelar`, { motivo: "paciente nao compareceu" })).statusCode).toBe(200);
    expect(await pendencias(pagamentoId)).toBe(1);
    const [f] = await banco.$client`select status from fila_atendimento where consulta_id = ${consultaId}`;
    expect(f!.status).toBe("desistiu");
  });

  it("10. Pix substituido e pago depois confirma a consulta", async () => {
    const { consulta, pagamentoId, idNoProvedor } = await pix(pacientes[1]!);
    await banco.$client`update pagamentos set expira_em = now() - interval '1 minute' where id = ${pagamentoId}`;
    const segunda = await chamar(pacientes[1]!, "POST", `/consultas/${consulta.id}/pagamento`, { metodo: "pix" });
    expect(segunda.json().dados.pagamentoId).not.toBe(pagamentoId);
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    await avisarProvedor(idNoProvedor);
    const [c] = await banco.$client`select status, pagamento_id from consultas where id = ${consulta.id}`;
    expect(c!.status).toBe("agendada");
    expect(c!.pagamento_id).toBe(pagamentoId);
  });

  it("10b. Pix substituido, pago depois do prazo: aviso repetido nao cria pendencia falsa", async () => {
    const { consulta, pagamentoId, idNoProvedor } = await pix(pacientes[1]!);
    await banco.$client`update pagamentos set expira_em = now() - interval '1 minute' where id = ${pagamentoId}`;
    await chamar(pacientes[1]!, "POST", `/consultas/${consulta.id}/pagamento`, { metodo: "pix" });
    await banco.$client`update consultas set expira_reserva_em = now() - interval '1 minute' where id = ${consulta.id}`;
    await liberarReservasVencidas(banco);
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    await avisarProvedor(idNoProvedor);
    await avisarProvedor(idNoProvedor);
    const [c] = await banco.$client`select status from consultas where id = ${consulta.id}`;
    expect(c!.status).toBe("agendada");
    expect(await pendencias(pagamentoId)).toBe(0);
  });

  it("11. estorno no provedor tira da fila e avisa a clinica", async () => {
    const quem = pacientes[2]!;
    const pendente = await chamar(quem, "POST", "/pagamentos/pronto-atendimento", { metodo: "pix" });
    const pagamentoId = pendente.json().dados.pagamentoId as string;
    const [p] = await banco.$client`select provedor_id from pagamentos where id = ${pagamentoId}`;
    const idNoProvedor = p!.provedor_id as string;
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    await avisarProvedor(idNoProvedor);
    expect((await chamar(quem, "POST", "/fila", { queixa: "dor de garganta forte", pagamentoId, consentimento: true })).statusCode).toBe(201);

    const original = ProvedorLocalDePagamento.prototype.consultar;
    ProvedorLocalDePagamento.prototype.consultar = async (_c, id) => ({ idNoProvedor: id, status: "estornado", bruto: {} });
    try {
      await avisarProvedor(idNoProvedor);
    } finally {
      ProvedorLocalDePagamento.prototype.consultar = original;
    }
    const [f] = await banco.$client`select status from fila_atendimento where pagamento_id = ${pagamentoId}`;
    expect(f!.status).toBe("desistiu");
    expect((await banco.$client`select 1 from notificacoes where chave = ${`estorno:${pagamentoId}`} and perfil_id = ${admin}`).length).toBe(1);
  });

  it("12. desistir da fila registra a pendencia", async () => {
    const quem = pacientes[3]!;
    const pagamentoId = await pagamentoConfirmado(quem);
    const entrada = await chamar(quem, "POST", "/fila", { queixa: "dor de garganta forte", pagamentoId, consentimento: true });
    expect((await chamar(quem, "POST", `/fila/${entrada.json().dados.id as string}/desistir`, {})).statusCode).toBe(200);
    expect(await pendencias(pagamentoId)).toBe(1);
  });
});

describe.skipIf(!temBanco)("agenda", () => {
  it("13. marcar num horario com reserva vencida funciona", async () => {
    const inicio = new Date(Math.ceil(Date.now() / 1800000) * 1800000 + 72 * 3600 * 1000);
    const fim = new Date(inicio.getTime() + 30 * 60000);
    await banco.$client`insert into consultas (clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por, expira_reserva_em)
      values (${clinicaId}, ${pacientes[4]!}, ${medico2}, ${inicio.toISOString()}::timestamptz, ${fim.toISOString()}::timestamptz, 'aguardando_pagamento', ${pacientes[4]!}, now() - interval '1 minute')`;
    const r = await chamar(pacientes[5]!, "POST", "/consultas", { medicoId: medico2, inicio: inicio.toISOString() });
    expect(r.statusCode).toBe(201);
  });

  it("14. liberar nao mexe em reserva ainda valida", async () => {
    const c = await novaConsulta({ paciente: pacientes[6]!, status: "aguardando_pagamento", expiraEm: new Date(Date.now() + 10 * 60000) });
    await liberarReservasVencidas(banco);
    const [l] = await banco.$client`select status from consultas where id = ${c.id}`;
    expect(l!.status).toBe("aguardando_pagamento");
  });
});

describe.skipIf(!temBanco)("sala de video", () => {
  it("15. encerrar nao conclui consulta futura sem sala", async () => {
    const c = await novaConsulta({ paciente: pacientes[6]! });
    const r = await chamar(medico, "POST", `/consultas/${c.id}/sala/encerrar`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("SALA_NAO_ABERTA");
    const [l] = await banco.$client`select status from consultas where id = ${c.id}`;
    expect(l!.status).toBe("agendada");
  });

  it("16. sala encerrada nao chama o provedor de novo", async () => {
    const agora = new Date(Date.now() + 2 * 60000);
    const id = randomUUID();
    await banco.$client`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por)
      values (${id}, ${clinicaId}, ${pacientes[4]!}, ${medico2}, ${agora.toISOString()}::timestamptz, ${new Date(agora.getTime() + 30 * 60000).toISOString()}::timestamptz, 'em_andamento', ${pacientes[4]!})`;
    expect((await chamar(pacientes[4]!, "POST", `/consultas/${id}/sala`)).statusCode).toBe(200);
    expect((await chamar(medico2, "POST", `/consultas/${id}/sala/encerrar`)).statusCode).toBe(200);
    // A consulta volta a parecer aberta: so a sala encerrada pode barrar a entrada,
    // e sem falar com o provedor, senao a sala renasceria la.
    await banco.$client`update consultas set status = 'em_andamento' where id = ${id}`;
    const criarSala = vi.spyOn(provedorDeVideo, "criarSala");
    const r = await chamar(pacientes[4]!, "POST", `/consultas/${id}/sala`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("SALA_ENCERRADA");
    expect(criarSala).not.toHaveBeenCalled();
    criarSala.mockRestore();
    await banco.$client`update consultas set status = 'concluida' where id = ${id}`;
  });
});

describe.skipIf(!temBanco)("equipe e configuracao", () => {
  it("17. convite antigo nao desfaz a suspensao", async () => {
    const r = await chamar(admin, "POST", "/convites", { email: `${recepcao}@teste.local`, papel: "admin_clinica" });
    const codigo = (r.json().dados.linkDeAceite as string).split("/").pop()!;
    // O papel convidado ja existe e esta suspenso.
    await banco.$client`insert into vinculos (perfil_id, clinica_id, papel, status) values (${recepcao}, ${clinicaId}, 'admin_clinica', 'suspenso')`;
    await banco.$client`update vinculos set status = 'suspenso' where perfil_id = ${recepcao} and clinica_id = ${clinicaId}`;

    const aceite = await chamar(recepcao, "POST", "/convites/aceitar", { codigo }, false);
    expect(aceite.statusCode).toBe(409);
    expect(aceite.json().erro.codigo).toBe("VINCULO_SUSPENSO");
    expect((await chamar(recepcao, "GET", "/membros")).statusCode).toBe(403);
    await banco.$client`delete from vinculos where perfil_id = ${recepcao} and clinica_id = ${clinicaId} and papel = 'admin_clinica'`;
    await banco.$client`update vinculos set status = 'ativo' where perfil_id = ${recepcao} and clinica_id = ${clinicaId}`;
  });

  it("18. a rota recusa provedor de assinatura em endereco nao autorizado", async () => {
    const r = await chamar(admin, "PUT", "/clinicas/atual/assinatura", { provedor: "birdid", url: "https://atacante.example", clientId: "x", clientSecret: "y" });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro.codigo).toBe("URL_NAO_AUTORIZADA");
  });
});

describe.skipIf(!temBanco)("em producao", () => {
  const naProducao = (quem: string, method: "GET" | "POST", url: string, payload?: unknown) => chamar(quem, method, url, payload, true, appProducao);

  it("19. cartao e recusado", async () => {
    const c = await novaConsulta({ paciente: pacientes[6]!, status: "aguardando_pagamento", expiraEm: new Date(Date.now() + 10 * 60000) });
    const r = await naProducao(pacientes[6]!, "POST", `/consultas/${c.id}/pagamento`, { metodo: "cartao_credito", tokenDoCartao: "tok" });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("CARTAO_INDISPONIVEL");
  });

  it("20. sem conta de recebimento, a consulta e agendada direto", async () => {
    const inicio = new Date(Math.ceil(Date.now() / 1800000) * 1800000 + 96 * 3600 * 1000);
    const r = await naProducao(pacientes[6]!, "POST", "/consultas", { medicoId: medico2, inicio: inicio.toISOString() });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados.status).toBe("agendada");
  });

  it("21. /saude nao lista as tabelas, e a fila diz que nao ha como pagar", async () => {
    const saude = (await appProducao.inject({ method: "GET", url: "/saude" })).json().dados;
    expect(saude.banco.tabelas).toEqual([]);
    expect(saude.seguranca.tabelasSemRls).toEqual([]);
    expect((await naProducao(pacientes[6]!, "GET", "/fila")).json().dados.pagamentoDisponivel).toBe(false);
  });

  it("22. o simulado nao entra no webhook de producao", async () => {
    const { corpo, cabecalhos } = ProvedorLocalDePagamento.montarNotificacao("local_x", AMBIENTE.PAGAMENTO_WEBHOOK_SEGREDO);
    const r = await appProducao.inject({ method: "POST", url: "/webhooks/pagamento", headers: { ...cabecalhos, "content-type": "application/json" }, payload: corpo });
    expect(r.statusCode).toBe(401);
  });
});

describe.skipIf(!temBanco)("assinatura", () => {
  async function documento() {
    const c = await novaConsulta({ paciente: pacientes[6]! });
    const r = await chamar(medico, "POST", "/documentos", { consultaId: c.id, tipo: "receita_simples", conteudo: { itens: [{ medicamento: "Dipirona 500 mg", posologia: "1 comprimido se dor" }] } });
    return r.json().dados as { id: string; codigoValidacao: string };
  }
  const assinar = (id: string) => chamar(medico, "POST", `/documentos/${id}/assinar`, { cpf: cpfDoMedico, otp: ProvedorLocalDeTeste.OTP_DE_TESTE });

  it("23. assinatura nao desfaz um cancelamento feito no meio do caminho", async () => {
    const d = await documento();
    duranteGuardar = async () => {
      await banco.$client`update documentos set status = 'cancelado', cancelado_em = now(), cancelado_por = ${medico}, motivo_cancelamento = 'cancelado durante o envio' where id = ${d.id}`;
    };
    try {
      const r = await assinar(d.id);
      expect(r.statusCode).toBe(409);
      expect(r.json().erro.codigo).toBe("ESTADO_MUDOU");
    } finally {
      duranteGuardar = null;
    }
    const [l] = await banco.$client`select status from documentos where id = ${d.id}`;
    expect(l!.status).toBe("cancelado");
  });

  it("23b. medico sem CPF cadastra uma vez em Minha conta e assina", async () => {
    const d = await documento();
    await banco.$client`update perfis set cpf = null where id = ${medico}`;
    const semCpf = await assinar(d.id);
    expect(semCpf.statusCode).toBe(400);
    expect(semCpf.json().erro.codigo).toBe("CPF_NECESSARIO");

    expect((await chamar(medico, "PATCH", "/perfis/eu", { cpf: "12345678900" }, false)).statusCode).toBe(400);
    expect((await chamar(medico, "PATCH", "/perfis/eu", { cpf: cpfDoMedico }, false)).statusCode).toBe(200);
    expect((await assinar(d.id)).statusCode).toBe(200);

    const outro = cpfDoMedico === "52998224725" ? "11144477735" : "52998224725";
    const troca = await chamar(medico, "PATCH", "/perfis/eu", { cpf: outro }, false);
    expect(troca.statusCode).toBe(409);
    expect(troca.json().erro.codigo).toBe("CPF_JA_CADASTRADO");
  });

  it("24. PDF de documento cancelado nao e entregue, e a validacao avisa sobre a cadeia", async () => {
    const d = await documento();
    expect((await assinar(d.id)).statusCode).toBe(200);
    const valida = (await app.inject({ method: "GET", url: `/validar/${d.codigoValidacao}` })).json().dados;
    expect(valida.valido).toBe(true);
    expect(valida.cadeiaIcpConferida).toBe(false);

    expect((await chamar(medico, "POST", `/documentos/${d.id}/cancelar`, { motivo: "emitido por engano" })).statusCode).toBe(200);
    const r = await chamar(medico, "GET", `/documentos/${d.id}/arquivo`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("CANCELADO");
  });
});
