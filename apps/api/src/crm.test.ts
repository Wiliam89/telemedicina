/**
 * =====================================================================
 * TESTES DA VERIFICACAO DE CRM (ADR-0016) - CONTRA O POSTGRES
 * =====================================================================
 *
 *   - medico com CRM nao conferido nao emite documento, nao abre plantao
 *     e nao recebe marcacao (o paciente nem o ve na lista)
 *   - so a administracao confere; "Inativo" nao passa; recusa exige motivo
 *   - a conferencia e prova: o gatilho recusa reescrever
 *   - quem tem CRM e cria a clinica vira medico E administracao dela
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
  PORT: 3997,
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

const admin = randomUUID();
const medico = randomUUID();
const paciente = randomUUID();
const dono = randomUUID(); // medico que vai abrir a propria clinica
const clinicaId = randomUUID();
const consultaId = randomUUID();
const slug = `teste-crm-${Date.now()}`;
const slugDoDono = `teste-dono-${Date.now()}`;
const pessoas: string[] = [admin, medico, paciente, dono];
const autenticarFalso = async (token: string) => (pessoas.includes(token) ? { id: token, email: `${token}@teste.local` } : null);

let app: Awaited<ReturnType<typeof criarServidor>>["app"];
let banco: ReturnType<typeof criarBanco>;

const chamar = (quem: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown, clinica = slug) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${quem}`, "x-clinica": clinica }, ...(payload === undefined ? {} : { payload: payload as object }) });

function cpfValido(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b: number[]) => {
    const r = (b.reduce((acc, d, i) => acc + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}

function cnpjValido(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const dv = (nums: number[]) => {
    let soma = 0;
    let peso = nums.length - 7;
    for (const n of nums) {
      soma += n * peso;
      peso = peso - 1 < 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  return [...base, d1, dv([...base, d1])].join("");
}

beforeAll(async () => {
  if (!temBanco) return;
  banco = criarBanco(DATABASE_URL!);
  const sql = banco.$client;
  for (const id of pessoas) await sql`insert into auth.users (id, email) values (${id}, ${`${id}@teste.local`})`;
  await sql`insert into perfis (id, nome_completo, cpf) values
    (${admin}, 'Admin Teste', null), (${medico}, 'Dr. Sem Conferencia', ${cpfValido()}), (${paciente}, 'Paciente Teste', null), (${dono}, 'Dra. Dona', null)`;
  await sql`insert into medicos (perfil_id, crm, crm_uf) values (${medico}, '777001', 'SP'), (${dono}, '777002', 'RJ')`;
  await sql`insert into pacientes (perfil_id, data_nascimento) values (${paciente}, '1990-01-01')`;
  await sql`insert into clinicas (id, slug, nome_fantasia, razao_social, cnpj, status, fuso_horario)
    values (${clinicaId}, ${slug}, 'Clinica CRM', 'Clinica CRM LTDA', ${cnpjValido()}, 'ativa', 'America/Sao_Paulo')`;
  await sql`insert into vinculos (perfil_id, clinica_id, papel, status) values
    (${admin}, ${clinicaId}, 'admin_clinica', 'ativo'), (${medico}, ${clinicaId}, 'medico', 'ativo'), (${paciente}, ${clinicaId}, 'paciente', 'ativo')`;
  const inicio = new Date(Date.now() - 600000).toISOString();
  const fim = new Date(Date.now() + 1200000).toISOString();
  await sql`insert into consultas (id, clinica_id, paciente_id, medico_id, inicio, fim, status)
    values (${consultaId}, ${clinicaId}, ${paciente}, ${medico}, ${inicio}, ${fim}, 'em_andamento')`;

  ({ app } = await criarServidor({
    ambiente: AMBIENTE,
    autenticar: autenticarFalso,
    provedorDeVideo: new ProvedorLocalDeVideo(),
    armazenamentoDeAnexos: new ArmazenamentoEmMemoriaDeAnexos(),
  }));
});

afterAll(async () => {
  if (!temBanco) return;
  const sql = banco.$client;
  // Inclui sobras de execucoes interrompidas (mesmo prefixo de endereco).
  const clinicas = await sql`select id from clinicas where slug like 'teste-crm-%' or slug like 'teste-dono-%'`;
  const ids = clinicas.map((c) => c.id as string);
  await sql.begin(async (tx) => {
    await tx.unsafe("alter table verificacoes_crm disable trigger verificacoes_crm_imutaveis");
    await tx.unsafe("alter table documentos disable trigger documentos_imutaveis");
    await tx`delete from verificacoes_crm where clinica_id in ${tx(ids)}`;
    await tx`delete from documentos where clinica_id in ${tx(ids)}`;
    await tx.unsafe("alter table documentos enable trigger documentos_imutaveis");
    await tx.unsafe("alter table verificacoes_crm enable trigger verificacoes_crm_imutaveis");
  });
  await sql`delete from auditoria where clinica_id in ${sql(ids)}`;
  await sql`delete from consultas where clinica_id in ${sql(ids)}`;
  await sql`delete from vinculos where clinica_id in ${sql(ids)}`;
  await sql`delete from clinicas where id in ${sql(ids)}`;
  await sql`delete from auth.users where id in ${sql(pessoas)}`;
  await app?.close();
  await banco.$client.end({ timeout: 2 });
});

const receita = { consultaId, tipo: "receita_simples", conteudo: { itens: [{ medicamento: "Dipirona 500 mg", posologia: "1 comprimido se dor" }] } };

describe.skipIf(!temBanco)("CRM nao conferido: o medico nao age como medico", () => {
  it("1. o perfil do medico diz 'pendente' nesta clinica", async () => {
    const r = await chamar(medico, "GET", "/perfis/eu");
    const c = r.json().dados.clinicas.find((x: { slug: string }) => x.slug === slug);
    expect(c.situacaoCrm).toBe("pendente");
  });

  it("2. nao emite documento", async () => {
    const r = await chamar(medico, "POST", "/documentos", receita);
    expect(r.statusCode).toBe(403);
    expect(r.json().erro.codigo).toBe("CRM_NAO_VERIFICADO");
  });

  it("3. nao se escala para plantao", async () => {
    const inicio = new Date(Date.now() + 3600000).toISOString();
    const fim = new Date(Date.now() + 7200000).toISOString();
    const r = await chamar(medico, "POST", "/plantoes", { inicio, fim });
    expect(r.json().erro?.codigo).toBe("CRM_NAO_VERIFICADO");
  });

  it("4. o paciente nao o ve na lista e nao consegue ver horarios dele", async () => {
    const lista = await chamar(paciente, "GET", "/medicos");
    expect(lista.json().dados.map((m: { id: string }) => m.id)).not.toContain(medico);
    const hoje = new Date().toISOString().slice(0, 10);
    expect((await chamar(paciente, "GET", `/horarios?medicoId=${medico}&data=${hoje}`)).statusCode).toBe(403);
  });
});

describe.skipIf(!temBanco)("a conferencia pela administracao", () => {
  it("5. o proprio medico nao se confere", async () => {
    expect((await chamar(medico, "POST", `/medicos/${medico}/crm`, { resultado: "verificado", nomeNoConselho: "X Y Z", situacaoNoConselho: "Ativo" })).statusCode).toBe(403);
  });

  it("6. CRM 'Inativo' no Conselho nao se verifica; recusa sem motivo nao passa", async () => {
    const inativo = await chamar(admin, "POST", `/medicos/${medico}/crm`, { resultado: "verificado", nomeNoConselho: "DR SEM CONFERENCIA", situacaoNoConselho: "Inativo" });
    expect(inativo.statusCode).toBe(400);
    const recusaMuda = await chamar(admin, "POST", `/medicos/${medico}/crm`, { resultado: "recusado" });
    expect(recusaMuda.statusCode).toBe(400);
  });

  it("7. verificado: passa a emitir documento e a aparecer para o paciente", async () => {
    const ok = await chamar(admin, "POST", `/medicos/${medico}/crm`, { resultado: "verificado", nomeNoConselho: "DR SEM CONFERENCIA", situacaoNoConselho: "Ativo" });
    expect(ok.statusCode).toBe(201);

    const painel = await chamar(admin, "GET", "/crm/verificacoes");
    const m = painel.json().dados.find((x: { id: string }) => x.id === medico);
    expect(m.situacao).toBe("verificado");
    expect(m.historico[0]).toMatchObject({ verificadoPor: "Admin Teste", situacaoNoConselho: "Ativo", crm: "777001" });

    expect((await chamar(paciente, "GET", "/medicos")).json().dados.map((x: { id: string }) => x.id)).toContain(medico);
    expect((await chamar(medico, "POST", "/documentos", receita)).statusCode).toBe(201);
  });

  it("8. recusar depois cria linha nova e bloqueia de novo; nada foi reescrito", async () => {
    await chamar(admin, "POST", `/medicos/${medico}/crm`, { resultado: "recusado", observacao: "Nome no Conselho diferente do cadastro" });
    expect((await chamar(medico, "POST", "/documentos", receita)).json().erro?.codigo).toBe("CRM_NAO_VERIFICADO");
    const linhas = await banco.$client`select resultado from verificacoes_crm where medico_id = ${medico} order by criado_em`;
    expect(linhas.map((l) => l.resultado)).toEqual(["verificado", "recusado"]);
    await expect(banco.$client`update verificacoes_crm set resultado = 'verificado' where medico_id = ${medico}`).rejects.toThrow(/nao se altera/);
  });
});

describe.skipIf(!temBanco)("o medico que abre o proprio consultorio", () => {
  it("9. vira administracao E medico, e as rotas de medico aceitam", async () => {
    const criada = await chamar(dono, "POST", "/clinicas", { nomeFantasia: "Consultorio da Dona", razaoSocial: "Dona Servicos Medicos LTDA", cnpj: cnpjValido(), slug: slugDoDono });
    expect(criada.statusCode).toBe(201);
    const eu = await chamar(dono, "GET", "/perfis/eu");
    const c = eu.json().dados.clinicas.find((x: { slug: string }) => x.slug === slugDoDono);
    expect(c.papel).toBe("admin_clinica");
    expect(c.papeis).toEqual(["admin_clinica", "medico"]);
    // Rota so de medico: a grade de horarios.
    const grade = await chamar(dono, "PUT", "/disponibilidades", { blocos: [{ diaSemana: 1, horaInicio: "08:00", horaFim: "12:00", duracaoMinutos: 30 }] }, slugDoDono);
    expect(grade.statusCode).toBe(200);
    // E ela mesma pode conferir o proprio CRM? Nao pela regra "so admin": ela E admin.
    // A conferencia fica registrada com o nome dela - e responsabilidade do diretor tecnico.
  });
});
