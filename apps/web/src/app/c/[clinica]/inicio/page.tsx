import type { Metadata } from "next";
import type { MedicoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { BarraDaClinica } from "@/componentes/BarraDaClinica";
import { Carimbo } from "@/componentes/Carimbo";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { NOME_DO_PAPEL } from "@/lib/papeis";
import { formatarCpf } from "@/lib/validacao";

export const metadata: Metadata = { title: "Inicio" };

/**
 * A tela inicial DENTRO de uma clinica. Tudo aqui e daquela clinica: o
 * papel exibido, os medicos listados e, nos proximos modulos, a agenda.
 */
export default async function PaginaInicio({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  const medicos = await chamarApi<MedicoResumo[]>("/medicos", { token, clinica: slug });

  return (
    <div className="space-y-10">
      <BarraDaClinica clinica={clinica} outras={perfil.clinicas} />

      <section className="space-y-4">
        <p className="text-xs uppercase tracking-[0.2em] text-tinta-suave">Bem-vindo(a)</p>
        <h1 className="font-titulo text-4xl tracking-tight">{perfil.nomeCompleto}</h1>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <Carimbo>{NOME_DO_PAPEL[clinica.papel]}</Carimbo>
          {perfil.medico ? <Carimbo>{`CRM ${perfil.medico.crm}-${perfil.medico.crmUf}`}</Carimbo> : null}
          {perfil.cpf ? <Carimbo>{`CPF ${formatarCpf(perfil.cpf)}`}</Carimbo> : null}
        </div>
        <dl className="grid gap-x-8 gap-y-2 pt-2 text-sm sm:grid-cols-2">
          {perfil.medico?.especialidade ? (
            <>
              <dt className="text-tinta-suave">Especialidade</dt>
              <dd>{perfil.medico.especialidade}</dd>
            </>
          ) : null}
          {perfil.paciente ? (
            <>
              <dt className="text-tinta-suave">Data de nascimento</dt>
              <dd>{new Date(`${perfil.paciente.dataNascimento}T00:00:00`).toLocaleDateString("pt-BR")}</dd>
            </>
          ) : null}
          <dt className="text-tinta-suave">Telefone</dt>
          <dd>{perfil.telefone ?? "nao informado"}</dd>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="font-titulo text-2xl tracking-tight">Medicos em {clinica.nomeFantasia}</h2>
        {!medicos.ok ? (
          <Aviso tipo="erro">{medicos.erro.mensagem}</Aviso>
        ) : medicos.dados.length === 0 ? (
          <Aviso>
            Nenhum medico nesta clinica ainda.{" "}
            {clinica.papel === "admin_clinica" ? "Convide a equipe na tela Equipe." : "A administracao pode convidar a equipe."}
          </Aviso>
        ) : (
          <ul className="divide-y divide-linha overflow-hidden rounded-lg border border-linha bg-superficie">
            {medicos.dados.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium">{m.nomeCompleto}</p>
                  <p className="text-sm text-tinta-suave">{m.especialidade ?? "Especialidade nao informada"}</p>
                </div>
                <span className="font-mono text-xs text-tinta-suave">CRM {m.crm}-{m.crmUf}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-tinta-suave">Agenda e marcacao de consulta entram no Modulo 7.</p>
      </section>
    </div>
  );
}
