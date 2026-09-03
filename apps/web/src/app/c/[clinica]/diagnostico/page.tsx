import type { Resposta, StatusSaude } from "@tele/shared";
import { ambiente } from "@/lib/ambiente";
import { contextoDaClinica } from "@/lib/clinica";

/**
 * PAINEL DE CONEXOES (era a pagina inicial nos Modulos 2 a 4; agora vive em
 * /diagnostico e exige login - e ferramenta de quem opera o sistema).
 *
 * E um Server Component (nao tem "use client"): roda no servidor do Next e
 * o navegador recebe so o HTML pronto.
 *
 * Ela faz tres perguntas e mostra a resposta na tela:
 *   1. a nossa API (apps/api) esta no ar?
 *   2. a API consegue falar com o Supabase?
 *   3. (Modulo 3) o Postgres responde e as migracoes estao todas aplicadas?
 *   4. (Modulo 4) o RLS esta ligado nas 5 tabelas, com as politicas?
 *
 * Cinco luzes verdes = Modulo 4 completo. A partir do Modulo 5 esta pagina
 * vira a tela de entrada de verdade.
 */

async function consultarApi(): Promise<{ estado: "ok"; dados: StatusSaude } | { estado: "erro"; motivo: string }> {
  try {
    const resposta = await fetch(`${ambiente.apiUrl}/saude`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const json = (await resposta.json()) as Resposta<StatusSaude>;
    if (!json.ok) return { estado: "erro", motivo: json.erro.mensagem };
    return { estado: "ok", dados: json.dados };
  } catch {
    return {
      estado: "erro",
      motivo: `Sem resposta em ${ambiente.apiUrl}. A API esta rodando? (pnpm dev:api)`,
    };
  }
}

/** Texto da quarta luz: diz o que falta quando o banco nao esta pronto. */
function descreverBanco(banco: StatusSaude["banco"]): string {
  switch (banco.estado) {
    case "migrado":
      return `${banco.migracoesAplicadas} migracoes aplicadas. Tabelas: ${banco.tabelas.join(", ")}.`;
    case "faltam_migracoes":
      return `${banco.migracoesAplicadas} de ${banco.migracoesEsperadas} migracoes aplicadas. Rode: pnpm db:migrar`;
    case "sem_tabelas":
      return "O Postgres responde, mas nao tem nenhuma tabela. Rode: pnpm db:migrar";
    case "falhou":
      return "A API nao conseguiu falar com o Postgres. Confira DATABASE_URL em apps/api/.env (pnpm db:testar-conexao).";
  }
}

/** Texto da quinta luz (Modulo 4). */
function descreverSeguranca(seg: StatusSaude["seguranca"]): string {
  switch (seg.estado) {
    case "protegido":
      return `RLS ligado nas 5 tabelas, ${seg.politicas} politicas. Um usuario so ve o que as politicas permitem.`;
    case "incompleto":
      return seg.tabelasSemRls.length > 0
        ? `RLS DESLIGADO em: ${seg.tabelasSemRls.join(", ")}. Rode: pnpm db:migrar (ou pnpm db:verificar-rls para detalhes)`
        : `RLS ligado, mas faltam politicas ou permissoes (${seg.politicas} politicas). Rode: pnpm db:verificar-rls`;
    case "desconhecido":
      return "Depende da luz do banco.";
  }
}

function Luz({ ligada, rotulo, detalhe }: { ligada: boolean; rotulo: string; detalhe: string }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-linha bg-superficie p-4">
      <span
        aria-hidden="true"
        className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-full ${ligada ? "bg-ok" : "bg-alerta"}`}
      />
      <div>
        <p className="font-semibold">
          {rotulo}: {ligada ? "conectado" : "falhou"}
        </p>
        <p className="text-sm text-tinta-suave">{detalhe}</p>
      </div>
    </li>
  );
}

export const metadata = { title: "Diagnostico" };

export default async function PaginaDiagnostico({ params }: { params: Promise<{ clinica: string }> }) {
  // Exige vinculo com a clinica do endereco: diagnostico e ferramenta de
  // quem opera, nao pagina publica.
  const { clinica: slug } = await params;
  await contextoDaClinica(slug);
  const api = await consultarApi();

  return (
    <section>
      <h1 className="mb-2 font-titulo text-3xl tracking-tight">Painel de conexoes</h1>
      <p className="mb-6 text-tinta-suave">
        Se as cinco luzes abaixo estiverem verdes, o banco do Modulo 4 esta pronto e protegido.
      </p>

      <ul className="space-y-3">
        <Luz
          ligada={true}
          rotulo="Site (apps/web)"
          detalhe={`Variaveis lidas de apps/web/.env.local. Supabase: ${ambiente.supabaseUrl}`}
        />
        <Luz
          ligada={api.estado === "ok"}
          rotulo="API (apps/api)"
          detalhe={api.estado === "ok" ? `Respondeu em ${ambiente.apiUrl}/saude as ${api.dados.horario}` : api.motivo}
        />
        <Luz
          ligada={api.estado === "ok" && api.dados.supabase === "conectado"}
          rotulo="Supabase (via API)"
          detalhe={
            api.estado === "ok"
              ? api.dados.supabase === "conectado"
                ? "A chave secreta em apps/api/.env esta correta."
                : "A API subiu, mas SUPABASE_URL ou SUPABASE_SECRET_KEY em apps/api/.env estao errados."
              : "Depende da API estar no ar."
          }
        />
        <Luz
          ligada={api.estado === "ok" && api.dados.banco.estado === "migrado"}
          rotulo="Banco (packages/db)"
          detalhe={
            api.estado === "ok"
              ? descreverBanco(api.dados.banco)
              : "Depende da API estar no ar."
          }
        />
        <Luz
          ligada={api.estado === "ok" && api.dados.seguranca.estado === "protegido"}
          rotulo="Seguranca por linha (RLS)"
          detalhe={
            api.estado === "ok"
              ? descreverSeguranca(api.dados.seguranca)
              : "Depende da API estar no ar."
          }
        />
      </ul>
    </section>
  );
}
