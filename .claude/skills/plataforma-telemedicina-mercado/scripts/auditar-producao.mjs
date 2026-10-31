#!/usr/bin/env node
/**
 * Auditoria somente leitura do ambiente publicado: nao faz login e nao grava.
 * Uso: node auditar-producao.mjs [url-do-site] [url-da-api]
 * Sai com codigo 1 se algum item REPROVAR.
 */
const SITE = (process.argv[2] ?? "https://telemedicina-lake.vercel.app").replace(/\/$/, "");
const API = (process.argv[3] ?? "https://telemedicina-4b3h.onrender.com").replace(/\/$/, "");
const TEMPO_LIMITE = 90_000;

let reprovados = 0;
function item(ok, nome, detalhe = "") {
  if (!ok) reprovados++;
  console.log(`${ok ? "OK      " : "REPROVA "} ${nome}${detalhe ? ` (${detalhe})` : ""}`);
}
function aviso(nome, detalhe = "") {
  console.log(`ATENCAO  ${nome}${detalhe ? ` (${detalhe})` : ""}`);
}
const buscar = (url, opcoes = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TEMPO_LIMITE), ...opcoes });

console.log(`\nSite: ${SITE}\nAPI:  ${API}\n`);

// --- site ------------------------------------------------------------------
const capa = await buscar(`${SITE}/`);
item(capa.status === 200, "capa responde", `HTTP ${capa.status}`);
for (const c of ["strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "content-security-policy", "permissions-policy"]) {
  item(Boolean(capa.headers.get(c)), `cabecalho ${c}`);
}
item(!capa.headers.get("x-powered-by"), "nao anuncia a tecnologia");

const regiao = capa.headers.get("x-vercel-id") ?? "";
const funcao = regiao.split("::").at(-2) ?? "?";
if (funcao === "gru1") item(true, "site renderiza em Sao Paulo", regiao);
else aviso("site renderiza fora de Sao Paulo", `regiao ${funcao}; a Politica precisa dizer isso, e gru1 so depois de medir o tempo de resposta`);

const protegida = await buscar(`${SITE}/c/x/inicio`);
item(protegida.status === 307 && (protegida.headers.get("location") ?? "").includes("/entrar"), "pagina interna exige login", `HTTP ${protegida.status}`);

for (const p of ["/entrar", "/criar-conta", "/validar", "/privacidade", "/termos", "/recuperar-senha", "/icon.svg"]) {
  const r = await buscar(`${SITE}${p}`);
  item(r.status === 200, `pagina ${p}`, `HTTP ${r.status}`);
}

// --- API -------------------------------------------------------------------
const saude = await buscar(`${API}/saude`);
item(saude.status === 200, "API /saude", `HTTP ${saude.status}`);
const dados = (await saude.json().catch(() => null))?.dados;
if (dados) {
  item(dados.banco?.estado === "migrado", "migracoes em dia", `${dados.banco?.migracoesAplicadas}/${dados.banco?.migracoesEsperadas}`);
  item(dados.seguranca?.estado === "protegido", "RLS completo", `${dados.seguranca?.politicas} politicas`);
  item(!dados.banco?.tabelas?.length, "/saude nao expoe nomes de tabelas");
  if (!dados.videoReal) aviso("sem videochamada real neste ambiente");
  if (!dados.documentosComValorLegal) aviso("documentos sem valor legal neste ambiente");
}
for (const [rota, esperado] of [["/vivo", 200], ["/pronto", 200], ["/perfis/eu", 401]]) {
  const r = await buscar(`${API}${rota}`);
  item(r.status === esperado, `API ${rota}`, `HTTP ${r.status}, esperado ${esperado}`);
}
const cors = await buscar(`${API}/vivo`, { headers: { origin: "https://site-estranho.example" } });
item(!cors.headers.get("access-control-allow-origin"), "CORS recusa origem desconhecida");
item(Boolean(cors.headers.get("x-request-id")), "resposta traz x-request-id");

console.log(`\n${reprovados === 0 ? "Nenhum item reprovado." : `${reprovados} item(ns) reprovado(s).`}\nEste script nao substitui a auditoria de codigo: veja references/checklist-sem-bugs.md.\n`);
process.exit(reprovados === 0 ? 0 : 1);
