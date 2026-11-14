/**
 * =====================================================================
 * PLATAFORMA COMO CLINICA, CREDENCIAMENTO, COBRANCA E DESPACHO
 * (ADR-0022 a ADR-0025) - CONTRA O POSTGRES
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
import { cobrarConsultasConcluidas } from "./cobranca.js";
import { assinarPedidoDeArquivos, assinarResultado } from "./identidade/provedor.js";
import { ProvedorLocalDePagamento, ResolvedorDePagamento } from "./pagamento/index.js";
import { criarServidor } from "./servidor.js";
import { ProvedorLocalDeVideo } from "./video/provedor-local.js";

const DATABASE_URL = process.env.DATABASE_URL;
const temBanco = Boolean(DATABASE_URL);

const slug = `plataforma-${Date.now()}`;
const SEGREDO_DA_IDENTIDADE = "segredo-de-teste-da-identidade";

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
  PLATAFORMA_ADMIN_EMAILS: "",
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

const admin = randomUUID();
const admin2 = randomUUID();
const novoPaciente = randomUUID();
const candidato = randomUUID();
const intruso = randomUUID();
const orto1 = randomUUID();
const orto2 = randomUUID();
const cardio = randomUUID();
const clinico = randomUUID();
const pacientes = Array.from({ length: 6 }, () => randomUUID());
const pessoas: string[] = [admin, admin2, novoPaciente, candidato, intruso, orto1, orto2, cardio, clinico, ...pacientes];
const autenticar = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let appExterno: Awaited<ReturnType<typeof criarServidor>>["app"];
let clinicaId = "";
const banco = temBanco ? criarBanco(DATABASE_URL!, { max: 3 }) : (null as never);
const resolvedor = temBanco ? new ResolvedorDePagamento(banco, AMBIENTE) : (null as never);

function chamar(quem: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, opcoes: { clinica?: string | null; instancia?: typeof app } = {}) {
  const clinica = opcoes.clinica === undefined ? slug : opcoes.clinica;
  return (opcoes.instancia ?? app).inject({
    method,
    url,
    headers: { authorization: `Bearer ${quem}`, ...(clinica ? { "x-clinica": clinica } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload: payload as object } : {}),
  });
}

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const PDF = new TextEncoder().encode("%PDF-1.4 teste");

function enviarDocumento(quem: string, tipo: string, bytes: Uint8Array, instancia = app) {
  const limite = `----teste${randomUUID()}`;
  const corpo = Buffer.concat([
    // O campo vem ANTES do arquivo: e assim que a rota o enxerga.
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="tipo"\r\n\r\n${tipo}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="arquivo"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${limite}--\r\n`),
  ]);
  return instancia.inject({ method: "POST", url: "/credenciamento/documentos", headers: { authorization: `Bearer ${quem}`, "x-clinica": slug, "content-type": `multipart/form-data; boundary=${limite}` }, payload: corpo });
}

async function pessoa(id: string, opcoes: { cpf?: boolean } = {}) {
  await banco.$client`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
  await banco.$client`insert into perfis (id, nome_completo, cpf) values (${id}, ${`Pessoa ${id.slice(0, 6)}`}, ${opcoes.cpf ? cpfValido() : null})`;
}

async function medicoPronto(id: string, n: number, especialidades: string[], atendePronto: boolean) {
  const crm = `${Date.now() + n}`.slice(-7);
  const validade = new Date(Date.now() + 86400000 * 300).toISOString();
  await banco.$client`insert into medicos (perfil_id, crm, crm_uf, especialidades, atende_pronto_atendimento) values (${id}, ${crm}, 'RJ', ${especialidades}, ${atendePronto})`;
  await banco.$client`insert into vinculos (perfil_id, clinica_id, papel) values (${id}, ${clinicaId}, 'medico')`;
  await banco.$client`insert into verificacoes_crm (medico_id, clinica_id, resultado, metodo, crm, crm_uf, valido_ate, verificado_por)
    values (${id}, ${clinicaId}, 'verificado', 'consulta_manual_cfm', ${crm}, 'RJ', ${validade}::timestamptz, ${admin})`;
  await banco.$client`insert into plantoes (clinica_id, medico_id, inicio, fim, status, aberto_em)
    values (${clinicaId}, ${id}, now() - interval '1 hour', now() + interval '5 hours', 'aberto', now())`;
}

const cartaoDe = (final: string) => ProvedorLocalDePagamento.montarToken({ ultimos4: final, validadeMes: 12, validadeAno: 2099, bandeira: "visa" });
const cobrar = () => cobrarConsultasConcluidas(banco, resolvedor, { urlDeNotificacao: "http://localhost/webhooks/pagamento" });
const sairDaFila = (quem: string) => banco.$client`update fila_atendimento set status = 'desistiu', encerrado_em = now() where paciente_id = ${quem} and status in ('aguardando', 'em_atendimento')`;

beforeAll(async () => {
  if (!temBanco) return;
  const opcoes = { autenticar, provedorDeVideo: new ProvedorLocalDeVideo(), armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos() };
  ({ app } = await criarServidor({ ambiente: AMBIENTE, ...opcoes }));
  ({ app: appExterno } = await criarServidor({ ambiente: { ...AMBIENTE, IDENTIDADE_PROVEDOR: "externo", IDENTIDADE_WEBHOOK_SEGREDO: SEGREDO_DA_IDENTIDADE }, ...opcoes }));

  for (const id of [admin, admin2, orto1, orto2, cardio, clinico, intruso]) await pessoa(id, { cpf: true });
  for (const id of pacientes) await pessoa(id);
  await banco.$client`insert into auth.users (id, email) values (${novoPaciente}, ${`${novoPaciente}@teste.local`}), (${candidato}, ${`${candidato}@teste.local`})`;
});

afterAll(async () => {
  if (!temBanco) return;
  await app.close();
  await appExterno.close();
  await banco.$client.end({ timeout: 2 });
});

describe.skipIf(!temBanco)("a plataforma e a clinica (ADR-0022)", () => {
  it("1. antes da configuracao: /plataforma diz que e unica e ainda nao configurada", async () => {
    const r = await app.inject({ method: "GET", url: "/plataforma" });
    expect(r.json().dados).toMatchObject({ unica: true, slug, configurada: false });
  });

  it("2. ninguem cria outra clinica; a da plataforma nasce aberta", async () => {
    const corpo = { nomeFantasia: "Saude Teste", razaoSocial: "Saude Teste LTDA", cnpj: "11222333000181" };
    const outra = await chamar(admin, "POST", "/clinicas", { ...corpo, slug: `outra-${Date.now()}` }, { clinica: null });
    expect(outra.statusCode).toBe(403);
    expect(outra.json().erro.codigo).toBe("PLATAFORMA_UNICA");

    // O CNPJ e unico no banco: usa um proprio deste teste.
    const base = `${Date.now()}`.slice(-8).padStart(8, "3") + "0001";
    const dv = (d: string) => {
      const pesos = d.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const r = d.split("").reduce((s, c, i) => s + Number(c) * pesos[i]!, 0) % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const d1 = dv(base);
    const cnpj = `${base}${d1}${dv(`${base}${d1}`)}`;
    const r = await chamar(admin, "POST", "/clinicas", { ...corpo, cnpj, slug }, { clinica: null });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados.status).toBe("ativa");
    clinicaId = r.json().dados.id as string;
    await banco.$client`insert into vinculos (perfil_id, clinica_id, papel) values (${admin2}, ${clinicaId}, 'admin_clinica')`;
  });

  it("3. quem cria a conta ja e paciente da plataforma, sem convite", async () => {
    const r = await chamar(novoPaciente, "POST", "/perfis", { nomeCompleto: "Paciente Novo", paciente: { dataNascimento: "1990-05-05" }, consentimentos: ["termos_de_uso", "politica_de_privacidade", "telemedicina"] }, { clinica: null });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados.clinicas).toEqual([expect.objectContaining({ slug, papel: "paciente" })]);
    expect((await chamar(novoPaciente, "GET", "/clinicas/atual")).statusCode).toBe(200);
  });

  it("4. conta antiga entra com /plataforma/entrar, e so uma vez de verdade", async () => {
    await banco.$client`insert into pacientes (perfil_id, data_nascimento) values (${pacientes[0]!}, '1991-01-01')`;
    expect((await chamar(pacientes[0]!, "POST", "/plataforma/entrar", undefined, { clinica: null })).statusCode).toBe(200);
    expect((await chamar(pacientes[0]!, "POST", "/plataforma/entrar", undefined, { clinica: null })).statusCode).toBe(200);
    const v = await banco.$client`select 1 from vinculos where perfil_id = ${pacientes[0]!} and clinica_id = ${clinicaId}`;
    expect(v.length).toBe(1);
  });

  it("5. cabecalho apontando para outra clinica e recusado antes de qualquer rota", async () => {
    const r = await chamar(admin, "GET", "/clinicas/atual", undefined, { clinica: "clinica-antiga" });
    expect(r.statusCode).toBe(404);
  });

  it("6. medico nao entra por convite: so pelo credenciamento", async () => {
    const r = await chamar(admin, "POST", "/convites", { email: "medico@teste.local", papel: "medico" });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("MEDICO_ENTRA_POR_CREDENCIAMENTO");
    expect((await chamar(admin, "POST", "/convites", { email: "recepcao@teste.local", papel: "recepcao" })).statusCode).toBe(201);
  });
});

describe.skipIf(!temBanco)("credenciamento do medico (ADR-0022)", () => {
  it("7. o candidato se cadastra como medico e NAO ganha acesso de medico", async () => {
    const r = await chamar(candidato, "POST", "/perfis", { nomeCompleto: "Doutora Candidata", cpf: cpfValido(), paciente: { dataNascimento: "1985-03-03" }, medico: { crm: `${Date.now()}`.slice(-6), crmUf: "MG" }, consentimentos: ["termos_de_uso", "politica_de_privacidade", "telemedicina"] }, { clinica: null });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados.clinicas[0].papeis).toEqual(["paciente"]);
    // Sem o papel de medico, a lista de pacientes nao abre.
    expect((await chamar(candidato, "GET", "/pacientes")).statusCode).toBe(403);
    expect((await chamar(candidato, "GET", "/fila/chamados")).statusCode).toBe(403);
  });

  it("8. pedido incompleto nao e enviado, e diz o que falta", async () => {
    expect((await chamar(candidato, "PUT", "/credenciamento", { especialidadesSolicitadas: ["cardiologia"], querProntoAtendimento: true })).statusCode).toBe(200);
    const r = await chamar(candidato, "POST", "/credenciamento/enviar", { aceitoBiometria: true });
    expect(r.statusCode).toBe(400);
    expect((r.json().erro.detalhes.pendencias as string[]).length).toBeGreaterThan(3);
  });

  it("9. arquivo disfarcado e recusado; selfie em PDF tambem", async () => {
    expect((await enviarDocumento(candidato, "diploma", new TextEncoder().encode("MZ executavel"))).statusCode).toBe(415);
    const r = await enviarDocumento(candidato, "selfie", PDF);
    expect(r.statusCode).toBe(415);
    expect(r.json().erro.codigo).toBe("PRECISA_SER_FOTO");
  });

  it("10. sem concordar com a biometria, o pedido nao segue", async () => {
    for (const tipo of ["identidade_frente", "identidade_verso", "carteira_crm", "selfie"]) expect((await enviarDocumento(candidato, tipo, JPG)).statusCode).toBe(201);
    for (const tipo of ["diploma", "titulo_especialista"]) expect((await enviarDocumento(candidato, tipo, PDF)).statusCode).toBe(201);
    expect((await chamar(candidato, "POST", "/credenciamento/enviar", { aceitoBiometria: false })).statusCode).toBe(400);
    const r = await chamar(candidato, "POST", "/credenciamento/enviar", { aceitoBiometria: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().dados).toEqual({ status: "em_analise", identidade: "pendente" });
    // Em analise, o medico nao troca documento nem reenvia.
    expect((await enviarDocumento(candidato, "selfie", JPG)).statusCode).toBe(409);
    expect((await chamar(candidato, "POST", "/credenciamento/enviar", { aceitoBiometria: true })).statusCode).toBe(409);
  });

  it("11. so a administracao ve o pedido e os documentos; a leitura e auditada", async () => {
    expect((await chamar(intruso, "GET", "/credenciamentos")).statusCode).toBe(403);
    const lista = await chamar(admin, "GET", "/credenciamentos");
    expect(lista.statusCode).toBe(200);
    const pedido = (lista.json().dados as { id: string; medico: { id: string; cpfMascarado: string }; documentos: { id: string; tipo: string }[] }[]).find((p) => p.medico.id === candidato)!;
    expect(pedido.medico.cpfMascarado).toMatch(/^\*\*\*\./);
    const selfie = pedido.documentos.find((d) => d.tipo === "selfie")!;

    await banco.$client`insert into pacientes (perfil_id, data_nascimento) values (${intruso}, '1980-01-01')`;
    await chamar(intruso, "POST", "/plataforma/entrar", undefined, { clinica: null });
    expect((await chamar(intruso, "GET", `/credenciamentos/documentos/${selfie.id}/arquivo`)).statusCode).toBe(404);

    expect((await chamar(admin, "GET", `/credenciamentos/documentos/${selfie.id}/arquivo`)).statusCode).toBe(200);
    const auditado = await banco.$client`select 1 from auditoria where acao = 'credenciamento.documento_lido' and registro_id = ${selfie.id}`;
    expect(auditado.length).toBe(1);
  });

  it("12. sem identidade confirmada nao ha aprovacao; reprovar exige explicacao", async () => {
    const [pedido] = await banco.$client`select id from credenciamentos_medicos where medico_id = ${candidato}`;
    const id = pedido!.id as string;
    const cedo = await chamar(admin, "POST", `/credenciamentos/${id}/decidir`, { decisao: "aprovar" });
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json().erro.codigo).toBe("IDENTIDADE_NAO_CONFIRMADA");
    expect((await chamar(admin, "POST", `/credenciamentos/${id}/identidade`, { resultado: "reprovada" })).statusCode).toBe(400);
    expect((await chamar(admin, "POST", `/credenciamentos/${id}/identidade`, { resultado: "aprovada" })).statusCode).toBe(201);
  });

  it("13. aprovar libera so o que foi pedido, cria o papel de medico e registra o CRM", async () => {
    const [pedido] = await banco.$client`select id from credenciamentos_medicos where medico_id = ${candidato}`;
    const id = pedido!.id as string;
    const demais = await chamar(admin, "POST", `/credenciamentos/${id}/decidir`, { decisao: "aprovar", especialidades: ["cardiologia", "pediatria"] });
    expect(demais.json().erro.codigo).toBe("ESPECIALIDADE_NAO_PEDIDA");

    const r = await chamar(admin, "POST", `/credenciamentos/${id}/decidir`, { decisao: "aprovar", crm: { nomeNoConselho: "Doutora Candidata", situacaoNoConselho: "Ativo" } });
    expect(r.statusCode).toBe(200);
    const eu = await chamar(candidato, "GET", "/perfis/eu", undefined, { clinica: null });
    expect(eu.json().dados.clinicas[0]).toMatchObject({ papeis: ["medico", "paciente"], situacaoCrm: "verificado" });
    expect(eu.json().dados.medico).toMatchObject({ especialidades: ["cardiologia"], atendeProntoAtendimento: true });
    expect(eu.json().dados.credenciamento).toBe("aprovado");
    // Decidir duas vezes nao faz nada.
    expect((await chamar(admin, "POST", `/credenciamentos/${id}/decidir`, { decisao: "recusar", motivo: "mudei de ideia" })).statusCode).toBe(409);
  });

  it("14. ninguem aprova o proprio credenciamento", async () => {
    await banco.$client`insert into medicos (perfil_id, crm, crm_uf) values (${admin2}, ${`${Date.now()}`.slice(-5)}, 'BA')`;
    await banco.$client`insert into pacientes (perfil_id, data_nascimento) values (${admin2}, '1979-01-01')`;
    await chamar(admin2, "PUT", "/credenciamento", { especialidadesSolicitadas: [], querProntoAtendimento: true });
    for (const tipo of ["identidade_frente", "identidade_verso", "carteira_crm", "selfie", "diploma"]) await enviarDocumento(admin2, tipo, JPG);
    expect((await chamar(admin2, "POST", "/credenciamento/enviar", { aceitoBiometria: true })).statusCode).toBe(200);
    const [pedido] = await banco.$client`select id from credenciamentos_medicos where medico_id = ${admin2}`;
    expect((await chamar(admin2, "POST", `/credenciamentos/${pedido!.id as string}/identidade`, { resultado: "aprovada" })).statusCode).toBe(403);
    expect((await chamar(admin2, "POST", `/credenciamentos/${pedido!.id as string}/decidir`, { decisao: "aprovar" })).statusCode).toBe(403);
  });

  it("15. reconhecimento facial externo: so vale aviso assinado, recente e uma vez", async () => {
    const medicoExterno = pacientes[5]!;
    await banco.$client`update perfis set cpf = ${cpfValido()} where id = ${medicoExterno}`;
    await banco.$client`insert into pacientes (perfil_id, data_nascimento) values (${medicoExterno}, '1988-01-01')`;
    await chamar(medicoExterno, "POST", "/plataforma/entrar", undefined, { clinica: null });
    expect((await chamar(medicoExterno, "PUT", "/credenciamento", { especialidadesSolicitadas: [], querProntoAtendimento: true, medico: { crm: `${Date.now()}`.slice(-4), crmUf: "PR" } }, { instancia: appExterno })).statusCode).toBe(200);
    for (const tipo of ["identidade_frente", "identidade_verso", "carteira_crm", "selfie", "diploma"]) await enviarDocumento(medicoExterno, tipo, JPG, appExterno);
    expect((await chamar(medicoExterno, "POST", "/credenciamento/enviar", { aceitoBiometria: true }, { instancia: appExterno })).statusCode).toBe(200);
    const [v] = await banco.$client`select referencia from verificacoes_de_identidade where medico_id = ${medicoExterno} and status = 'pendente'`;
    const referencia = v!.referencia as string;
    const ts = Math.floor(Date.now() / 1000);

    // As fotos so saem para quem assina o pedido.
    expect((await appExterno.inject({ method: "GET", url: `/webhooks/identidade/${referencia}/arquivos?ts=${ts}`, headers: { "x-assinatura": "0".repeat(64) } })).statusCode).toBe(401);
    const fotos = await appExterno.inject({ method: "GET", url: `/webhooks/identidade/${referencia}/arquivos?ts=${ts}`, headers: { "x-assinatura": assinarPedidoDeArquivos(referencia, ts, SEGREDO_DA_IDENTIDADE) } });
    expect(fotos.statusCode).toBe(200);
    expect(fotos.json().dados.selfie).toContain("memoria://");

    const aviso = { referencia, status: "aprovada", pontuacao: 97, ts };
    const mandar = (corpo: object, assinatura: string) => appExterno.inject({ method: "POST", url: "/webhooks/identidade", headers: { "content-type": "application/json", "x-assinatura": assinatura }, payload: corpo });
    // Assinatura de outro conteudo (alguem trocou "reprovada" por "aprovada").
    expect((await mandar(aviso, assinarResultado({ ...aviso, status: "reprovada" }, SEGREDO_DA_IDENTIDADE))).statusCode).toBe(401);
    // Aviso velho, mesmo bem assinado.
    const velho = { ...aviso, ts: ts - 3600 };
    expect((await mandar(velho, assinarResultado(velho, SEGREDO_DA_IDENTIDADE))).statusCode).toBe(401);

    expect((await mandar(aviso, assinarResultado(aviso, SEGREDO_DA_IDENTIDADE))).statusCode).toBe(200);
    const depois = { ...aviso, status: "reprovada", pontuacao: 3 };
    expect((await mandar(depois, assinarResultado(depois, SEGREDO_DA_IDENTIDADE))).json().repetido).toBe(true);
    const linhas = await banco.$client`select status from verificacoes_de_identidade where referencia = ${referencia} order by criado_em`;
    expect(linhas.map((l) => l.status)).toEqual(["pendente", "aprovada"]);
  });
});

describe.skipIf(!temBanco)("linhas de atendimento e despacho (ADR-0024 e ADR-0025)", () => {
  beforeAll(async () => {
    if (!temBanco) return;
    await medicoPronto(orto1, 11, ["ortopedia_e_traumatologia"], false);
    await medicoPronto(orto2, 12, ["ortopedia_e_traumatologia"], false);
    await medicoPronto(cardio, 13, ["cardiologia"], false);
    await medicoPronto(clinico, 14, [], true);
    // O candidato aprovado (cardiologia + pronto atendimento) fica offline.
    for (const id of pacientes.slice(1, 5)) {
      await banco.$client`insert into pacientes (perfil_id, data_nascimento) values (${id}, '1992-02-02')`;
      await banco.$client`insert into vinculos (perfil_id, clinica_id, papel) values (${id}, ${clinicaId}, 'paciente')`;
      await banco.$client`insert into consentimentos (perfil_id, tipo, acao, versao) values (${id}, 'telemedicina', 'aceito', ${VERSOES_LEGAIS.telemedicina})`;
    }
    const r = await chamar(admin, "PUT", "/precos", {
      itens: [
        { tipo: "pronto_atendimento", valorCentavos: 6000 },
        { tipo: "pronto_agendado", valorCentavos: 7000 },
        { tipo: "teleconsulta_imediata", valorCentavos: 12000 },
        { tipo: "teleconsulta_imediata", especialidade: "cardiologia", valorCentavos: 18000 },
        { tipo: "agendada", valorCentavos: 15000 },
      ],
    });
    expect(r.statusCode).toBe(200);
  });

  it("16. a vitrine mostra so especialidade com medico apto, com o preco certo", async () => {
    const r = await chamar(pacientes[1]!, "GET", "/atendimento/opcoes");
    const d = r.json().dados as { prontoAtendimento: { online: number; valorImediatoCentavos: number }; especialidades: { codigo: string; online: number; valorImediatoCentavos: number }[] };
    expect(d.especialidades.map((e) => e.codigo).sort()).toEqual(["cardiologia", "ortopedia_e_traumatologia"]);
    expect(d.especialidades.find((e) => e.codigo === "cardiologia")).toMatchObject({ valorImediatoCentavos: 18000, online: 1 });
    expect(d.especialidades.find((e) => e.codigo === "ortopedia_e_traumatologia")).toMatchObject({ valorImediatoCentavos: 12000, online: 2 });
    expect(d.prontoAtendimento).toMatchObject({ valorImediatoCentavos: 6000, online: 1 });
  });

  it("17. preco repetido ou de especialidade no pronto atendimento e recusado", async () => {
    expect((await chamar(admin, "PUT", "/precos", { itens: [{ tipo: "agendada", valorCentavos: 100 }, { tipo: "agendada", valorCentavos: 200 }] })).statusCode).toBe(400);
    expect((await chamar(admin, "PUT", "/precos", { itens: [{ tipo: "pronto_atendimento", especialidade: "cardiologia", valorCentavos: 100 }] })).statusCode).toBe(400);
  });

  it("18. Pix do pronto atendimento nao paga a fila do especialista", async () => {
    const quem = pacientes[1]!;
    const barato = await chamar(quem, "POST", "/pagamentos/pronto-atendimento", { metodo: "pix" });
    expect(barato.json().dados.valorCentavos).toBe(6000);
    await banco.$client`update pagamentos set status = 'confirmado', confirmado_em = now() where id = ${barato.json().dados.pagamentoId as string}`;
    const r = await chamar(quem, "POST", "/fila", { queixa: "dor forte no joelho", linha: "teleconsulta", especialidade: "ortopedia_e_traumatologia", pagamentoId: barato.json().dados.pagamentoId, consentimento: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("PAGAMENTO_DE_OUTRO_ATENDIMENTO");
    // No pronto atendimento, o mesmo pagamento serve.
    expect((await chamar(quem, "POST", "/fila", { queixa: "dor forte no joelho", pagamentoId: barato.json().dados.pagamentoId, consentimento: true })).statusCode).toBe(201);
    await sairDaFila(quem);
  });

  it("19. especialidade sem medico nao aceita paciente na fila", async () => {
    const r = await chamar(pacientes[1]!, "POST", "/fila", { queixa: "manchas na pele", linha: "teleconsulta", especialidade: "dermatologia", usarCartao: true, consentimento: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("ESPECIALIDADE_INDISPONIVEL");
  });

  it("20. o pedido de ortopedia chega a TODOS os ortopedistas online, e so a eles", async () => {
    const quem = pacientes[2]!;
    expect((await chamar(quem, "POST", "/cartoes", { tokenDoCartao: cartaoDe("4242"), autorizo: true })).statusCode).toBe(201);
    const r = await chamar(quem, "POST", "/fila", { queixa: "torci o tornozelo", linha: "teleconsulta", especialidade: "ortopedia_e_traumatologia", usarCartao: true, consentimento: true });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados.medicosOnline).toBe(2);
    const filaId = r.json().dados.id as string;

    const avisados = await banco.$client`select perfil_id from notificacoes where chave = ${`chamado:${filaId}`}`;
    expect(avisados.map((a) => a.perfil_id).sort()).toEqual([orto1, orto2].sort());
    // O aviso nao leva nome nem queixa.
    const [aviso] = await banco.$client`select titulo, corpo from notificacoes where chave = ${`chamado:${filaId}`} limit 1`;
    expect(`${aviso!.titulo} ${aviso!.corpo}`).not.toMatch(/tornozelo|Pessoa/);

    const ver = async (m: string) => ((await chamar(m, "GET", "/fila/chamados")).json().dados.chamados as { id: string }[]).some((c) => c.id === filaId);
    expect(await ver(orto1)).toBe(true);
    expect(await ver(orto2)).toBe(true);
    expect(await ver(cardio)).toBe(false);
    expect(await ver(clinico)).toBe(false);
    // Quem nao pode atender tambem nao consegue aceitar pelo id.
    expect((await chamar(cardio, "POST", `/fila/${filaId}/aceitar`)).statusCode).toBe(409);
    await sairDaFila(quem);
  });

  it("21. dois medicos aceitam ao mesmo tempo: um fica com o paciente, o outro e avisado", async () => {
    const quem = pacientes[2]!;
    for (let rodada = 0; rodada < 5; rodada++) {
      const r = await chamar(quem, "POST", "/fila", { queixa: "torci o tornozelo de novo", linha: "teleconsulta", especialidade: "ortopedia_e_traumatologia", usarCartao: true, consentimento: true });
      expect(r.statusCode).toBe(201);
      const filaId = r.json().dados.id as string;

      const respostas = await Promise.all([orto1, orto2, orto1, orto2].map((m) => chamar(m, "POST", `/fila/${filaId}/aceitar`)));
      expect(respostas.map((x) => x.statusCode).sort()).toEqual([200, 409, 409, 409]);
      expect(respostas.filter((x) => x.statusCode === 409).every((x) => ["JA_ACEITO", "MEDICO_COM_CONSULTA"].includes(x.json().erro.codigo as string))).toBe(true);

      const consultas = await banco.$client`select id, medico_id, linha, especialidade, forma_de_cobranca, valor_combinado_centavos from consultas where id in (select consulta_id from fila_atendimento where id = ${filaId})`;
      expect(consultas.length).toBe(1);
      expect(consultas[0]).toMatchObject({ linha: "teleconsulta", especialidade: "ortopedia_e_traumatologia", forma_de_cobranca: "cartao_ao_final", valor_combinado_centavos: 12000 });
      // Sumiu do painel de todo mundo.
      for (const m of [orto1, orto2]) {
        expect(((await chamar(m, "GET", "/fila/chamados")).json().dados.chamados as { id: string }[]).some((c) => c.id === filaId)).toBe(false);
      }
      // Libera o medico e o paciente para a proxima rodada (cancelar nao gera cobranca).
      await chamar(consultas[0]!.medico_id as string, "POST", `/consultas/${consultas[0]!.id as string}/cancelar`, { motivo: "rodada de teste" });
    }
  });

  it("22. medico offline nao ve pedido nem queixa de ninguem", async () => {
    const r = await chamar(candidato, "GET", "/fila/chamados");
    expect(r.json().dados).toMatchObject({ online: false, chamados: [] });
    expect((await chamar(candidato, "POST", "/fila/proximo")).json().erro.codigo).toBe("SEM_PLANTAO_ABERTO");
  });

  it("23. agendar: o medico precisa atender a linha e a especialidade pedidas", async () => {
    const lista = async (q: string) => ((await chamar(pacientes[1]!, "GET", `/medicos?${q}`)).json().dados as { id: string }[]).map((m) => m.id).sort();
    expect(await lista("linha=teleconsulta&especialidade=ortopedia_e_traumatologia")).toEqual([orto1, orto2].sort());
    expect(await lista("linha=pronto_atendimento")).toEqual([candidato, clinico].sort());

    const inicio = new Date(Date.now() + 3 * 86400000).toISOString();
    const errado = await chamar(pacientes[1]!, "POST", "/consultas", { medicoId: cardio, inicio, linha: "teleconsulta", especialidade: "ortopedia_e_traumatologia" });
    expect(errado.json().erro.codigo).toBe("MEDICO_NAO_ATENDE_ESTA_LINHA");
    expect((await chamar(pacientes[1]!, "POST", "/consultas", { medicoId: cardio, inicio, linha: "pronto_atendimento" })).json().erro.codigo).toBe("MEDICO_NAO_ATENDE_ESTA_LINHA");
  });
});

describe.skipIf(!temBanco)("cartao cadastrado e Pix (ADR-0023)", () => {
  async function atender(paciente: string, medico: string) {
    const r = await chamar(paciente, "POST", "/fila", { queixa: "febre e dor de cabeca", usarCartao: true, consentimento: true });
    expect(r.statusCode).toBe(201);
    const aceite = await chamar(medico, "POST", `/fila/${r.json().dados.id as string}/aceitar`);
    expect(aceite.statusCode).toBe(200);
    const consultaId = aceite.json().dados.consultaId as string;
    expect((await chamar(medico, "POST", `/consultas/${consultaId}/status`, { status: "concluida" })).statusCode).toBe(200);
    await sairDaFila(paciente);
    return consultaId;
  }

  it("24. a rota de cartao recusa numero de cartao e exige a autorizacao", async () => {
    const quem = pacientes[3]!;
    expect((await chamar(quem, "POST", "/cartoes", { tokenDoCartao: "4111 1111 1111 1111", autorizo: true })).statusCode).toBe(400);
    expect((await chamar(quem, "POST", "/cartoes", { tokenDoCartao: cartaoDe("1111"), autorizo: false })).statusCode).toBe(400);
    expect((await chamar(quem, "POST", "/cartoes", { tokenDoCartao: cartaoDe("1111"), autorizo: true, numero: "4111111111111111" })).statusCode).toBe(400);
    const r = await chamar(quem, "POST", "/cartoes", { tokenDoCartao: cartaoDe("1111"), autorizo: true });
    expect(r.statusCode).toBe(201);
    expect(r.json().dados).toMatchObject({ ultimos4: "1111", bandeira: "visa" });
    expect(JSON.stringify(r.json())).not.toMatch(/card_local|cli_local/);
    // Trocar de cartao deixa um ativo so.
    expect((await chamar(quem, "POST", "/cartoes", { tokenDoCartao: cartaoDe("2222"), autorizo: true })).statusCode).toBe(201);
    const ativos = await banco.$client`select ultimos4 from cartoes_salvos where perfil_id = ${quem} and status = 'ativo'`;
    expect(ativos.map((a) => a.ultimos4)).toEqual(["2222"]);
  });

  it("25. o cartao e de quem cadastrou: nem a administracao o ve", async () => {
    expect((await chamar(admin, "GET", "/cartoes")).json().dados.cartao).toBeNull();
    const [meu] = await banco.$client`select id from cartoes_salvos where perfil_id = ${pacientes[3]!} and status = 'ativo'`;
    expect((await chamar(pacientes[4]!, "POST", `/cartoes/${meu!.id as string}/remover`)).statusCode).toBe(404);
  });

  it("26. com cartao: nada e cobrado antes; ao encerrar, debita uma vez so", async () => {
    const quem = pacientes[3]!;
    const consultaId = await atender(quem, clinico);
    expect((await banco.$client`select 1 from pagamentos where consulta_id = ${consultaId}`).length).toBe(0);

    // O agendador e o gatilho do encerramento rodando juntos, em varias copias.
    const rodadas = await Promise.all(Array.from({ length: 5 }, () => cobrar()));
    expect(rodadas.reduce((s, r) => s + r.cobradas, 0)).toBe(1);
    const pagos = await banco.$client`select status, valor_centavos, metodo from pagamentos where consulta_id = ${consultaId}`;
    expect(pagos).toHaveLength(1);
    expect(pagos[0]).toMatchObject({ status: "confirmado", valor_centavos: 6000, metodo: "cartao_credito" });
    expect((await cobrar()).cobradas).toBe(0);
    expect((await chamar(quem, "GET", "/pagamentos/pendencias")).json().dados).toEqual([]);
  });

  it("27. cartao com consulta por cobrar nao pode ser removido", async () => {
    const quem = pacientes[3]!;
    const r = await chamar(quem, "POST", "/fila", { queixa: "tosse ha tres dias", usarCartao: true, consentimento: true });
    const [meu] = await banco.$client`select id from cartoes_salvos where perfil_id = ${quem} and status = 'ativo'`;
    const remover = await chamar(quem, "POST", `/cartoes/${meu!.id as string}/remover`);
    expect(remover.statusCode).toBe(409);
    expect(remover.json().erro.codigo).toBe("CARTAO_EM_USO");
    expect((await chamar(quem, "POST", `/fila/${r.json().dados.id as string}/desistir`, {})).statusCode).toBe(200);
    expect((await chamar(quem, "POST", `/cartoes/${meu!.id as string}/remover`)).statusCode).toBe(200);
  });

  it("28. cartao recusado no final: vira pendencia, bloqueia nova consulta e sai por Pix", async () => {
    const quem = pacientes[4]!;
    expect((await chamar(quem, "POST", "/cartoes", { tokenDoCartao: cartaoDe(ProvedorLocalDePagamento.FINAL_QUE_RECUSA_COBRANCA), autorizo: true })).statusCode).toBe(201);
    const consultaId = await atender(quem, clinico);
    expect(await cobrar()).toMatchObject({ cobradas: 0, recusadas: 1 });
    // Nao tenta de novo sozinho.
    expect(await cobrar()).toMatchObject({ cobradas: 0, recusadas: 0 });

    const pendencias = (await chamar(quem, "GET", "/pagamentos/pendencias")).json().dados as { consultaId: string; valorCentavos: number }[];
    expect(pendencias).toEqual([expect.objectContaining({ consultaId, valorCentavos: 6000 })]);
    const [aviso] = await banco.$client`select link from notificacoes where perfil_id = ${quem} and tipo = 'pagamento'`;
    expect(aviso!.link).toBe(`/c/${slug}/pagamento/${consultaId}`);

    // Quem deve nao entra em outro atendimento, nem com cartao nem pagando outro Pix.
    for (const corpo of [{ queixa: "outra queixa qualquer", usarCartao: true, consentimento: true }]) {
      const r = await chamar(quem, "POST", "/fila", corpo);
      expect(r.statusCode).toBe(402);
      expect(r.json().erro.detalhes.consultaId).toBe(consultaId);
    }
    expect((await chamar(quem, "POST", "/pagamentos/pronto-atendimento", { metodo: "pix" })).statusCode).toBe(402);

    // Tentar de novo no mesmo cartao continua recusado, e nao duplica pendencia.
    expect((await chamar(quem, "POST", `/consultas/${consultaId}/pagamento`, { metodo: "cartao_salvo" })).statusCode).toBe(400);

    // Regulariza por Pix: o estado vem do provedor.
    const pix = await chamar(quem, "POST", `/consultas/${consultaId}/pagamento`, { metodo: "pix" });
    expect(pix.statusCode).toBe(201);
    expect(pix.json().dados).toMatchObject({ status: "pendente", valorCentavos: 6000 });
    expect(pix.json().dados.pixCopiaECola).toBeTruthy();
    const [p] = await banco.$client`select provedor_id from pagamentos where id = ${pix.json().dados.pagamentoId as string}`;
    ProvedorLocalDePagamento.confirmarNoBanco(p!.provedor_id as string);
    const { corpo, cabecalhos } = ProvedorLocalDePagamento.montarNotificacao(p!.provedor_id as string, AMBIENTE.PAGAMENTO_WEBHOOK_SEGREDO);
    expect((await app.inject({ method: "POST", url: "/webhooks/pagamento", headers: { ...cabecalhos, "content-type": "application/json" }, payload: corpo })).statusCode).toBe(200);

    expect((await chamar(quem, "GET", "/pagamentos/pendencias")).json().dados).toEqual([]);
    expect((await chamar(quem, "POST", `/consultas/${consultaId}/pagamento`, { metodo: "pix" })).json().erro.codigo).toBe("JA_PAGA");
  });

  it("29. sem cartao: marcar reserva o horario e pede o Pix antes; com cartao, marca direto", async () => {
    for (let d = 0; d < 7; d++) {
      await banco.$client`insert into disponibilidades (clinica_id, medico_id, dia_semana, hora_inicio, hora_fim, duracao_minutos) values (${clinicaId}, ${clinico}, ${d}, '00:00', '23:30', 30)`;
    }
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 2 * 86400000));
    const livres = (await chamar(pacientes[1]!, "GET", `/horarios?medicoId=${clinico}&data=${dia}`)).json().dados as { inicio: string }[];

    const semCartao = await chamar(pacientes[1]!, "POST", "/consultas", { medicoId: clinico, inicio: livres[4]!.inicio, linha: "pronto_atendimento" });
    expect(semCartao.statusCode).toBe(201);
    expect(semCartao.json().dados).toMatchObject({ status: "aguardando_pagamento", formaDeCobranca: "antecipada", valorCombinadoCentavos: 7000, linha: "pronto_atendimento" });
    expect((await chamar(pacientes[1]!, "POST", `/consultas/${semCartao.json().dados.id as string}/pagamento`, { metodo: "pix" })).json().dados.valorCentavos).toBe(7000);
    expect((await chamar(pacientes[1]!, "POST", "/consultas", { medicoId: clinico, inicio: livres[6]!.inicio, linha: "pronto_atendimento", cobranca: "cartao" })).json().erro.codigo).toBe("SEM_CARTAO");

    const comCartao = await chamar(pacientes[2]!, "POST", "/consultas", { medicoId: clinico, inicio: livres[8]!.inicio, linha: "pronto_atendimento" });
    expect(comCartao.statusCode).toBe(201);
    expect(comCartao.json().dados).toMatchObject({ status: "agendada", formaDeCobranca: "cartao_ao_final", valorCombinadoCentavos: 7000 });
    // Consulta marcada no cartao nao se paga antes.
    expect((await chamar(pacientes[2]!, "POST", `/consultas/${comCartao.json().dados.id as string}/pagamento`, { metodo: "pix" })).statusCode).toBe(409);
    // Consulta que nao aconteceu nao e cobrada.
    expect((await chamar(pacientes[2]!, "POST", `/consultas/${comCartao.json().dados.id as string}/cancelar`, { motivo: "imprevisto" })).statusCode).toBe(200);
    expect((await cobrar()).cobradas).toBe(0);
  });
});

describe.skipIf(!temBanco)("correcoes do supervisor", () => {
  async function atenderEConcluir(paciente: string, medico: string, queixa = "febre e dor no corpo") {
    const r = await chamar(paciente, "POST", "/fila", { queixa, usarCartao: true, consentimento: true });
    expect(r.statusCode).toBe(201);
    const aceite = await chamar(medico, "POST", `/fila/${r.json().dados.id as string}/aceitar`);
    const consultaId = aceite.json().dados.consultaId as string;
    expect((await chamar(medico, "POST", `/consultas/${consultaId}/status`, { status: "concluida" })).statusCode).toBe(200);
    await sairDaFila(paciente);
    return consultaId;
  }

  it("30. trocar de cartao antes da cobranca: a consulta e debitada no cartao NOVO", async () => {
    const quem = pacientes[2]!;
    const consultaId = await atenderEConcluir(quem, clinico);
    // Troca de cartao antes de o agendador cobrar.
    expect((await chamar(quem, "POST", "/cartoes", { tokenDoCartao: cartaoDe("5555"), autorizo: true })).statusCode).toBe(201);
    await cobrar();
    const [p] = await banco.$client`select p.status, c.ultimos4 from pagamentos p join cartoes_salvos c on c.id = p.cartao_id where p.consulta_id = ${consultaId}`;
    expect(p).toMatchObject({ status: "confirmado", ultimos4: "5555" });
  });

  it("31. Pix em aberto nao pode ser trocado por cartao (seria pagar duas vezes)", async () => {
    const id = randomUUID();
    const inicio = new Date(Date.now() + 9 * 86400000);
    await banco.$client`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status, marcado_por, expira_reserva_em, linha, valor_combinado_centavos)
      values (${id}, ${clinicaId}, ${pacientes[1]!}, ${clinico}, ${inicio.toISOString()}::timestamptz, ${new Date(inicio.getTime() + 1800000).toISOString()}::timestamptz, 'aguardando_pagamento', ${pacientes[1]!}, ${new Date(Date.now() + 15 * 60000).toISOString()}::timestamptz, 'pronto_atendimento', 7000)`;
    expect((await chamar(pacientes[1]!, "POST", `/consultas/${id}/pagamento`, { metodo: "pix" })).statusCode).toBe(201);
    const r = await chamar(pacientes[1]!, "POST", `/consultas/${id}/pagamento`, { metodo: "cartao_credito", tokenDoCartao: "tok_qualquer" });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro.codigo).toBe("PIX_EM_ABERTO");
    expect((await banco.$client`select 1 from pagamentos where consulta_id = ${id}`).length).toBe(1);
  });

  it("32. GET /fila: so le a queixa o medico online que pode atender aquele pedido", async () => {
    const quem = pacientes[2]!;
    expect((await chamar(quem, "POST", "/fila", { queixa: "garganta inflamada", usarCartao: true, consentimento: true })).statusCode).toBe(201);
    const queixaVistaPor = async (m: string) => ((await chamar(m, "GET", "/fila")).json().dados.lista as { queixa: string | null }[]).map((f) => f.queixa).filter(Boolean);
    expect(await queixaVistaPor(clinico)).toContain("garganta inflamada");
    // Online, mas nao atende pronto atendimento.
    expect(await queixaVistaPor(cardio)).toEqual([]);
    // Atende pronto atendimento, mas esta offline.
    expect(await queixaVistaPor(candidato)).toEqual([]);
    expect(await queixaVistaPor(admin)).toEqual([]);
    await sairDaFila(quem);
  });

  it("33. cobranca no cartao parada 'em analise' e conferida com o provedor e resolvida", async () => {
    const quem = pacientes[2]!;
    const consultaId = await atenderEConcluir(quem, clinico);
    const [cartao] = await banco.$client`select id, provedor_cliente_id, provedor_cartao_id from cartoes_salvos where perfil_id = ${quem} and status = 'ativo'`;
    // Simula o provedor: a cobranca existe la (aprovada), mas aqui ficou "pendente" e o aviso se perdeu.
    const noProvedor = await new ProvedorLocalDePagamento().cobrar({ accessToken: "x", contaId: "x" }, {
      chaveIdempotencia: randomUUID(), metodo: "cartao_credito", valorCentavos: 6000, comissaoPlataformaCentavos: 0, descricao: "teste",
      pagador: { nome: "x", email: "" }, cartaoSalvo: { clienteId: cartao!.provedor_cliente_id as string, cartaoId: cartao!.provedor_cartao_id as string }, urlDeNotificacao: "http://x",
    });
    await banco.$client`insert into pagamentos (clinica_id, pagador_id, consulta_id, metodo, cartao_id, status, valor_centavos, valor_clinica_centavos, valor_plataforma_centavos, provedor, provedor_id, chave_idempotencia, criado_em, atualizado_em)
      values (${clinicaId}, ${quem}, ${consultaId}, 'cartao_credito', ${cartao!.id as string}, 'pendente', 6000, 6000, 0, 'local_teste', ${noProvedor.idNoProvedor}, ${randomUUID()}, now() - interval '30 minutes', now() - interval '30 minutes')`;

    // Enquanto pendente, nao se cobra de novo.
    const rodada = await cobrar();
    expect(rodada.cobradas).toBe(1);
    const pagos = await banco.$client`select status from pagamentos where consulta_id = ${consultaId}`;
    expect(pagos.map((p) => p.status)).toEqual(["confirmado"]);
  });

  it("34. a exportacao LGPD traz cartao, credenciamento e conferencias de identidade (sem imagem)", async () => {
    const paciente = await chamar(pacientes[2]!, "GET", "/lgpd/meus-dados", undefined, { clinica: null });
    expect(paciente.statusCode).toBe(200);
    const dadosPaciente = JSON.parse(paciente.body) as { cartoes: { final: string }[] };
    expect(dadosPaciente.cartoes.map((c) => c.final)).toContain("5555");
    expect(paciente.body).not.toMatch(/card_local|cli_local/);

    const medico = JSON.parse((await chamar(candidato, "GET", "/lgpd/meus-dados", undefined, { clinica: null })).body) as {
      credenciamentoMedico: { pedidos: unknown[]; documentosEnviados: { tipo: string }[]; conferenciasDeIdentidade: { resultado: string }[] };
    };
    expect(medico.credenciamentoMedico.pedidos).toHaveLength(1);
    expect(medico.credenciamentoMedico.documentosEnviados.map((d) => d.tipo)).toContain("selfie");
    expect(medico.credenciamentoMedico.conferenciasDeIdentidade.map((c) => c.resultado)).toContain("aprovada");
    expect(JSON.stringify(medico)).not.toMatch(/credenciamento\//);
  });
});
