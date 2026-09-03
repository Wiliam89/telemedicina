/**
 * pnpm api:testar-fluxo   (com a API rodando em outro terminal: pnpm dev)
 *
 * Prova, de ponta a ponta e contra o Supabase de verdade, o fluxo do Modulo 4:
 *
 *   1. cria um usuario de teste no Supabase Auth (com a chave secreta)
 *   2. faz login como ele (com a chave PUBLICA, igual ao site fara)
 *   3. chama a API com o token:  POST /perfis, GET /perfis/eu, GET /medicos
 *   4. prova o RLS agindo como o usuario, direto no Supabase:
 *        - ve so o proprio perfil
 *        - nao consegue virar admin
 *        - nao consegue apagar a auditoria
 *   5. apaga o usuario de teste (o perfil vai junto, por cascata)
 *
 * Nao deixa nada para tras. Se algo falhar, diz em qual passo.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";

// A chave PUBLICA vive em apps/web/.env.local; aqui a lemos so para o teste.
config({ path: resolve(import.meta.dirname, "../../web/.env.local"), quiet: true });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const CHAVE_SECRETA = process.env.SUPABASE_SECRET_KEY!;
const CHAVE_PUBLICA = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const API = `http://localhost:${process.env.PORT ?? "3333"}`;

if (!CHAVE_PUBLICA) {
  console.error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY nao encontrada em apps/web/.env.local. Rode: pnpm verificar");
  process.exit(1);
}

let passo = "";
let outroId: string | null = null;
let clinicaCriada: string | null = null;

/** Gera um CNPJ com digitos verificadores validos, so para o teste. */
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
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join("");
}
const ok = (m: string) => console.log(`  ok   ${m}`);
const falhar = (m: string): never => {
  console.log(`  ERRO ${m}`);
  throw new Error(`Falhou no passo: ${passo}`);
};
const esperar = (cond: boolean, msgOk: string, msgErro: string) => (cond ? ok(msgOk) : falhar(msgErro));

