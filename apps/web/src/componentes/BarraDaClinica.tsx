import Link from "next/link";
import type { ClinicaResumo } from "@tele/shared";
import { NOME_DO_PAPEL } from "@/lib/papeis";

/**
 * Barra que diz, o tempo todo, EM QUAL CLINICA voce esta e COM QUAL PAPEL.
 * Num sistema onde a mesma pessoa atende em varios lugares, esquecer isso
 * e a origem do erro mais caro possivel: registrar no lugar errado.
 */
export function BarraDaClinica({ clinica, outras }: { clinica: ClinicaResumo; outras: ClinicaResumo[] }) {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-linha bg-superficie px-4 py-3">
      <div className="flex items-baseline gap-3">
        <span className="font-titulo text-lg">{clinica.nomeFantasia}</span>
        <span className="text-xs uppercase tracking-[0.15em] text-tinta-suave">{NOME_DO_PAPEL[clinica.papel]}</span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <Link href={`/c/${clinica.slug}/agenda`} className="text-selo underline-offset-4 hover:underline">
          Agenda
        </Link>
        <Link href={`/c/${clinica.slug}/documentos`} className="text-tinta-suave underline-offset-4 hover:underline">
          Documentos
        </Link>
        {clinica.papel === "paciente" ? (
          <Link href={`/c/${clinica.slug}/pronto-atendimento`} className="text-selo underline-offset-4 hover:underline">
            Pronto atendimento
          </Link>
        ) : (
          <Link href={`/c/${clinica.slug}/plantao`} className="text-tinta-suave underline-offset-4 hover:underline">
            Plantao
          </Link>
        )}
        {clinica.papel === "medico" ? (
          <Link href={`/c/${clinica.slug}/grade`} className="text-tinta-suave underline-offset-4 hover:underline">
            Meus horarios
          </Link>
        ) : null}
        {clinica.papel === "admin_clinica" ? (
          <Link href={`/c/${clinica.slug}/precos`} className="text-tinta-suave underline-offset-4 hover:underline">
            Valores
          </Link>
        ) : null}
        {clinica.papel === "admin_clinica" ? (
          <Link href={`/c/${clinica.slug}/equipe`} className="text-selo underline-offset-4 hover:underline">
            Equipe
          </Link>
        ) : null}
        {outras.length > 1 ? (
          <Link href="/clinicas" className="text-tinta-suave underline-offset-4 hover:underline">
            Trocar de clinica
          </Link>
        ) : null}
      </div>
    </div>
  );
}
