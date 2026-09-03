import type { ReactNode } from "react";

/** Caixa de mensagem. "erro" diz o que aconteceu e o que fazer; "info" orienta. */
export function Aviso({ tipo = "info", children }: { tipo?: "erro" | "info" | "ok"; children: ReactNode }) {
  const estilo =
    tipo === "erro" ? "border-alerta/40 bg-alerta-suave text-alerta" : tipo === "ok" ? "border-selo/40 bg-selo-suave text-selo" : "border-linha bg-superficie text-tinta-suave";
  return (
    <div role={tipo === "erro" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${estilo}`}>
      {children}
    </div>
  );
}
