/**
 * pnpm demo:criar   (com a API rodando em outro terminal: pnpm dev)
 *
 * Monta uma CLINICA DE DEMONSTRACAO completa, para testar a plataforma
 * com os quatro papeis sem precisar cadastrar tudo na mao:
 *
 *   administracao, medico (com grade), recepcao e dois pacientes,
 *   consultas marcadas, uma consulta ja atendida com prontuario
 *   finalizado e uma receita emitida (esperando assinatura).
 *
 * Tudo e feito PELA API, como o site faria - nada de escrever direto no
 * banco. Assim a demonstracao passa pelas mesmas regras, travas e
 * auditoria que um uso real.
 *
 * Pode rodar de novo: o que ja existe e reaproveitado, inclusive a senha. Os acessos ficam em  demo-acessos.local.md  na raiz do
 * projeto (fora do Git). NUNCA rode contra um banco com paciente real.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../../web/.env.local"), quiet: true });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const CHAVE_SECRETA = process.env.SUPABASE_SECRET_KEY!;
const CHAVE_PUBLICA = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const API = `http://127.0.0.1:${process.env.PORT ?? "3333"}`;
const SLUG = "clinica-demo";
const ARQUIVO = resolve(import.meta.dirname, "../../../demo-acessos.local.md");

if (process.env.NODE_ENV === "production") {
  console.error("Recusado: a demonstracao cria pessoas ficticias e nao roda com NODE_ENV=production.");
  process.exit(1);
}
if (!CHAVE_PUBLICA) {
  console.error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY nao encontrada em apps/web/.env.local. Rode: pnpm verificar");
  process.exit(1);
}

type Json = { ok: boolean; dados?: any; erro?: { codigo: string; mensagem: string } };

interface Pessoa {
  chave: string;
  email: string;
  nome: string;
  papel: "admin_clinica" | "medico" | "recepcao" | "paciente";
  nascimento: string;
  medico?: { crm: string; crmUf: string; especialidade: string };
}

const PESSOAS: Pessoa[] = [
  { chave: "admin", email: "demo.admin@exemplo.com", nome: "Ana Paula Souza", papel: "admin_clinica", nascimento: "1982-04-11" },
  {
    chave: "medico",
    email: "demo.medico@exemplo.com",
    nome: "Carlos Eduardo Mendes",
    papel: "medico",
    nascimento: "1979-09-02",
    medico: { crm: "123456", crmUf: "SP", especialidade: "Clínica médica" },
  },
  { chave: "recepcao", email: "demo.recepcao@exemplo.com", nome: "Juliana Lima Rocha", papel: "recepcao", nascimento: "1995-01-23" },
  { chave: "paciente", email: "demo.paciente@exemplo.com", nome: "Maria Fernanda Oliveira", papel: "paciente", nascimento: "1990-06-15" },
  { chave: "paciente2", email: "demo.paciente2@exemplo.com", nome: "João Pedro Almeida", papel: "paciente", nascimento: "1968-12-03" },
];

/** CPF com digitos verificadores validos (ficticio, so para a demonstracao). */
function gerarCpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b: number[]) => {
    const s = b.reduce((acc, d, i) => acc + d * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}

function gerarCnpj(): string {
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

const admin = createClient(SUPABASE_URL, CHAVE_SECRETA, { auth: { persistSession: false, autoRefreshToken: false } });
const publico = createClient(SUPABASE_URL, CHAVE_PUBLICA, { auth: { persistSession: false, autoRefreshToken: false } });

async function chamar(token: string, metodo: string, rota: string, corpo?: unknown, clinica?: string): Promise<{ status: number; json: Json }> {
  const r = await fetch(`${API}${rota}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      ...(clinica ? { "x-clinica": clinica } : {}),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  return { status: r.status, json: (await r.json()) as Json };
}

function exigir(r: { status: number; json: Json }, oQue: string): any {
  if (!r.json.ok) throw new Error(`${oQue}: ${r.status} ${r.json.erro?.codigo} - ${r.json.erro?.mensagem}`);
  return r.json.dados;
}

/** Cria (ou reaproveita) a conta no Auth com a senha nova, e faz login. */
async function conta(p: Pessoa, senha: string, senhaNova: boolean): Promise<{ id: string; token: string }> {
  const lista = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existente = lista.data.users.find((u) => u.email === p.email);
  let id: string;
  if (existente) {
    // Trocar a senha derruba as sessoes abertas: so troca se for nova.
    if (senhaNova) {
      const r = await admin.auth.admin.updateUserById(existente.id, { password: senha, email_confirm: true });
      if (r.error) throw new Error(`nao atualizou ${p.email}: ${r.error.message}`);
    }
    id = existente.id;
  } else {
    const r = await admin.auth.admin.createUser({ email: p.email, password: senha, email_confirm: true });
    if (r.error || !r.data.user) throw new Error(`nao criou ${p.email}: ${r.error?.message}`);
    id = r.data.user.id;
  }
  const login = await publico.auth.signInWithPassword({ email: p.email, password: senha });
  if (login.error || !login.data.session) throw new Error(`login de ${p.email} falhou: ${login.error?.message}`);
  return { id, token: login.data.session.access_token };
}

const passo = (m: string) => console.log(`  ok   ${m}`);

try {
  const saude = await fetch(`${API}/saude`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!saude?.ok) throw new Error(`a API nao respondeu em ${API}. Rode  pnpm dev  em outro terminal.`);

  // Reaproveita a senha ja gerada (quem esta testando nao perde o acesso a
  // cada execucao). Para trocar, apague demo-acessos.local.md e rode de novo.
  const anterior = existsSync(ARQUIVO) ? /Senha de todos:\*\* `([^`]+)`/.exec(readFileSync(ARQUIVO, "utf8"))?.[1] : undefined;
  const senha = anterior ?? `Demo-${randomBytes(4).toString("hex")}-${new Date().getFullYear()}`;
  const sessoes: Record<string, { id: string; token: string }> = {};

  // 1) Contas e perfis
  for (const p of PESSOAS) {
    const s = await conta(p, senha, !anterior);
    sessoes[p.chave] = s;
    const eu = await chamar(s.token, "GET", "/perfis/eu");
    if (eu.status === 404) {
      exigir(
        await chamar(s.token, "POST", "/perfis", {
          nomeCompleto: p.nome,
          telefone: "11999990000",
          cpf: gerarCpf(),
          paciente: { dataNascimento: p.nascimento },
          ...(p.medico ? { medico: p.medico } : {}),
        }),
        `perfil de ${p.email}`,
      );
    }
    // Contas ficticias: registram o aceite dos textos atuais (ADR-0018) para
    // quem testa entrar direto. Uma conta nova de verdade passa pela tela.
    const atual = exigir(await chamar(s.token, "GET", "/perfis/eu"), "perfil") as { consentimentosPendentes: string[] };
    if (atual.consentimentosPendentes.length > 0) {
      exigir(await chamar(s.token, "POST", "/lgpd/consentimentos", { tipos: atual.consentimentosPendentes }), "aceites");
    }
    passo(`${p.nome} (${p.email})`);
  }

  // 2) Clinica (a administracao cria e passa a administrar)
  const adm = sessoes.admin!;
  const perfilAdm = exigir(await chamar(adm.token, "GET", "/perfis/eu"), "perfil da administracao");
  if (!perfilAdm.clinicas.some((c: { slug: string }) => c.slug === SLUG)) {
    exigir(
      await chamar(adm.token, "POST", "/clinicas", {
        nomeFantasia: "Clínica Demonstração",
        razaoSocial: "Clinica Demonstracao Servicos Medicos LTDA",
        cnpj: gerarCnpj(),
        slug: SLUG,
      }),
      "criar clinica",
    );
  }
  passo(`clinica /c/${SLUG}`);

  // 3) Equipe por convite (como seria de verdade)
  for (const p of PESSOAS.filter((x) => x.papel === "medico" || x.papel === "recepcao")) {
    const s = sessoes[p.chave]!;
    const eu = exigir(await chamar(s.token, "GET", "/perfis/eu"), "perfil");
    if (eu.clinicas.some((c: { slug: string }) => c.slug === SLUG)) continue;
    const convite = exigir(await chamar(adm.token, "POST", "/convites", { email: p.email, papel: p.papel }, SLUG), `convite de ${p.email}`);
    const codigo = String(convite.linkDeAceite).split("/convite/")[1];
    exigir(await chamar(s.token, "POST", "/convites/aceitar", { codigo }), `aceite de ${p.email}`);
  }
  passo("medico e recepcao entraram por convite");

  // 3b) A administracao confere o CRM no Conselho (ADR-0016). Na vida real
  //     ela abre a busca do CFM; aqui registramos o que ela teria visto.
  const crm = exigir(await chamar(adm.token, "GET", "/crm/verificacoes", undefined, SLUG), "painel de CRM") as { id: string; nomeCompleto: string; situacao: string }[];
  for (const m of crm.filter((x) => x.situacao !== "verificado")) {
    exigir(
      await chamar(adm.token, "POST", `/medicos/${m.id}/crm`, { resultado: "verificado", nomeNoConselho: m.nomeCompleto.toUpperCase(), situacaoNoConselho: "Ativo", especialidadesNoConselho: "Clínica médica" }, SLUG),
      "verificar CRM",
    );
  }
  passo("CRM do medico conferido pela administracao");

  // 4) Clinica aberta para pacientes; pacientes entram pela porta publica
  exigir(await chamar(adm.token, "POST", "/clinicas/atual/status", { status: "ativa" }, SLUG), "ativar clinica");
  for (const p of PESSOAS.filter((x) => x.papel === "paciente")) {
    const s = sessoes[p.chave]!;
    const eu = exigir(await chamar(s.token, "GET", "/perfis/eu"), "perfil");
    if (!eu.clinicas.some((c: { slug: string }) => c.slug === SLUG)) {
      exigir(await chamar(s.token, "POST", `/clinicas/${SLUG}/entrar`), `entrada de ${p.email}`);
    }
  }
  passo("clinica aberta; pacientes cadastrados pelo link de entrada");

  // 5) Grade do medico: todos os dias, 07h as 22h, consultas de 30 min
  const med = sessoes.medico!;
  exigir(
    await chamar(
      med.token,
      "PUT",
      "/disponibilidades",
      { blocos: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: "07:00", horaFim: "22:00", duracaoMinutos: 30 })) },
      SLUG,
    ),
    "grade do medico",
  );
  passo("grade do medico: todos os dias, 07:00-22:00");

  // 6) Consultas (so se o medico ainda nao tiver nenhuma marcada)
  const agenda = exigir(await chamar(med.token, "GET", "/consultas", undefined, SLUG), "agenda do medico") as { status: string }[];
  if (agenda.filter((c) => c.status !== "cancelada").length === 0) {
    const fuso = "America/Sao_Paulo";
    const dia = (desloc: number) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date(Date.now() + desloc * 86400000));
    const livres = async (data: string) =>
      exigir(await chamar(med.token, "GET", `/horarios?medicoId=${med.id}&data=${data}`, undefined, SLUG), "horarios") as { inicio: string }[];

    const marcar = async (quem: string, inicio: string, motivo: string) =>
      exigir(await chamar(sessoes[quem]!.token, "POST", "/consultas", { medicoId: med.id, inicio, motivo }, SLUG), "marcar consulta") as { id: string };

    const hoje = await livres(dia(0));
    const amanha = await livres(dia(1));
    const depois = await livres(dia(2));

    // A primeira de hoje (ou de amanha, se o dia ja acabou) vira a consulta atendida.
    const primeira = hoje[0] ?? amanha.shift()!;
    const atendida = await marcar("paciente", primeira.inicio, "Dor de cabeça recorrente há duas semanas");
    if (hoje[2]) await marcar("paciente2", hoje[2].inicio, "Renovação de receita de anti-hipertensivo");
    if (amanha[4]) await marcar("paciente", amanha[4].inicio, "Retorno com resultado de exames");
    if (depois[6]) await marcar("paciente2", depois[6].inicio, "Check-up anual");
    passo("consultas marcadas para hoje e para os proximos dias");

    // 7) Um atendimento completo: prontuario finalizado + receita emitida
    exigir(await chamar(med.token, "POST", `/consultas/${atendida.id}/status`, { status: "em_andamento" }, SLUG), "iniciar consulta");
    const ev = exigir(await chamar(med.token, "POST", `/consultas/${atendida.id}/evolucao`, undefined, SLUG), "abrir evolucao") as { id: string };
    exigir(
      await chamar(
        med.token,
        "PATCH",
        `/evolucoes/${ev.id}`,
        {
          subjetivo: "Cefaleia frontal, pulsátil, 3 a 4 vezes por semana, pior ao fim do dia. Nega febre e alterações visuais.",
          objetivo: "Bom estado geral. PA referida 120x80 mmHg. Sem sinais neurológicos focais relatados.",
          avaliacao: "Cefaleia tensional provável.",
          plano: "Analgésico se dor, higiene do sono, hidratação. Retorno em 30 dias ou antes se piora.",
          cid10: "G44.2",
        },
        SLUG,
      ),
      "escrever evolucao",
    );
    exigir(await chamar(med.token, "POST", `/evolucoes/${ev.id}/finalizar`, undefined, SLUG), "finalizar evolucao");
    exigir(
      await chamar(
        med.token,
        "POST",
        "/documentos",
        {
          consultaId: atendida.id,
          tipo: "receita_simples",
          conteudo: { itens: [{ medicamento: "Dipirona 500 mg", posologia: "1 comprimido de 6 em 6 horas, se dor", quantidade: "1 caixa" }] },
        },
        SLUG,
      ),
      "emitir receita",
    );
    exigir(await chamar(med.token, "POST", `/consultas/${atendida.id}/status`, { status: "concluida" }, SLUG), "concluir consulta");
    passo("atendimento completo: prontuario finalizado e receita emitida (aguardando assinatura)");
  } else {
    passo("o medico ja tinha consultas - mantidas como estavam");
  }

  // 8) Prontuario da paciente principal: ficha e meses de sinais vitais
  //    (para os graficos de evolucao terem historia para contar).
  const maria = sessoes.paciente!;
  const ficha = exigir(await chamar(med.token, "GET", `/pacientes/${maria.id}/ficha`, undefined, SLUG), "ler ficha");
  if (!ficha) {
    exigir(
      await chamar(
        med.token,
        "POST",
        `/pacientes/${maria.id}/ficha`,
        {
          alergias: ["Penicilina"],
          medicamentosEmUso: ["Losartana 50 mg - 1 comprimido pela manhã", "Anticoncepcional oral"],
          comorbidades: "Hipertensão arterial leve, diagnosticada em 2024.",
          antecedentesFamiliares: "Mãe hipertensa. Pai com diabetes tipo 2.",
          cirurgiasInternacoes: "Apendicectomia (2012).",
          habitos: "Não fuma. Álcool social. Caminhada 3x por semana.",
          tipoSanguineo: "O+",
        },
        SLUG,
      ),
      "criar ficha",
    );
    const historico = [
      { dias: 180, pesoKg: 74.2, pressaoSistolica: 148, pressaoDiastolica: 94, frequenciaCardiaca: 82, glicemiaMgDl: 102 },
      { dias: 150, pesoKg: 73.5, pressaoSistolica: 142, pressaoDiastolica: 92, frequenciaCardiaca: 80, glicemiaMgDl: 99 },
      { dias: 120, pesoKg: 72.8, pressaoSistolica: 138, pressaoDiastolica: 88, frequenciaCardiaca: 78, glicemiaMgDl: 97 },
      { dias: 90, pesoKg: 71.9, pressaoSistolica: 134, pressaoDiastolica: 86, frequenciaCardiaca: 76, glicemiaMgDl: 95 },
      { dias: 60, pesoKg: 71.0, pressaoSistolica: 130, pressaoDiastolica: 84, frequenciaCardiaca: 74, glicemiaMgDl: 94 },
      { dias: 30, pesoKg: 70.4, pressaoSistolica: 126, pressaoDiastolica: 82, frequenciaCardiaca: 72, glicemiaMgDl: 92 },
    ];
    for (const h of historico) {
      const { dias, ...medidas } = h;
      exigir(
        await chamar(med.token, "POST", `/pacientes/${maria.id}/sinais`, { ...medidas, alturaCm: 165, medidoEm: new Date(Date.now() - dias * 86400000).toISOString() }, SLUG),
        "sinais vitais",
      );
    }
    exigir(await chamar(maria.token, "POST", `/pacientes/${maria.id}/sinais`, { pressaoSistolica: 124, pressaoDiastolica: 80, observacao: "Medido em casa, de manhã" }, SLUG), "medida da paciente");
    passo("prontuario da paciente: ficha clinica e 6 meses de sinais vitais");
  }

  const linhas = PESSOAS.map((p) => `| ${p.papel.padEnd(13)} | ${p.nome.padEnd(25)} | ${p.email.padEnd(27)} |`).join("\n");
  writeFileSync(
    ARQUIVO,
    `# Acessos da clinica de demonstracao

Gerado por \`pnpm demo:criar\` em ${new Date().toLocaleString("pt-BR")}.
Arquivo LOCAL, fora do Git. Rodar o comando de novo mantem a senha; para trocar, apague este arquivo.

**Senha de todos:** \`${senha}\`

| Papel         | Nome                      | E-mail                      |
| ------------- | ------------------------- | --------------------------- |
${linhas}

Entre em http://localhost:3000/entrar com qualquer um deles.
A clinica fica em http://localhost:3000/c/${SLUG}/inicio
`,
    "utf8",
  );

  console.log(`\nPronto. Os acessos (e-mails e senha) estao em demo-acessos.local.md, na raiz do projeto.`);
} catch (e) {
  console.error(`\n  ERRO ${(e as Error).message}`);
  process.exit(1);
}
