/**
 * =====================================================================
 * PROTECOES DA AUDITORIA DE MERCADO (ADR-0021) - CONTRA O POSTGRES
 * =====================================================================
 *
 *   - dado de saude: recepcao e administracao nao leem queixa nem motivo
 *   - equipe: suspender corta o acesso na hora; ultimo admin nao sai
 *   - convite: so o e-mail convidado aceita, e uma vez so
 *   - reserva vencida: libera o horario de verdade e nao pode ser paga
 *   - cobranca: pedidos simultaneos geram UMA cobranca
 *   - webhook: aviso atrasado nao desfaz; pagamento tardio nao some
 *   - sala: encerrada nao reabre; paciente sem termo nao entra
 *   - assinatura: URL de provedor so para hosts autorizados
 *
 * Precisa de DATABASE_URL; sem ele os testes sao pulados.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBanco } from "@tele/db";
import { VERSOES_LEGAIS } from "@tele/shared/lgpd";
import type { Ambiente } from "./ambiente.js";
import { ArmazenamentoEmMemoriaDeAnexos } from "./anexos/armazenamento.js";
import { urlDeAssinaturaPermitida } from "./assinatura/resolvedor.js";
import { ProvedorLocalDePagamento } from "./pagamento/provedor-local.js";
import { encerrarAtendimentosAbandonados, liberarReservasVencidas } from "./reservas.js";
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
  DB_POOL_MAX: 5,
  LIMITE_POR_MINUTO: 10000,
  PAGAMENTO_WEBHOOK_SEGREDO: "segredo-de-teste-do-webhook",
} satisfies Ambiente;

const paciente = randomUUID();
const paciente2 = randomUUID();
const medico = randomUUID();
const admin = randomUUID();
const admin2 = randomUUID();
const recepcao = randomUUID();
const clinicaId = randomUUID();
const slug = `teste-protecoes-${Date.now()}`;
const pessoas: string[] = [paciente, paciente2, medico, admin, admin2, recepcao];

const emailDe = (id: string) => `${id}@teste.local`;
const autenticar = async (token: string) => (pessoas.includes(token) ? { id: token, email: emailDe(token) } : null);

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
const banco = temBanco ? criarBanco(DATABASE_URL!, { max: 2 }) : (null as never);

function chamar(quem: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown, naClinica = true) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${quem}`, ...(naClinica ? { "x-clinica": slug } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload: payload as object } : {}),
  });
}

const umDiaNoFuturo = () => new Date(Date.now() + 24 * 3600 * 1000);

/** Consulta direto no banco, para colocar a agenda no estado que cada teste precisa. */
async function novaConsulta(d: { paciente: string; horasAFrente: number; status?: string; expiraEm?: Date | null; motivo?: string }) {
  const id = randomUUID();
  const inicio = new Date(umDiaNoFuturo().getTime() + d.horasAFrente * 3600 * 1000);
  const fim = new Date(inicio.getTime() + 30 * 60000);
  const sql = banco.$client;
  await sql`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, motivo, marcado_por, expira_reserva_em)
    values (${id}, ${clinicaId}, ${d.paciente}, ${medico}, ${inicio.toISOString()}::timestamptz, ${fim.toISOString()}::timestamptz, ${d.status ?? "agendada"}, ${d.motivo ?? null}, ${d.paciente}, ${d.expiraEm ? d.expiraEm.toISOString() : null}::timestamptz)`;
  return { id, inicio, fim };
}

