import { AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react";
import type { ReactNode } from "react";

const ESTILOS = {
  erro: { caixa: "border-alerta/30 bg-alerta-suave text-alerta", Icone: AlertTriangle },
  ok: { caixa: "border-selo/30 bg-selo-suave text-selo-forte", Icone: CheckCircle2 },
  espera: { caixa: "border-espera/30 bg-espera-suave text-espera", Icone: Clock },
  info: { caixa: "border-linha bg-superficie text-tinta-suave", Icone: Info },
} as const;

/** Caixa de mensagem. "erro" diz o que aconteceu e o que fazer; "info" orienta. */
export function Aviso({ tipo = "info", children }: { tipo?: keyof typeof ESTILOS; children: ReactNode }) {
  const { caixa, Icone } = ESTILOS[tipo];
  return (
    <div role={tipo === "erro" ? "alert" : "status"} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed ${caixa}`}>
      <Icone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
