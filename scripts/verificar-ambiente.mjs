/**
 * =====================================================================
 * pnpm verificar
 * =====================================================================
 *
 * Confere, um por um, os requisitos dos Modulos 2 a 11. Para cada item que falha,
 * diz O QUE esta errado e ONDE resolver. A ideia e que ninguem precise
 * adivinhar nada: se o script passa, o ambiente esta pronto.
 *
 * Roda com Node puro, sem dependencias.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let falhas = 0;
const ok = (msg) => console.log(`  ok   ${msg}`);
const erro = (msg, dica) => {
  falhas++;
  console.log(`  ERRO ${msg}`);
  if (dica) console.log(`       -> ${dica}`);
};
const aviso = (msg, dica) => {
  console.log(`  !    ${msg}`);
  if (dica) console.log(`       -> ${dica}`);
};

/** Le um arquivo .env e devolve { CHAVE: valor }. Ignora comentarios. */
function lerEnv(caminho) {
  const conteudo = readFileSync(caminho, "utf8");
  const vars = {};
  for (const linha of conteudo.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const i = limpa.indexOf("=");
    if (i === -1) continue;
    vars[limpa.slice(0, i).trim()] = limpa.slice(i + 1).trim();
  }
  return vars;
}

function versaoDe(comando, args) {
  const r = spawnSync(comando, args, { encoding: "utf8", shell: process.platform === "win32" });
  return r.status === 0 ? r.stdout.trim() : null;
}

console.log("\n== Verificando o ambiente ==\n");

/* ---------------------------------------------------------------- */
/* 1. Ferramentas                                                    */
/* ---------------------------------------------------------------- */
console.log("[1/14] Ferramentas");

const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) ok(`Node ${process.versions.node}`);
else erro(`Node ${process.versions.node} e antigo`, "Instale a versao LTS: nvm install --lts && nvm use --lts");

const pnpm = versaoDe("pnpm", ["--version"]);
if (pnpm) ok(`pnpm ${pnpm}`);
else erro("pnpm nao encontrado", "Rode: corepack enable && corepack prepare pnpm@latest --activate");

const git = versaoDe("git", ["--version"]);
if (git) ok(git);
else erro("git nao encontrado", "Instale em https://git-scm.com");

/* ---------------------------------------------------------------- */
/* 2. Estrutura de pastas                                            */
/* ---------------------------------------------------------------- */
console.log("\n[2/14] Estrutura do projeto");

for (const p of ["pnpm-workspace.yaml", "apps/web/package.json", "apps/api/package.json",
                 "packages/shared/package.json", "packages/db/package.json", "docs"]) {
  if (existsSync(resolve(raiz, p))) ok(p);
  else erro(`${p} nao existe`, "O projeto esta incompleto. Reextraia o zip do curso.");
}

if (existsSync(resolve(raiz, "node_modules"))) ok("node_modules (dependencias instaladas)");
else erro("node_modules nao existe", "Rode: pnpm install  (na raiz do projeto)");

/* ---------------------------------------------------------------- */
/* 3. Arquivos .env                                                  */
/* ---------------------------------------------------------------- */
console.log("\n[3/14] Arquivos de ambiente");

const ESPERADO = {
  "apps/api/.env": {
    SUPABASE_URL: {
      valida: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(v),
      onde: "botao Connect (topo da tela) > aba do framework, campo NEXT_PUBLIC_SUPABASE_URL",
    },
    SUPABASE_SECRET_KEY: {
      valida: (v) => v.startsWith("sb_secret_") || v.startsWith("eyJ"),
      onde: "Settings > API Keys > secao Secret keys (sb_secret_...)",
    },
    DATABASE_URL: {
      valida: (v) => v.startsWith("postgresql://") && !v.includes("[YOUR-PASSWORD]"),
      onde: "botao Connect > aba ORMs > Drizzle. Use o Session pooler (porta 5432), nao a conexao direta",
    },
    PORT: { valida: (v) => /^\d+$/.test(v), onde: "Deixe 3333" },
    ORIGEM_PERMITIDA: { valida: (v) => v.startsWith("http"), onde: "Deixe http://localhost:3000" },
  },
  "apps/web/.env.local": {
    NEXT_PUBLIC_SUPABASE_URL: {
      valida: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(v),
      onde: "botao Connect (topo da tela) > aba do framework, campo NEXT_PUBLIC_SUPABASE_URL",
    },
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
      valida: (v) => v.startsWith("sb_publishable_") || v.startsWith("eyJ"),
      onde: "Settings > API Keys > secao Publishable key (sb_publishable_...)",
    },
    NEXT_PUBLIC_API_URL: { valida: (v) => v.startsWith("http"), onde: "Deixe http://localhost:3333" },
  },
};

