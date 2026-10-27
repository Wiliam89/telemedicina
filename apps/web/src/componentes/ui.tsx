import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Pecas de interface usadas em todas as telas de dentro da plataforma.
 * Ficam juntas porque sao pequenas e andam sempre em conjunto: uma tela
 * tipica e um CabecalhoDaPagina seguido de Cartoes.
 */

export function CabecalhoDaPagina({
  titulo,
  descricao,
  sobretitulo,
  acoes,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  sobretitulo?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {sobretitulo ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-selo">{sobretitulo}</p> : null}
        <h1 className="text-2xl text-tinta sm:text-[1.75rem]">{titulo}</h1>
        {descricao ? <p className="max-w-2xl text-sm leading-relaxed text-tinta-suave">{descricao}</p> : null}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </header>
  );
}

export function Cartao({
  titulo,
  descricao,
  acoes,
  children,
  className,
  semPadding,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
  semPadding?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-linha bg-superficie shadow-cartao ${className ?? ""}`}>
      {titulo || acoes ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha px-5 py-4">
          <div className="min-w-0">
            {titulo ? <h2 className="text-base text-tinta">{titulo}</h2> : null}
            {descricao ? <p className="mt-0.5 text-sm text-tinta-suave">{descricao}</p> : null}
          </div>
          {acoes ? <div className="flex items-center gap-2">{acoes}</div> : null}
        </div>
      ) : null}
      <div className={semPadding ? "" : "p-5"}>{children}</div>
    </section>
  );
}

const TONS = {
  neutro: "bg-marinho-suave text-tinta-suave ring-linha-forte/60",
  selo: "bg-selo-suave text-selo-forte ring-selo/25",
  alerta: "bg-alerta-suave text-alerta ring-alerta/25",
  espera: "bg-espera-suave text-espera ring-espera/25",
  info: "bg-info-suave text-info ring-info/25",
} as const;

export type Tom = keyof typeof TONS;

/** Etiqueta curta de estado (agendada, assinado, na fila...). */
export function Etiqueta({ tom = "neutro", children }: { tom?: Tom; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONS[tom]}`}>
      {children}
    </span>
  );
}

/** Numero de destaque do painel ("3 consultas hoje"). */
export function Indicador({
  rotulo,
  valor,
  detalhe,
  Icone,
  tom = "selo",
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  Icone: LucideIcon;
  tom?: Tom;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${TONS[tom]}`}>
        <Icone aria-hidden="true" className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-tinta-suave">{rotulo}</p>
        <p className="mt-0.5 font-titulo text-2xl font-semibold text-tinta">{valor}</p>
        {detalhe ? <p className="mt-0.5 text-xs text-tinta-suave">{detalhe}</p> : null}
      </div>
    </div>
  );
}

/** Estado vazio: diz que nao ha nada E o que fazer a seguir. */
export function Vazio({ Icone, titulo, children, acao }: { Icone: LucideIcon; titulo: string; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-linha-forte bg-superficie-alt px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-selo-suave text-selo">
        <Icone aria-hidden="true" className="h-6 w-6" />
      </span>
      <p className="font-medium text-tinta">{titulo}</p>
      {children ? <div className="max-w-md text-sm text-tinta-suave">{children}</div> : null}
      {acao ? <div className="pt-1">{acao}</div> : null}
    </div>
  );
}

/** Circulo com as iniciais da pessoa. */
export function Avatar({ nome, tamanho = "m" }: { nome: string; tamanho?: "p" | "m" | "g" }) {
  const partes = nome.trim().split(/\s+/);
  const iniciais = ((partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "")).toUpperCase();
  const medida = tamanho === "p" ? "h-8 w-8 text-xs" : tamanho === "g" ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm";
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-marinho font-semibold text-white ${medida}`}>
      {iniciais || "?"}
    </span>
  );
}
