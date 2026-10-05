/**
 * =====================================================================
 * TESTES DA SALA DE VIDEO - CONTRA O POSTGRES DE VERDADE
 * =====================================================================
 *
 * Os outros testes desta pasta sao de validacao: dao um objeto errado e
 * conferem a recusa. Estes sao diferentes - eles criam clinica, medico,
 * dois pacientes e consultas no banco, e depois perguntam a API as coisas
 * que importam:
 *
 *   - quem NAO e da consulta recebe 403?
 *   - a janela de horario e respeitada?
 *   - o medico entra como anfitriao e o paciente nao?
 *   - so o medico encerra?
 *   - encerrar apaga a sala no provedor?
 *
 * Por que com banco de verdade e nao com o banco simulado: a regra que este
 * modulo precisa provar e de ACESSO, e acesso depende de linha de banco -
 * quem e o paciente daquela consulta, quem e o medico. Teste com banco
 * falso provaria que o codigo chama as funcoes na ordem certa, nao que a
 * pessoa errada e barrada.
 *
 * Inclui tambem a regressao do vazamento que este modulo corrigiu em
 * GET /consultas (ver o comentario longo em rotas/agenda.ts).
 *
 * Precisa de DATABASE_URL apontando para um Postgres com as migracoes
 * aplicadas. Sem isso, os testes sao pulados em vez de falhar: nao e culpa
 * de quem rodou.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBanco } from "@tele/db";
import type { Ambiente } from "./ambiente.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);

const AMBIENTE = {
  NODE_ENV: "test" as const,
  PORT: 3999,
  SUPABASE_URL: "https://exemplo.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_1234567890abcdefghijklmnop",
  DATABASE_URL: DATABASE_URL ?? "postgresql://nao/usado",
  ORIGEM_PERMITIDA: "http://localhost:3000",
  ASSINATURA_PROVEDOR: "local_teste" as const,
  PERMITIR_ASSINATURA_SEM_VALOR_LEGAL: false,
  VIDEO_PROVEDOR: "local_teste" as const,
  PERMITIR_VIDEO_SIMULADO: false,
} satisfies Ambiente;

/** Os personagens. Os ids sao fixos por execucao e limpos no fim. */
const medicoId = randomUUID();
const pacienteId = randomUUID();
const outroPacienteId = randomUUID();
const clinicaId = randomUUID();
const slug = `teste-video-${Date.now()}`;

/** Consultas do cenario. */
const consultaAgora = randomUUID();
const consultaAmanha = randomUUID();
const consultaCancelada = randomUUID();
const consultaDoOutro = randomUUID();

/** O token de cada um e o proprio id - o autenticador falso so devolve ele. */
const pessoas: string[] = [medicoId, pacienteId, outroPacienteId];
const autenticarFalso = async (token: string) =>
  pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null;

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let provedor: ProvedorLocalDeVideo;
let banco: ReturnType<typeof criarBanco>;

async function entrar(consultaId: string, quem: string) {
  return app.inject({
    method: "POST",
    url: `/consultas/${consultaId}/sala`,
    headers: { authorization: `Bearer ${quem}`, "x-clinica": slug },
  });
}