const lidos = {};

for (const [arquivo, vars] of Object.entries(ESPERADO)) {
  const caminho = resolve(raiz, arquivo);
  if (!existsSync(caminho)) {
    erro(`${arquivo} nao existe`, "Rode: pnpm configurar");
    continue;
  }
  ok(`${arquivo} existe`);
  const env = lerEnv(caminho);
  lidos[arquivo] = env;

  for (const [nome, regra] of Object.entries(vars)) {
    const valor = env[nome] ?? "";
    if (!valor) {
      erro(`${arquivo}: ${nome} esta vazio`, `Pegue em: ${regra.onde}`);
    } else if (!regra.valida(valor)) {
      erro(`${arquivo}: ${nome} tem formato inesperado`, `Confira em: ${regra.onde}`);
    } else {
      ok(`${nome} preenchido`);
    }
  }
}

/* ---------------------------------------------------------------- */
/* 4. Seguranca                                                      */
/* ---------------------------------------------------------------- */
console.log("\n[4/14] Seguranca das chaves");

const web = lidos["apps/web/.env.local"];
if (web) {
  const vazou = Object.entries(web).find(
    ([k, v]) => k.startsWith("NEXT_PUBLIC_") && (v.startsWith("sb_secret_") || /service_role/i.test(k)),
  );
  if (vazou) {
    erro(`CHAVE SECRETA NO FRONTEND: ${vazou[0]}`,
      "Remova AGORA. Essa chave vai para o navegador de todo mundo. Depois rotacione a chave no painel do Supabase.");
  } else {
    ok("nenhuma chave secreta com prefixo NEXT_PUBLIC_");
  }
}

const api = lidos["apps/api/.env"];
if (api?.SUPABASE_SECRET_KEY && api.SUPABASE_SECRET_KEY.startsWith("sb_publishable_")) {
  erro("apps/api/.env: SUPABASE_SECRET_KEY contem uma chave PUBLICAVEL",
    "A API precisa da chave secreta (sb_secret_...). Voce copiou a chave errada.");
}

const rastreado = spawnSync("git", ["ls-files", "--error-unmatch", "apps/api/.env", "apps/web/.env.local"],
  { cwd: raiz, encoding: "utf8" });
if (rastreado.status === 0) {
  erro("um arquivo .env esta sendo rastreado pelo Git",
    "Rode: git rm --cached apps/api/.env apps/web/.env.local  e depois rotacione as chaves.");
} else {
  ok(".env fora do Git");
}

const gitignore = existsSync(resolve(raiz, ".gitignore")) ? readFileSync(resolve(raiz, ".gitignore"), "utf8") : "";
if (/^\.env$/m.test(gitignore) && /^\.env\.local$/m.test(gitignore)) ok(".gitignore cobre .env e .env.local");
else erro(".gitignore nao cobre os arquivos .env", "Adicione as linhas .env e .env.local ao .gitignore");

/* ---------------------------------------------------------------- */
/* 5. Regiao                                                         */
/* ---------------------------------------------------------------- */
console.log("\n[5/14] Regiao dos dados (exigencia juridica)");

if (api?.DATABASE_URL) {
  if (api.DATABASE_URL.includes("sa-east-1")) ok("DATABASE_URL aponta para sa-east-1 (Sao Paulo)");
  else aviso("DATABASE_URL nao contem 'sa-east-1'",
    "Se o projeto NAO foi criado em South America (Sao Paulo), crie outro. Nao da para mudar a regiao depois.");
}

if (existsSync(resolve(raiz, "docs/adr-0001-regiao-sao-paulo.md"))) ok("decisao da regiao registrada em docs/");
else aviso("docs/adr-0001-regiao-sao-paulo.md nao existe", "Registre a decisao (modelo no Modulo 2, secao 7).");

/* ---------------------------------------------------------------- */
/* 6. Banco (Modulo 3)                                               */
/* ---------------------------------------------------------------- */
console.log("\n[6/14] Tabelas e migracoes do banco (Modulo 3)");

