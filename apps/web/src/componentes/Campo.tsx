import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Um campo de formulario com rotulo, ajuda e erro ligados ao input por
 * aria-* (leitor de tela anuncia tudo junto). O erro fica sempre no mesmo
 * lugar, abaixo do campo, em texto - nunca so em cor.
 */
interface Props extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  rotulo: string;
  ajuda?: ReactNode;
  erro?: string | null;
}

export function Campo({ id, rotulo, ajuda, erro, className, ...resto }: Props) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-tinta">
        {rotulo}
      </label>
      <input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={[ajuda ? `${id}-ajuda` : null, erro ? `${id}-erro` : null].filter(Boolean).join(" ") || undefined}
        className={
          "w-full rounded-md border bg-superficie px-3 py-2 text-base text-tinta placeholder:text-tinta-suave/60 " +
          (erro ? "border-alerta" : "border-linha") +
          " " +
          (className ?? "")
        }
        {...resto}
      />
      {ajuda ? (
        <p id={`${id}-ajuda`} className="text-xs text-tinta-suave">
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={`${id}-erro`} role="alert" className="text-sm text-alerta">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