beforeAll(async () => {
  if (!temBanco) return;
  ({ app } = await criarServidor({
    ambiente: AMBIENTE,
    autenticar,
    provedorDeVideo: new ProvedorLocalDeVideo(),
    armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos(),
  }));

  const sql = banco.$client;
  for (const id of pessoas) {
    await sql`insert into auth.users (id, email) values (${id}, ${emailDe(id)})`;
    await sql`insert into perfis (id, nome_completo) values (${id}, ${`Pessoa ${id.slice(0, 6)}`})`;
  }
  await sql`insert into clinicas (id, nome_fantasia, razao_social, cnpj, slug, status)
    values (${clinicaId}, 'Clinica Protecoes', 'Protecoes LTDA', ${`${Date.now()}`.slice(-14).padStart(14, "1")}, ${slug}, 'ativa')`;
  for (const id of [paciente, paciente2]) {
    await sql`insert into pacientes (perfil_id, data_nascimento) values (${id}, '1990-01-01')`;
    await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${id}, ${clinicaId}, 'paciente')`;
    await sql`insert into consentimentos (perfil_id, tipo, acao, versao) values (${id}, 'telemedicina', 'aceito', ${VERSOES_LEGAIS.telemedicina})`;
  }
  await sql`insert into medicos (perfil_id, crm, crm_uf) values (${medico}, ${`${Date.now()}`.slice(-7)}, 'SP')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${medico}, ${clinicaId}, 'medico')`;
  await sql`insert into verificacoes_crm (medico_id, clinica_id, resultado, metodo, crm, crm_uf, valido_ate, verificado_por)
    values (${medico}, ${clinicaId}, 'verificado', 'consulta_manual_cfm', '1', 'SP', ${new Date(Date.now() + 86400000 * 300).toISOString()}::timestamptz, ${admin})`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${admin}, ${clinicaId}, 'admin_clinica')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel) values (${recepcao}, ${clinicaId}, 'recepcao')`;
  await sql`insert into precos (clinica_id, tipo, valor_centavos) values (${clinicaId}, 'agendada', 15000), (${clinicaId}, 'pronto_atendimento', 9000)`;
});

