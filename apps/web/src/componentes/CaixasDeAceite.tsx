"use client";

import Link from "next/link";
import type { TipoConsentimento } from "@tele/shared";

const TEXTO: Record<TipoConsentimento, React.ReactNode> = {
  termos_de_uso: (
    <>
      Li e aceito os{" "}
      <Link href="/termos" target="_blank" className="font-medium text-selo underline underline-offset-2">
        Termos de uso
      </Link>
      .
    </>
  ),
  politica_de_privacidade: (
    <>
      Li a{" "}
      <Link href="/privacidade" target="_blank" className="font-medium text-selo underline underline-offset-2">
        Política de privacidade
      </Link>{" "}
      e entendo como meus dados de saúde são tratados.
    </>
  ),
  telemedicina: (
    <>
      Consinto com o atendimento por telemedicina e conheço suas limitações (
      <Link href="/termos#telemedicina" target="_blank" className="font-medium text-selo underline underline-offset-2">
        ler o termo
      </Link>
      ).
    </>
  ),
};

/**
 * As caixas de aceite (LGPD art. 8: consentimento por escrito, destacado,
 * para finalidade determinada). Nenhuma vem marcada: aceite pre-marcado
 * nao e consentimento.
 */
export function CaixasDeAceite({
  tipos,
  marcados,
  aoMudar,
  erro,
}: {
  tipos: TipoConsentimento[];
  marcados: Set<TipoConsentimento>;
  aoMudar: (m: Set<TipoConsentimento>) => void;
  erro?: string | null;
}) {
  return (
    <fieldset className="space-y-2.5 rounded-xl border border-linha bg-superficie-alt p-4">
      <legend className="sr-only">Aceites obrigatórios</legend>
      {tipos.map((t) => (
        <label key={t} className="flex items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[var(--color-selo)]"
            checked={marcados.has(t)}
            onChange={(e) => {
              const n = new Set(marcados);
              if (e.target.checked) n.add(t);
              else n.delete(t);
              aoMudar(n);
            }}
          />
          <span>{TEXTO[t]}</span>
        </label>
      ))}
      {erro ? (
        <p role="alert" className="text-sm text-alerta">
          {erro}
        </p>
      ) : null}
    </fieldset>
  );
}
