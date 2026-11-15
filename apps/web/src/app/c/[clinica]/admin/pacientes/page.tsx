import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PacienteNaAdministracao } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { ListaDePacientes } from "./ListaDePacientes";

export const metadata: Metadata = { title: "Pacientes" };

const FILTROS = [
  ["todos", "Todos"],
  ["com_faltas", "Com faltas"],
  ["com_pendencia", "Com pagamento pendente"],
  ["restritos", "Impedidos de marcar"],
] as const;

/**
 * PACIENTES, PELA ADMINISTRACAO (ADR-0027): cadastro e numeros, nunca dado
 * clinico. Daqui a administracao impede (ou libera) um paciente de marcar,
 * por fraude ou abuso, sempre com motivo registrado.
 */
export default async function PaginaPacientesDaAdministracao({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ filtro?: string }> }) {
  const { clinica: slug } = await params;
  const { filtro } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();
  const filtroValido = FILTROS.some(([v]) => v === filtro) ? filtro! : "todos";
  const r = await chamarApi<PacienteNaAdministracao[]>(`/admin/pacientes?filtro=${filtroValido}`, { token, clinica: slug });

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo="Administração"
        titulo="Pacientes"
        descricao="Cadastro, consultas, faltas e pendências de cada paciente. Prontuário, queixas e receitas não aparecem aqui: são só do médico que atende."
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="filtro" className="block text-sm font-medium">Mostrar</label>
          <select id="filtro" name="filtro" defaultValue={filtroValido} className={`${CLASSE_CONTROLE} border-linha`}>
            {FILTROS.map(([v, n]) => (
              <option key={v} value={v}>{n}</option>
            ))}
          </select>
        </div>
        <Botao type="submit" variante="secundario">Filtrar</Botao>
      </form>

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : (
        <ListaDePacientes key={filtroValido} slug={slug} fuso={clinica.fusoHorario} filtro={filtroValido} inicial={r.dados} />
      )}
      <p className="text-sm text-tinta-suave">
        Mostra até 300 pacientes por vez: use a busca para achar alguém. Pedidos sobre dados pessoais (correção, cópia, exclusão) ficam em{" "}
        <Link href={`/c/${slug}/privacidade`} className="text-selo underline underline-offset-4">Pedidos LGPD</Link>.
      </p>
    </div>
  );
}