const pastaMigracoes = resolve(raiz, "packages/db/drizzle");
if (existsSync(resolve(pastaMigracoes, "meta/_journal.json"))) {
  const journal = JSON.parse(readFileSync(resolve(pastaMigracoes, "meta/_journal.json"), "utf8"));
  ok(`${journal.entries.length} migracao(oes) em packages/db/drizzle/`);
} else {
  erro("packages/db/drizzle/ nao existe", "O projeto esta incompleto. Reextraia o zip do Modulo 3.");
}

const urlValida = api?.DATABASE_URL && ESPERADO["apps/api/.env"].DATABASE_URL.valida(api.DATABASE_URL);
if (!urlValida) {
  aviso("DATABASE_URL vazia ou invalida: as tabelas serao conferidas quando ela estiver certa");
} else if (!existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem node_modules: rode pnpm install para conferir as tabelas");
} else {
  // Delega para packages/db (precisa da biblioteca postgres, que so existe la).
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-tabelas"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir o banco\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* 7. RLS (Modulo 4)                                                 */
/* ---------------------------------------------------------------- */
console.log("\n[7/14] Seguranca por linha - RLS (Modulo 4)");

if (!urlValida) {
  aviso("DATABASE_URL vazia ou invalida: o RLS sera conferido quando ela estiver certa");
} else if (!existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem node_modules: rode pnpm install para conferir o RLS");
} else {
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-rls"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir o RLS\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* 8. Site: login e telas (Modulo 5)                                 */
/* ---------------------------------------------------------------- */
console.log("\n[8/14] Site: login, sessao e telas (Modulo 5)");

const TELAS = ["src/middleware.ts", "src/app/entrar/page.tsx", "src/app/criar-conta/page.tsx",
               "src/app/completar-perfil/page.tsx", "src/app/clinicas/page.tsx", "src/app/clinicas/nova/page.tsx",
               "src/app/c/[clinica]/inicio/page.tsx", "src/app/c/[clinica]/equipe/page.tsx",
               "src/app/c/[clinica]/diagnostico/page.tsx", "src/app/convite/[codigo]/page.tsx",
               "src/lib/supabase-servidor.ts", "src/lib/api.ts", "src/lib/clinica.ts"];
const telasFaltando = TELAS.filter((t) => !existsSync(resolve(raiz, "apps/web", t)));
if (telasFaltando.length === 0) ok("as telas e o middleware do Modulo 5 estao no lugar");
else erro(`faltam arquivos em apps/web: ${telasFaltando.join(", ")}`, "Reextraia o zip do Modulo 5.");

// Extrair o zip por cima nao apaga o que saiu do projeto. Estes arquivos
// foram substituidos em modulos anteriores e, se ficarem, viram rotas
// fantasma (uma delas chegou a ficar acessivel sem login).
const REMOVIDOS = [
  "apps/web/src/app/inicio/page.tsx",
  "apps/web/src/app/diagnostico/page.tsx",
  "apps/api/src/rotas/medicos.ts",
];
const sobraram = REMOVIDOS.filter((f) => existsSync(resolve(raiz, f)));
if (sobraram.length === 0) ok("nenhum arquivo de modulo anterior sobrando");
else erro(`arquivos que deveriam ter sido removidos: ${sobraram.join(", ")}`, "Apague-os: eles viram rotas fantasma. `git rm <arquivo>` e commit.");

const pkgWeb = JSON.parse(readFileSync(resolve(raiz, "apps/web/package.json"), "utf8"));
if (pkgWeb.dependencies?.["@supabase/ssr"]) ok("@supabase/ssr declarado em apps/web (sessao em cookie)");
else erro("@supabase/ssr nao esta em apps/web/package.json", "Reextraia o zip do Modulo 5 e rode pnpm install.");

// O site chama a API pelo navegador (formularios): a origem tem de bater com o CORS da API.
if (api?.ORIGEM_PERMITIDA && web?.NEXT_PUBLIC_API_URL) {
  const origens = api.ORIGEM_PERMITIDA.split(",").map((o) => o.trim());
  if (origens.includes("http://localhost:3000")) ok("ORIGEM_PERMITIDA da API inclui http://localhost:3000 (CORS ok para os formularios)");
  else erro(`ORIGEM_PERMITIDA=${api.ORIGEM_PERMITIDA} nao inclui http://localhost:3000`, "Em desenvolvimento deixe http://localhost:3000, senao o navegador bloqueia o POST /perfis.");
  const porta = api.PORT ?? "3333";
  if (web.NEXT_PUBLIC_API_URL === `http://localhost:${porta}`) ok(`NEXT_PUBLIC_API_URL aponta para a porta ${porta} da API`);
  else aviso(`NEXT_PUBLIC_API_URL=${web.NEXT_PUBLIC_API_URL} e a API esta em PORT=${porta}`, "Os dois precisam combinar.");
}

/* ---------------------------------------------------------------- */
/* 9. Multi-clinica (Modulo 6)                                       */
/* ---------------------------------------------------------------- */
console.log("\n[9/14] Isolamento entre clinicas (Modulo 6)");

if (!urlValida || !existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem DATABASE_URL valida ou sem node_modules: o isolamento sera conferido depois");
} else {
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-clinicas"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir o isolamento\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* 10. Agenda (Modulo 7)                                             */
/* ---------------------------------------------------------------- */
console.log("\n[10/14] Agenda e travas de marcacao (Modulo 7)");

if (!urlValida || !existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem DATABASE_URL valida ou sem node_modules: a agenda sera conferida depois");
} else {
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-agenda"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir a agenda\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* 11. Prontuario e documentos (Modulo 8)                            */
/* ---------------------------------------------------------------- */
console.log("\n[11/14] Prontuario imutavel e documentos (Modulo 8)");

if (!urlValida || !existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem DATABASE_URL valida ou sem node_modules: o prontuario sera conferido depois");
} else {
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-prontuario"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir o prontuario\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* 12. Assinatura ICP-Brasil (Modulo 9)                              */
/* ---------------------------------------------------------------- */
console.log("\n[12/14] Assinatura digital dos documentos (Modulo 9)");

const provedorAssinatura = api?.ASSINATURA_PROVEDOR ?? "local_teste";
if (provedorAssinatura === "local_teste") {
  aviso("ASSINATURA_PROVEDOR=local_teste: as assinaturas NAO tem valor legal",
        "Serve para desenvolvimento. Para valer, contrate um provedor ICP-Brasil (secao 3 do PDF do Modulo 9).");
} else {
  const faltando = ["ASSINATURA_URL", "ASSINATURA_CLIENT_ID", "ASSINATURA_CLIENT_SECRET"].filter((v) => !api?.[v]);
  if (faltando.length === 0) ok(`provedor de assinatura: ${provedorAssinatura}, com credenciais`);
  else erro(`ASSINATURA_PROVEDOR=${provedorAssinatura} mas falta: ${faltando.join(", ")}`, "Preencha em apps/api/.env (secao 3 do PDF do Modulo 9).");
}

if (!urlValida || !existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem DATABASE_URL valida ou sem node_modules: as assinaturas serao conferidas depois");
} else {
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-assinatura"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir as assinaturas\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* 13. Pagamento (Modulo 10)                                         */
/* ---------------------------------------------------------------- */
console.log("\n[13/14] Pagamento e split (Modulo 10)");

if (!api?.PAGAMENTO_WEBHOOK_SEGREDO) {
  aviso("PAGAMENTO_WEBHOOK_SEGREDO nao definido: o webhook usa um segredo de desenvolvimento",
        "Em producao, defina-o em apps/api/.env com o mesmo valor configurado no painel do provedor.");
}
if (!api?.URL_PUBLICA_API) {
  aviso("URL_PUBLICA_API nao definida: o provedor nao consegue notificar localhost",
        "Em desenvolvimento use um tunel (ngrok, cloudflared) e ponha a URL aqui.");
}

if (!urlValida || !existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem DATABASE_URL valida ou sem node_modules: os pagamentos serao conferidos depois");
} else {
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-pagamento"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir os pagamentos\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* 14. Plantao e fila (Modulo 11)                                    */
/* ---------------------------------------------------------------- */
console.log("\n[14/14] Plantao e fila de pronto atendimento (Modulo 11)");

if (!urlValida || !existsSync(resolve(raiz, "node_modules"))) {
  aviso("sem DATABASE_URL valida ou sem node_modules: a fila sera conferida depois");
} else {
  const r = spawnSync("pnpm", ["--silent", "--filter", "@tele/db", "verificar-fila"], {
    cwd: raiz, encoding: "utf8", shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) {
    falhas++;
    if (!(r.stdout ?? "").includes("ERRO")) console.log(`  ERRO nao foi possivel conferir a fila\n${r.stderr ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
console.log("");
if (falhas === 0) {
  console.log("Tudo certo. Proximo passo: pnpm dev e abra http://localhost:3000\n");
  process.exit(0);
} else {
  console.log(`${falhas} item(ns) para resolver. Corrija e rode  pnpm verificar  de novo.\n`);
  process.exit(1);
}