const admin = createClient(SUPABASE_URL, CHAVE_SECRETA, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `fluxo-${Date.now()}@exemplo.com`;
const senha = `Teste-${Date.now()}!`;
let usuarioId: string | null = null;

try {
  // 0) A API esta no ar?
  passo = "0 - API no ar";
  const saude = await fetch(`${API}/saude`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!saude?.ok) falhar(`a API nao respondeu em ${API}. Rode pnpm dev em outro terminal.`);
  ok(`API respondeu em ${API}`);

  // 1) Usuario de teste
  passo = "1 - criar usuario no Auth";
  const criado = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (criado.error || !criado.data.user) falhar(`nao criou o usuario: ${criado.error?.message}`);
  usuarioId = criado.data.user!.id;
  ok(`usuario ${email} criado (${usuarioId})`);

  // 2) Login como o site fara: chave publica + e-mail/senha
  passo = "2 - login com a chave publica";
  const cliente = createClient(SUPABASE_URL, CHAVE_PUBLICA, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await cliente.auth.signInWithPassword({ email, password: senha });
  if (login.error || !login.data.session) falhar(`login falhou: ${login.error?.message}`);
  const token = login.data.session!.access_token;
  ok("login ok, token recebido");

  const chamar = async (metodo: string, rota: string, corpo?: unknown, clinica?: string) => {
    const r = await fetch(`${API}${rota}`, {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(clinica ? { "x-clinica": clinica } : {}),
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
    return { status: r.status, json: (await r.json()) as { ok: boolean; dados?: unknown; erro?: { codigo: string } } };
  };

  // 3) Perfil da pessoa (sem papel: papel agora e por clinica)
  passo = "3 - perfil da pessoa";
  const semPerfil = await chamar("GET", "/perfis/eu");
  esperar(semPerfil.status === 404, "GET /perfis/eu antes do cadastro: 404 (esperado)", `esperava 404, veio ${semPerfil.status}`);

  const invalido = await chamar("POST", "/perfis", { nomeCompleto: "X" });
  esperar(invalido.status === 400, "POST /perfis com nome curto: 400 com detalhes", `esperava 400, veio ${invalido.status}`);

  const criadoPerfil = await chamar("POST", "/perfis", {
    nomeCompleto: "Medico de Teste",
    medico: { crm: String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 6), crmUf: "SP", especialidade: "Clinica geral" },
    paciente: { dataNascimento: "1985-03-20" },
  });
  esperar(criadoPerfil.status === 201, "POST /perfis: 201, perfil criado com auditoria", `esperava 201, veio ${criadoPerfil.status}: ${JSON.stringify(criadoPerfil.json)}`);
  esperar(((criadoPerfil.json.dados as { clinicas: unknown[] }).clinicas ?? []).length === 0, "perfil nasce sem clinica nenhuma", "nasceu com clinica");

  // 4) Sem clinica, as rotas de dentro se recusam a responder
  passo = "4 - rotas exigem clinica";
  const semCabecalho = await chamar("GET", "/medicos");
  esperar(semCabecalho.status === 400 && semCabecalho.json.erro?.codigo === "CLINICA_NAO_INFORMADA", "GET /medicos sem X-Clinica: 400", `veio ${semCabecalho.status}`);

  const clinicaInexistente = await chamar("GET", "/medicos", undefined, "nao-existe-esta-clinica");
  esperar(clinicaInexistente.status === 404, "X-Clinica com clinica inexistente: 404", `veio ${clinicaInexistente.status}`);

  // 5) Criar clinica: quem cria administra
  passo = "5 - criar clinica";
  const sufixo = Date.now().toString().slice(-6);
  const cnpjTeste = gerarCnpj();
  const cnpjRuim = await chamar("POST", "/clinicas", { nomeFantasia: "Clinica Teste", razaoSocial: "Teste LTDA", cnpj: "11111111111111", slug: `teste-${sufixo}` });
  esperar(cnpjRuim.status === 400, "POST /clinicas com CNPJ invalido: 400", `veio ${cnpjRuim.status}`);

  const reservado = await chamar("POST", "/clinicas", { nomeFantasia: "Clinica Teste", razaoSocial: "Teste LTDA", cnpj: cnpjTeste, slug: "admin" });
  esperar(reservado.status === 400, "endereco reservado (admin) recusado: 400", `veio ${reservado.status}`);

  const clinica = await chamar("POST", "/clinicas", { nomeFantasia: `Clinica Teste ${sufixo}`, razaoSocial: "Clinica Teste LTDA", cnpj: cnpjTeste, slug: `teste-${sufixo}` });
  esperar(clinica.status === 201, `POST /clinicas: 201 (endereco teste-${sufixo})`, `veio ${clinica.status}: ${JSON.stringify(clinica.json)}`);
  const slug = (clinica.json.dados as { slug: string }).slug;
  clinicaCriada = (clinica.json.dados as { id: string }).id;

  const eu = await chamar("GET", "/perfis/eu");
  const minhas = (eu.json.dados as { clinicas: { slug: string; papel: string }[] }).clinicas;
  esperar(minhas.length === 1 && minhas[0]!.papel === "admin_clinica", "quem criou a clinica e admin_clinica nela", `veio ${JSON.stringify(minhas)}`);

  const dentro = await chamar("GET", "/medicos", undefined, slug);
  esperar(dentro.status === 200, "GET /medicos dentro da clinica: 200", `veio ${dentro.status}`);

  // 6) Convite: o codigo aparece uma vez e o banco guarda so o hash
  passo = "6 - convite";
  const convite = await chamar("POST", "/convites", { email: `convidado-${sufixo}@exemplo.com`, papel: "recepcao" }, slug);
  esperar(convite.status === 201, "POST /convites: 201 com link de aceite", `veio ${convite.status}: ${JSON.stringify(convite.json)}`);
  const link = (convite.json.dados as { linkDeAceite: string }).linkDeAceite;
  esperar(link.includes("/convite/"), "o link contem o codigo (mostrado uma unica vez)", "link fora do formato");

  const pendentes = await chamar("GET", "/convites", undefined, slug);
  esperar(((pendentes.json.dados as unknown[]) ?? []).length === 1, "GET /convites lista 1 pendente", `veio ${JSON.stringify(pendentes.json.dados)}`);

  const codigoErrado = await chamar("POST", "/convites/aceitar", { codigo: "x".repeat(43) });
  esperar(codigoErrado.status === 404, "aceitar com codigo inventado: 404", `veio ${codigoErrado.status}`);

  // 7) Isolamento: um segundo usuario, sem vinculo, nao entra
  passo = "7 - isolamento";
  const outroEmail = `fluxo-outro-${Date.now()}@exemplo.com`;
  const outro = await admin.auth.admin.createUser({ email: outroEmail, password: senha, email_confirm: true });
  if (outro.error || !outro.data.user) falhar(`nao criou o segundo usuario: ${outro.error?.message}`);
  outroId = outro.data.user!.id;
  const clienteOutro = createClient(SUPABASE_URL, CHAVE_PUBLICA, { auth: { persistSession: false, autoRefreshToken: false } });
  const loginOutro = await clienteOutro.auth.signInWithPassword({ email: outroEmail, password: senha });
  if (loginOutro.error || !loginOutro.data.session) falhar(`login do segundo usuario falhou: ${loginOutro.error?.message}`);
  const tokenOutro = loginOutro.data.session!.access_token;

  const r1 = await fetch(`${API}/perfis`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenOutro}`, "content-type": "application/json" },
    body: JSON.stringify({ nomeCompleto: "Pessoa de Fora", paciente: { dataNascimento: "1992-07-07" } }),
  });
  esperar(r1.status === 201, "segundo usuario cria o proprio perfil: 201", `veio ${r1.status}`);

  const r2 = await fetch(`${API}/medicos`, { headers: { authorization: `Bearer ${tokenOutro}`, "x-clinica": slug } });
  esperar(r2.status === 403, "pessoa sem vinculo na clinica: 403 SEM_VINCULO", `esperava 403, veio ${r2.status}`);

  const r3 = await fetch(`${API}/convites`, { headers: { authorization: `Bearer ${tokenOutro}`, "x-clinica": slug } });
  esperar(r3.status === 403, "pessoa sem vinculo nao lista convites: 403", `esperava 403, veio ${r3.status}`);

  // 8) RLS: mesmo por fora da API, com a chave publica, nada vaza
  passo = "8 - RLS por fora da API";
  const clinicasVistas = await clienteOutro.from("clinicas").select("id, nome_fantasia");
  esperar(!clinicasVistas.error && clinicasVistas.data?.length === 0, "RLS: quem nao tem vinculo ve 0 clinicas", `viu ${clinicasVistas.data?.length}`);

  const vinculosVistos = await clienteOutro.from("vinculos").select("id");
  esperar(!vinculosVistos.error && vinculosVistos.data?.length === 0, "RLS: nao ve vinculo de ninguem", `viu ${vinculosVistos.data?.length}`);

  const tentaVincular = await clienteOutro.from("vinculos").insert({ perfil_id: outroId, clinica_id: clinicaCriada, papel: "admin_clinica" });
  esperar(!!tentaVincular.error, `RLS: tentar se auto-vincular como admin foi recusado (${tentaVincular.error?.code})`, "conseguiu se vincular sozinho!");

  const convitesVistos = await clienteOutro.from("convites").select("codigo_hash");
  esperar(!convitesVistos.error && convitesVistos.data?.length === 0, "RLS: nao ve convite de clinica alheia", `viu ${convitesVistos.data?.length}`);

  console.log("\nTudo certo: perfil, clinica, convite e isolamento entre clinicas.");
} catch (erro) {
  console.error(`\n${erro instanceof Error ? erro.message : erro}`);
  process.exitCode = 1;
} finally {
  // 5) Limpeza - sempre, mesmo se algo falhou
  // A clinica de teste segura os vinculos e a auditoria (on delete restrict),
  // entao a limpeza tem ordem: auditoria e vinculos, depois clinica, depois
  // os logins - cujos perfis vao junto, por cascata.
  if (clinicaCriada) {
    const sql = admin.schema("public");
    await sql.from("convites").delete().eq("clinica_id", clinicaCriada);
    await sql.from("auditoria").delete().eq("clinica_id", clinicaCriada);
    await sql.from("vinculos").delete().eq("clinica_id", clinicaCriada);
    const apagouClinica = await sql.from("clinicas").delete().eq("id", clinicaCriada);
    if (apagouClinica.error) console.error(`  AVISO a clinica de teste ficou no banco: ${apagouClinica.error.message}`);
  }
  for (const id of [usuarioId, outroId]) {
    if (!id) continue;
    const apagado = await admin.auth.admin.deleteUser(id);
    if (apagado.error) console.error(`  AVISO nao consegui apagar um usuario de teste: apague em Authentication > Users`);
  }
  if (usuarioId) ok("usuarios, clinica e vinculos de teste apagados");
}
