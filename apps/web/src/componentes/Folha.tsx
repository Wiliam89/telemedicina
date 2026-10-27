import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Pagina avulsa centralizada (escolher clinica, completar perfil, convite,
 * validar documento): titulo em cima e o conteudo num cartao branco.
 */
export function Folha({
  Icone,
  sobretitulo,
  titulo,
  descricao,
  largura = "md",
  semCartao,
  children,
}: {
  Icone?: LucideIcon;
  sobretitulo?: ReactNode;
  titulo: ReactNode;
  descricao?: ReactNode;
  largura?: "md" | "lg" | "xl";
  semCartao?: boolean;
  children: ReactNode;
}) {
  const max = largura === "md" ? "max-w-md" : largura === "lg" ? "max-w-xl" : "max-w-3xl";
  return (
    <div className={`mx-auto w-full ${max} px-4 py-12 sm:py-16`}>
      <div className="mb-7 space-y-3 text-center">
        {Icone ? (
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-selo-suave text-selo ring-1 ring-inset ring-selo/20">
            <Icone className="h-6 w-6" aria-hidden="true" />
          </span>
        ) : null}
        {sobretitulo ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-selo">{sobretitulo}</p> : null}
        <h1 className="text-2xl text-tinta sm:text-3xl">{titulo}</h1>
        {descricao ? <p className="text-sm leading-relaxed text-tinta-suave">{descricao}</p> : null}
      </div>
      {semCartao ? children : <div className="rounded-2xl border border-linha bg-superficie p-6 shadow-cartao sm:p-8">{children}</div>}
    </div>
  );
}
