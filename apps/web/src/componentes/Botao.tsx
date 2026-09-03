import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: "principal" | "secundario";
  carregando?: boolean;
}

export function Botao({ variante = "principal", carregando, children, className, disabled, ...resto }: Props) {
  const base = "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const estilo =
    variante === "principal"
      ? "bg-selo text-white hover:bg-selo/90"
      : "border border-linha bg-superficie text-tinta hover:bg-selo-suave";
  return (
    <button className={`${base} ${estilo} ${className ?? ""}`} disabled={disabled || carregando} aria-busy={carregando || undefined} {...resto}>
      {carregando ? "Aguarde..." : children}
    </button>
  );
}
