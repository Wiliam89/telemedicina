import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type Variante = "principal" | "secundario" | "fantasma" | "perigo";
export type Tamanho = "p" | "m" | "g";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px";

const VARIANTES: Record<Variante, string> = {
  principal: "bg-selo text-white shadow-cartao hover:bg-selo-forte",
  secundario: "border border-linha-forte bg-superficie text-tinta shadow-cartao hover:border-selo/50 hover:bg-selo-suave",
  fantasma: "text-tinta-suave hover:bg-marinho-suave hover:text-tinta",
  perigo: "bg-alerta text-white shadow-cartao hover:bg-alerta/90",
};

const TAMANHOS: Record<Tamanho, string> = {
  p: "px-3 py-1.5 text-sm",
  m: "px-4 py-2.5 text-sm",
  g: "px-6 py-3.5 text-base",
};

/** As classes de um botao, para quando o "botao" precisa ser outro elemento. */
export function classesDeBotao(variante: Variante = "principal", tamanho: Tamanho = "m", extra?: string) {
  return `${BASE} ${VARIANTES[variante]} ${TAMANHOS[tamanho]} ${extra ?? ""}`;
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  carregando?: boolean;
  icone?: ReactNode;
}

export function Botao({ variante = "principal", tamanho = "m", carregando, icone, children, className, disabled, ...resto }: Props) {
  return (
    <button
      className={classesDeBotao(variante, tamanho, className)}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...resto}
    >
      {carregando ? (
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icone
      )}
      {carregando ? "Aguarde..." : children}
    </button>
  );
}

interface PropsLink extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variante?: Variante;
  tamanho?: Tamanho;
  icone?: ReactNode;
}

/** Um link com cara de botao (navegacao, nao acao). */
export function LinkBotao({ href, variante = "principal", tamanho = "m", icone, children, className, ...resto }: PropsLink) {
  return (
    <Link href={href} className={classesDeBotao(variante, tamanho, className)} {...resto}>
      {icone}
      {children}
    </Link>
  );
}