afterAll(async () => {
  if (!temBanco) return;
  const sql = banco.$client;
  // A clinica fica de fora de proposito: auditoria nao se apaga, e isolamos pelos ids novos.
  await sql`delete from fila_atendimento where clinica_id = ${clinicaId}`;
  await sql`update consultas set pagamento_id = null where clinica_id = ${clinicaId}`;
  await sql`delete from pagamentos where clinica_id = ${clinicaId}`;
  await sql`delete from salas_de_video where clinica_id = ${clinicaId}`;
  await sql`delete from consultas where clinica_id = ${clinicaId}`;
  await app.close();
  await sql.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("dado de saude nao vaza para quem nao atende", () => {
  it("1. recepcao e administracao nao leem o motivo; medico e paciente da consulta leem", async () => {
    const c = await novaConsulta({ paciente, horasAFrente: 1, motivo: "dor no peito ao respirar" });
    const de = c.inicio.toISOString().slice(0, 10);
    const motivoPara = async (quem: string) => ((await chamar(quem, "GET", `/consultas?de=${de}&ate=${de}`)).json().dados as { id: string; motivo: string | null }[]).find((x) => x.id === c.id)?.motivo;
    expect(await motivoPara(recepcao)).toBeNull();
    expect(await motivoPara(admin)).toBeNull();
    expect(await motivoPara(medico)).toBe("dor no peito ao respirar");
    expect(await motivoPara(paciente)).toBe("dor no peito ao respirar");
  });
});

describe.skipIf(!temBanco)("reserva vencida", () => {
  it("2. libera o horario de verdade, inclusive na trava do banco", async () => {
    const vencida = await novaConsulta({ paciente, horasAFrente: 3, status: "aguardando_pagamento", expiraEm: new Date(Date.now() - 60000) });
    // Antes da correcao, a trava de exclusao recusava este insert para sempre.
    await expect(novaConsulta({ paciente: paciente2, horasAFrente: 3 })).rejects.toThrow();
    expect(await liberarReservasVencidas(banco)).toBeGreaterThanOrEqual(1);
    const [c] = await banco.$client`select status from consultas where id = ${vencida.id}`;
    expect(c!.status).toBe("cancelada");
    await expect(novaConsulta({ paciente: paciente2, horasAFrente: 3 })).resolves.toBeTruthy();
  });

  it("3. nao pode ser paga", async () => {
    const c = await novaConsulta({ paciente, horasAFrente: 6, status: "aguardando_pagamento", expiraEm: new Date(Date.now() - 60000) });
    const r = await chamar(paciente, "POST", `/consultas/${c.id}/pagamento`, { metodo: "pix" });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("RESERVA_VENCIDA");
  });
});

describe.skipIf(!temBanco)("cobranca", () => {
  it("4. pedidos simultaneos geram uma so cobranca", async () => {
    const c = await novaConsulta({ paciente, horasAFrente: 9, status: "aguardando_pagamento", expiraEm: new Date(Date.now() + 15 * 60000) });
    const respostas = await Promise.all([1, 2, 3].map(() => chamar(paciente, "POST", `/consultas/${c.id}/pagamento`, { metodo: "pix" })));
    const ids = new Set(respostas.map((r) => r.json().dados?.pagamentoId));
    expect(ids.size).toBe(1);
    const linhas = await banco.$client`select id from pagamentos where consulta_id = ${c.id}`;
    expect(linhas.length).toBe(1);
  });

  it("5. o Pix nao vale mais que o tempo restante da reserva", async () => {
    const c = await novaConsulta({ paciente, horasAFrente: 12, status: "aguardando_pagamento", expiraEm: new Date(Date.now() + 5 * 60000) });
    const r = await chamar(paciente, "POST", `/consultas/${c.id}/pagamento`, { metodo: "pix" });
    const expira = new Date(r.json().dados.expiraEm as string).getTime();
    expect(expira).toBeLessThanOrEqual(Date.now() + 5 * 60000 + 5000);
  });

  it("6. pronto atendimento: pedidos simultaneos geram uma so cobranca", async () => {
    const respostas = await Promise.all([1, 2].map(() => chamar(paciente2, "POST", "/pagamentos/pronto-atendimento", { metodo: "pix" })));
    expect(new Set(respostas.map((r) => r.json().dados?.pagamentoId)).size).toBe(1);
  });
});

describe.skipIf(!temBanco)("webhook", () => {
  async function pagar(horasAFrente: number) {
    const c = await novaConsulta({ paciente, horasAFrente, status: "aguardando_pagamento", expiraEm: new Date(Date.now() + 15 * 60000) });
    const r = await chamar(paciente, "POST", `/consultas/${c.id}/pagamento`, { metodo: "pix" });
    const [p] = await banco.$client`select id, provedor_id from pagamentos where id = ${r.json().dados.pagamentoId as string}`;
    return { consulta: c, pagamentoId: p!.id as string, idNoProvedor: p!.provedor_id as string };
  }
  function avisar(idNoProvedor: string) {
    const { corpo, cabecalhos } = ProvedorLocalDePagamento.montarNotificacao(idNoProvedor, AMBIENTE.PAGAMENTO_WEBHOOK_SEGREDO);
    return app.inject({ method: "POST", url: "/webhooks/pagamento", headers: { ...cabecalhos, "content-type": "application/json" }, payload: corpo });
  }

  it("7. pagamento confirmado agenda a consulta, e aviso repetido nao muda nada", async () => {
    const { consulta, idNoProvedor } = await pagar(15);
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    expect((await avisar(idNoProvedor)).statusCode).toBe(200);
    expect((await avisar(idNoProvedor)).statusCode).toBe(200);
    const [c] = await banco.$client`select status from consultas where id = ${consulta.id}`;
    expect(c!.status).toBe("agendada");
  });

  it("8. pagamento tardio com horario livre: a consulta volta", async () => {
    const { consulta, pagamentoId, idNoProvedor } = await pagar(18);
    await banco.$client`update consultas set expira_reserva_em = now() - interval '1 minute' where id = ${consulta.id}`;
    await liberarReservasVencidas(banco);
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    await avisar(idNoProvedor);
    const [c] = await banco.$client`select status from consultas where id = ${consulta.id}`;
    expect(c!.status).toBe("agendada");
    const [p] = await banco.$client`select status from pagamentos where id = ${pagamentoId}`;
    expect(p!.status).toBe("confirmado");
  });

  it("9. pagamento tardio com horario ocupado: vira pendencia e avisa os dois lados", async () => {
    const { consulta, pagamentoId, idNoProvedor } = await pagar(21);
    await banco.$client`update consultas set expira_reserva_em = now() - interval '1 minute' where id = ${consulta.id}`;
    await liberarReservasVencidas(banco);
    await novaConsulta({ paciente: paciente2, horasAFrente: 21 }); // alguem pegou o horario
    ProvedorLocalDePagamento.confirmarNoBanco(idNoProvedor);
    expect((await avisar(idNoProvedor)).statusCode).toBe(200);

    const [c] = await banco.$client`select status from consultas where id = ${consulta.id}`;
    expect(c!.status).toBe("cancelada");
    const auditoria = await banco.$client`select 1 from auditoria where acao = 'pagamento.pendente_de_estorno' and registro_id = ${pagamentoId}`;
    expect(auditoria.length).toBe(1);
    const avisos = await banco.$client`select perfil_id from notificacoes where chave = ${`pendente_de_estorno:${pagamentoId}`}`;
    expect(avisos.map((a) => a.perfil_id).sort()).toEqual([admin, paciente].sort());
  });

  it("10. aviso de pagamento desconhecido pede reenvio, em vez de se perder", async () => {
    expect((await avisar(`local_${randomUUID()}`)).statusCode).toBe(404);
  });

  it("11. assinatura errada no aviso e recusada", async () => {
    const r = await app.inject({ method: "POST", url: "/webhooks/pagamento", headers: { "x-assinatura": "x".repeat(64), "content-type": "application/json" }, payload: JSON.stringify({ id: "qualquer" }) });
    expect(r.statusCode).toBe(401);
  });
});

describe.skipIf(!temBanco)("fila", () => {
  const entrarNaFila = async (quem: string) => {
    const [p] = await banco.$client`
      insert into pagamentos (clinica_id, pagador_id, metodo, status, valor_centavos, valor_clinica_centavos, valor_plataforma_centavos, provedor, chave_idempotencia, confirmado_em)
      values (${clinicaId}, ${quem}, 'pix', 'confirmado', 9000, 9000, 0, 'local_teste', ${randomUUID()}, now()) returning id`;
    return p!.id as string;
  };

  it("12. recepcao nao le a queixa; medico le", async () => {
    const pagamentoId = await entrarNaFila(paciente);
    const r = await chamar(paciente, "POST", "/fila", { queixa: "febre e tosse ha dois dias", pagamentoId, consentimento: true });
    expect(r.statusCode).toBe(201);

    const queixa = async (quem: string) => ((await chamar(quem, "GET", "/fila")).json().dados.lista as { queixa: string | null }[])[0]?.queixa;
    expect(await queixa(recepcao)).toBeNull();
    expect(await queixa(admin)).toBeNull();
    expect(await queixa(medico)).toBe("febre e tosse ha dois dias");
  });

  it("13. clique duplo nao coloca o paciente duas vezes na fila", async () => {
    const pagamentoId = await entrarNaFila(paciente);
    const r = await chamar(paciente, "POST", "/fila", { queixa: "febre e tosse ha dois dias", pagamentoId, consentimento: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("JA_NA_FILA");
  });

  it("14. atendimento encerrado libera o paciente da fila", async () => {
    await banco.$client`update fila_atendimento set status = 'em_atendimento', chamado_em = now() - interval '7 hours' where clinica_id = ${clinicaId} and status = 'aguardando'`;
    expect(await encerrarAtendimentosAbandonados(banco)).toBeGreaterThanOrEqual(1);
    const ativas = await banco.$client`select 1 from fila_atendimento where clinica_id = ${clinicaId} and status in ('aguardando', 'chamado', 'em_atendimento')`;
    expect(ativas.length).toBe(0);
  });
});

describe.skipIf(!temBanco)("sala de video", () => {
  it("15. paciente sem o termo de telemedicina nao entra; depois de aceitar, entra", async () => {
    const agora = new Date(Date.now() + 5 * 60000);
    const id = randomUUID();
    await banco.$client`insert into consentimentos (perfil_id, tipo, acao, versao) values (${paciente2}, 'telemedicina', 'revogado', ${VERSOES_LEGAIS.telemedicina})`;
    await banco.$client`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por)
      values (${id}, ${clinicaId}, ${paciente2}, ${medico}, ${agora.toISOString()}::timestamptz, ${new Date(agora.getTime() + 30 * 60000).toISOString()}::timestamptz, 'agendada', ${paciente2})`;

    const recusada = await chamar(paciente2, "POST", `/consultas/${id}/sala`);
    expect(recusada.statusCode).toBe(403);
    expect(recusada.json().erro.codigo).toBe("CONSENTIMENTO_PENDENTE");

    await chamar(paciente2, "POST", "/lgpd/consentimentos", { tipos: ["telemedicina"] }, false);
    expect((await chamar(paciente2, "POST", `/consultas/${id}/sala`)).statusCode).toBe(200);
  });

  it("16. sala encerrada nao reabre, e a consulta agendada fica concluida", async () => {
    const [c] = await banco.$client`select id from consultas where paciente_id = ${paciente2} and clinica_id = ${clinicaId} and status = 'agendada' and inicio < now() + interval '10 minutes'`;
    const id = c!.id as string;
    expect((await chamar(medico, "POST", `/consultas/${id}/sala/encerrar`)).statusCode).toBe(200);
    const [depois] = await banco.$client`select status from consultas where id = ${id}`;
    expect(depois!.status).toBe("concluida");
    const r = await chamar(paciente2, "POST", `/consultas/${id}/sala`);
    expect(r.statusCode).toBe(409);
  });
});

describe.skipIf(!temBanco)("equipe", () => {
  it("17. convite: outro e-mail nao aceita; o convidado aceita uma vez so", async () => {
    const r = await chamar(admin, "POST", "/convites", { email: emailDe(admin2), papel: "admin_clinica" });
    const codigo = (r.json().dados.linkDeAceite as string).split("/").pop()!;

    const deOutro = await chamar(paciente, "POST", "/convites/aceitar", { codigo }, false);
    expect(deOutro.statusCode).toBe(403);
    expect(deOutro.json().erro.codigo).toBe("CONVITE_DE_OUTRA_PESSOA");

    const respostas = await Promise.all([1, 2].map(() => chamar(admin2, "POST", "/convites/aceitar", { codigo }, false)));
    expect(respostas.map((x) => x.statusCode).sort()).toEqual([200, 404]);
    expect(createHash("sha256").update(codigo).digest("hex")).toHaveLength(64);
  });

  it("18. suspender corta o acesso na hora, e reativar devolve", async () => {
    expect((await chamar(recepcao, "GET", "/membros")).statusCode).toBe(200);
    expect((await chamar(admin, "POST", `/membros/${recepcao}/suspender`)).statusCode).toBe(200);
    const bloqueada = await chamar(recepcao, "GET", "/membros");
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json().erro.codigo).toBe("SEM_VINCULO");
    expect((await chamar(admin, "POST", `/membros/${recepcao}/reativar`)).statusCode).toBe(200);
    expect((await chamar(recepcao, "GET", "/membros")).statusCode).toBe(200);
  });

  it("19. so a administracao suspende", async () => {
    expect((await chamar(recepcao, "POST", `/membros/${admin}/suspender`)).statusCode).toBe(403);
  });

  it("20. a ultima pessoa que administra nao pode ser suspensa", async () => {
    expect((await chamar(admin, "POST", `/membros/${admin2}/suspender`)).statusCode).toBe(200);
    const r = await chamar(admin, "POST", `/membros/${admin}/suspender`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("ULTIMO_ADMIN");
  });
});

describe("provedor de assinatura", () => {
  const base = { ASSINATURA_URL: "https://api.birdid.com.br/v1", ASSINATURA_HOSTS_PERMITIDOS: "homologacao.birdid.com.br" };

  it("21. aceita so https e so hosts autorizados", () => {
    expect(urlDeAssinaturaPermitida("https://api.birdid.com.br/x", base)).toBe(true);
    expect(urlDeAssinaturaPermitida("https://homologacao.birdid.com.br", base)).toBe(true);
    for (const ruim of ["http://api.birdid.com.br", "https://atacante.example", "https://169.254.169.254/latest", "https://api.birdid.com.br.atacante.example", "isto nao e url"]) {
      expect(urlDeAssinaturaPermitida(ruim, base), ruim).toBe(false);
    }
    expect(urlDeAssinaturaPermitida("https://api.birdid.com.br", {})).toBe(false);
  });
});