beforeAll(async () => {
  if (!temBanco) return;
  banco = criarBanco(DATABASE_URL!);
  const sql = banco.$client;

  // auth.users primeiro: perfis tem chave estrangeira para la (Modulo 4).
  for (const id of [medicoId, pacienteId, outroPacienteId]) {
    await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
  }
  await sql`
    insert into perfis (id, nome_completo)
    values (${medicoId}, 'Dra. Teste'), (${pacienteId}, 'Paciente Um'), (${outroPacienteId}, 'Paciente Dois')
  `;
  await sql`insert into medicos (perfil_id, crm, crm_uf) values (${medicoId}, '123456', 'MG')`;
  await sql`
    insert into pacientes (perfil_id, data_nascimento)
    values (${pacienteId}, '1990-01-01'), (${outroPacienteId}, '1985-05-05')
  `;
  await sql`
    insert into clinicas (id, slug, nome_fantasia, razao_social, cnpj, status, fuso_horario)
    values (${clinicaId}, ${slug}, 'Clinica Teste', 'Clinica Teste LTDA', ${String(Date.now()).slice(-14).padStart(14, "1")}, 'ativa', 'America/Sao_Paulo')
  `;
  await sql`
    insert into vinculos (perfil_id, clinica_id, papel, status) values
      (${medicoId}, ${clinicaId}, 'medico', 'ativo'),
      (${pacienteId}, ${clinicaId}, 'paciente', 'ativo'),
      (${outroPacienteId}, ${clinicaId}, 'paciente', 'ativo')
  `;

  /**
   * Em texto ISO, nao como Date: num insert com varias linhas o driver nao
   * consegue adivinhar o tipo do parametro e recusa o Date. Texto ISO o
   * Postgres converte sozinho para timestamptz.
   */
  const quando = (minutos: number) => new Date(Date.now() + minutos * 60_000).toISOString();
  /**
   * Os horarios sao escalonados de proposito. O Modulo 7 criou duas travas
   * EXCLUDE no banco: o mesmo medico (e o mesmo paciente) nao pode ter duas
   * consultas que se sobrepoem. Elas pegaram a primeira versao deste seed, e
   * tambem isso e o trabalho delas - eram duas consultas 'em_andamento' no
   * mesmo horario com o mesmo medico, o que na vida real seria agenda
   * sobrevendida.
   *
   * A cancelada pode sobrepor: as travas valem so para
   * aguardando_pagamento, agendada e em_andamento.
   *
   * `consultaDoOutro` fica no passado recente, mas AINDA DENTRO da janela de
   * entrada (que fecha 30 min depois do fim) - o teste 11 precisa entrar
   * nela antes de encerra-la.
   */
  const agora = quando(0);
  const maisMeiaHora = quando(30);
  const amanha = quando(1440);
  const amanhaMaisMeiaHora = quando(1470);
  const faz60Minutos = quando(-60);
  const faz5Minutos = quando(-5);

  await sql`
    insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, motivo) values
      (${consultaAgora},   ${clinicaId}, ${pacienteId},      ${medicoId}, ${agora},       ${maisMeiaHora}, 'em_andamento', 'Pronto atendimento'),
      (${consultaAmanha},  ${clinicaId}, ${pacienteId},      ${medicoId}, ${amanha}, ${amanhaMaisMeiaHora}, 'agendada',     'Retorno'),
      (${consultaDoOutro}, ${clinicaId}, ${outroPacienteId}, ${medicoId}, ${faz60Minutos}, ${faz5Minutos},  'em_andamento', 'Dor de cabeca')
  `;

  /**
   * A cancelada vai em insert proprio, com autor, data e motivo JUNTOS.
   * O banco recusa o contrario - o check `consultas_cancelamento_completo`
   * do Modulo 7 nao deixa existir cancelamento sem quem e quando. Ele pegou
   * este teste na primeira tentativa, que e exatamente o trabalho dele.
   */
  await sql`
    insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, motivo, cancelado_em, cancelado_por, motivo_cancelamento)
    values (${consultaCancelada}, ${clinicaId}, ${pacienteId}, ${medicoId}, ${agora}, ${maisMeiaHora}, 'cancelada', 'Desmarcada', ${agora}, ${medicoId}, 'teste')
  `;

  provedor = new ProvedorLocalDeVideo();
  ({ app } = await criarServidor({ ambiente: AMBIENTE, autenticar: autenticarFalso, provedorDeVideo: provedor }));
});

