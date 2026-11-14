import { CalendarPlus, Zap } from "lucide-react";
import Link from "next/link";
import { emReais } from "@/lib/dinheiro";

/**
 * Os dois modos de cada linha de atendimento (ADR-0024): ser atendido AGORA
 * (fila; o primeiro medico online que aceitar atende) ou AGENDAR um horario
 * com o medico escolhido. Server Component: sao dois links.
 */
export function EscolhaDeModo({
  base,
  online,
  medicos,
  valorImediatoCentavos,
  valorAgendadoCentavos,
}: {
  /** Endereco da pagina, ja com os parametros fixos (ex.: "/c/x/teleconsulta?especialidade=cardiologia"). */
  base: string;
  online: number;
  medicos: number;
  valorImediatoCentavos: number | null;
  valorAgendadoCentavos: number | null;
}) {
  const sep = base.includes("?") ? "&" : "?";
  const opcoes = [
    {
      modo: "agora",
      Icone: Zap,
      titulo: "Atendimento agora",
      texto: "Você entra na fila e é atendido pelo primeiro médico que aceitar.",
      detalhe: online > 0 ? `${online} médico(s) online agora` : "Nenhum médico online neste momento",
      vivo: online > 0,
      valor: valorImediatoCentavos,
    },
    {
      modo: "agendar",
      Icone: CalendarPlus,
      titulo: "Agendar horário",
      texto: "Você escolhe o médico, o dia e a hora.",
      detalhe: `${medicos} médico(s) disponível(is)`,
      vivo: false,
      valor: valorAgendadoCentavos,
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {opcoes.map(({ modo, Icone, titulo, texto, detalhe, vivo, valor }) => (
        <Link
          key={modo}
          href={`${base}${sep}modo=${modo}`}
          className="group flex flex-col gap-3 rounded-xl border border-linha bg-superficie p-5 shadow-cartao transition-colors hover:border-selo/60 hover:bg-selo-suave/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-selo/20"
        >
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-selo-suave text-selo ring-1 ring-inset ring-selo/20">
            <Icone className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="block font-titulo text-lg text-tinta">{titulo}</span>
          <span className="block text-sm text-tinta-suave">{texto}</span>
          <span className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
            <span className="text-xs text-tinta-suave">
              {vivo ? <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-selo align-middle" /> : null}
              {detalhe}
            </span>
            <span className="font-titulo text-lg text-tinta">{valor !== null ? emReais(valor) : "—"}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
