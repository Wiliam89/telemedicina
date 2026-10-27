import Link from "next/link";
import { NOME_DA_PLATAFORMA } from "@/lib/marca";

/**
 * A marca da plataforma: um simbolo (cruz medica dentro de um balao de
 * conversa - consulta a distancia) e o nome. SVG inline: nada para baixar,
 * nitido em qualquer tamanho, e herda a cor do tema.
 */
export function Simbolo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--color-selo)" />
      <path d="M8 10.5A3.5 3.5 0 0 1 11.5 7h9A3.5 3.5 0 0 1 24 10.5v7a3.5 3.5 0 0 1-3.5 3.5H15l-4.5 4v-4A2.5 2.5 0 0 1 8 18.5Z" fill="#fff" fillOpacity="0.18" />
      <path d="M14.5 9.5h3v3.5H21v3h-3.5v3.5h-3V16H11v-3h3.5Z" fill="#fff" />
    </svg>
  );
}

export function Marca({ href = "/", clara = false }: { href?: string; clara?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Página inicial">
      <Simbolo />
      <span className={`font-titulo text-lg font-semibold tracking-tight ${clara ? "text-white" : "text-tinta"}`}>{NOME_DA_PLATAFORMA}</span>
    </Link>
  );
}