afterAll(async () => {
  if (!temBanco) return;
  const sql = banco.$client;
  // Ordem inversa das dependencias. auth.users leva perfis por cascata.
  await sql`delete from salas_de_video where clinica_id = ${clinicaId}`;
  await sql`delete from auditoria where clinica_id = ${clinicaId}`;
  await sql`delete from consultas where clinica_id = ${clinicaId}`;
  await sql`delete from vinculos where clinica_id = ${clinicaId}`;
  await sql`delete from clinicas where id = ${clinicaId}`;
  await sql`delete from auth.users where id in ${sql([medicoId, pacienteId, outroPacienteId])}`;
  await app?.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("sala de video: quem entra", () => {
  it("1. o paciente da consulta entra, e NAO como anfitriao", async () => {
    const r = await entrar(consultaAgora, pacienteId);
    expect(r.statusCode).toBe(200);
    const { dados } = r.json();
    expect(dados.papel).toBe("participante");
    expect(dados.videoReal).toBe(false);
    // A tela precisa saber com quem a pessoa vai falar.
    expect(dados.outraPessoa).toMatchObject({ papel: "medico", nome: "Dra. Teste" });
  });

  it("2. o medico da consulta entra como anfitriao", async () => {
    const r = await entrar(consultaAgora, medicoId);
    expect(r.statusCode).toBe(200);
    expect(r.json().dados.papel).toBe("anfitriao");
  });

  it("3. os dois caem na MESMA sala - senao cada um espera o outro num lugar vazio", async () => {
    const a = await entrar(consultaAgora, pacienteId);
    const b = await entrar(consultaAgora, medicoId);
    expect(a.json().dados.url).toBe(b.json().dados.url);
  });

  it("4. o token e de UMA pessoa: diz quem e, e com que papel", async () => {
    const r = await entrar(consultaAgora, pacienteId);
    const conteudo = provedor.conferirToken(r.json().dados.token);
    expect(conteudo).toMatchObject({ pessoa: pacienteId, papel: "participante" });
  });

  it("5. token mexido nao vale - a assinatura e conferida", async () => {
    const r = await entrar(consultaAgora, pacienteId);
    const token: string = r.json().dados.token;
    expect(provedor.conferirToken(`${token}x`)).toBeNull();
  });

  it("6. OUTRO PACIENTE da mesma clinica: 403, e sem contar nada da consulta", async () => {
    const r = await entrar(consultaAgora, outroPacienteId);
    expect(r.statusCode).toBe(403);
    expect(r.json().erro.codigo).toBe("FORA_DA_CONSULTA");
    // A mensagem nao pode revelar nome, horario nem motivo de quem e a consulta.
    expect(JSON.stringify(r.json())).not.toContain("Paciente Um");
  });

  it("7. consulta de amanha: a sala ainda nao abriu", async () => {
    const r = await entrar(consultaAmanha, pacienteId);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("SALA_CEDO_DEMAIS");
    // A tela mostra a hora em que abre, em vez de so dizer "erro".
    expect(r.json().erro.detalhes.abreEm).toBeTruthy();
  });

  it("8. consulta cancelada nao abre sala, nem no horario certo", async () => {
    const r = await entrar(consultaCancelada, pacienteId);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("SALA_CANCELADA");
  });

  it("9. GET da sala responde sem emitir token - para a tela decidir o que mostrar", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/consultas/${consultaAmanha}/sala`,
      headers: { authorization: `Bearer ${pacienteId}`, "x-clinica": slug },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().dados).toMatchObject({ pode: false, motivo: "cedo_demais" });
    expect(JSON.stringify(r.json())).not.toContain("simulado.");
  });
});

describe.skipIf(!temBanco)("sala de video: encerrar", () => {
  it("10. o paciente NAO encerra - derrubaria o medico no meio do atendimento", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/consultas/${consultaAgora}/sala/encerrar`,
      headers: { authorization: `Bearer ${pacienteId}`, "x-clinica": slug },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro.codigo).toBe("SO_O_MEDICO_ENCERRA");
  });

  it("11. o medico encerra: a sala sai do provedor, a consulta vira concluida, e nao se entra de novo", async () => {
    await entrar(consultaDoOutro, medicoId);

    const r = await app.inject({
      method: "POST",
      url: `/consultas/${consultaDoOutro}/sala/encerrar`,
      headers: { authorization: `Bearer ${medicoId}`, "x-clinica": slug },
    });
    expect(r.statusCode).toBe(200);

    // A sala deixou de existir no provedor: token vazado nao abre mais nada.
    await expect(provedor.emitirToken({
      nomeDaSala: `consulta-${consultaDoOutro}`,
      nomeDaPessoa: "x",
      pessoaId: medicoId,
      papel: "anfitriao",
      expiraEm: new Date(Date.now() + 60_000),
    })).rejects.toThrow();

    const [c] = await banco.$client`select status from consultas where id = ${consultaDoOutro}`;
    expect(c!.status).toBe("concluida");

    // Consulta concluida nao abre sala de novo.
    const outraVez = await entrar(consultaDoOutro, medicoId);
    expect(outraVez.statusCode).toBe(409);
  });

  it("12. a entrada e o encerramento ficam na auditoria - e o que prova o atendimento", async () => {
    const linhas = await banco.$client`
      select acao from auditoria where clinica_id = ${clinicaId} and acao like 'video.%' order by acao
    `;
    const acoes = linhas.map((l) => l.acao as string);
    expect(acoes).toContain("video.entrou");
    expect(acoes).toContain("video.encerrou");
  });
});

describe.skipIf(!temBanco)("regressao: GET /consultas nao vaza a agenda da clinica", () => {
  /**
   * Este teste existe por causa de um erro real, encontrado durante o
   * Modulo 12: a rota filtrava so por clinica, confiando num comentario que
   * dizia que o RLS limitaria o resto. Nao limita - a API conecta como dona
   * do banco. Um paciente logado recebia nome, horario e motivo da consulta
   * de todos os outros pacientes da clinica.
   */
  it("13. o paciente ve SO as proprias consultas", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/consultas",
      headers: { authorization: `Bearer ${pacienteId}`, "x-clinica": slug },
    });
    expect(r.statusCode).toBe(200);
    const ids: string[] = r.json().dados.map((c: { id: string }) => c.id);
    expect(ids).toContain(consultaAgora);
    // A consulta do outro paciente nao pode aparecer de jeito nenhum.
    expect(ids).not.toContain(consultaDoOutro);
    expect(JSON.stringify(r.json())).not.toContain("Paciente Dois");
    expect(JSON.stringify(r.json())).not.toContain("Dor de cabeca");
  });

  it("14. o medico ve os atendimentos dele", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/consultas",
      headers: { authorization: `Bearer ${medicoId}`, "x-clinica": slug },
    });
    const ids: string[] = r.json().dados.map((c: { id: string }) => c.id);
    expect(ids).toContain(consultaAgora);
    expect(ids).toContain(consultaDoOutro);
  });
});
