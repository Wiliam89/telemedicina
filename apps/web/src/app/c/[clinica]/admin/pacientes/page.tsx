import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Contact } from "lucide-react";
import type { PacienteNaAdministracao } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { Avatar, CabecalhoDaPagina, Cartao, Etiqueta, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { dataCurta } from "@/lib/datas";
import { temPapel } from "@/lib/papeis";
import { RestricaoDoPaciente } from "./RestricaoDoPaciente";

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
export default async function PaginaPacientesDaAdministracao({ params, searchParams }: { params: Promise<{ clinica: string }>; searchParams: Promise<{ busca?: string; filtro?: string }> }) {
  const { clinica: slug } = await params;
  const { busca, filtro } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();
  const filtroValido = FILTROS.some(([v]) => v === filtro) ? filtro! : "todos";
  const q = new URLSearchParams({ filtro: filtroValido, ...(busca?.trim() ? { busca: busca.trim().slice(0, 80) } : {}) });
  const r = await chamarApi<PacienteNaAdministracao[]>(`/admin/pacientes?${q}`, { token, clinica: slug });

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo="Administração"
        titulo="Pacientes"
        descricao="Cadastro, consultas, faltas e pendências de cada paciente. Prontuário, queixas e receitas não aparecem aqui: são só do médico que atende."
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label htmlFor="busca" className="block text-sm font-medium">Buscar por nome ou CPF</label>
          <input id="busca" name="busca" defaultValue={busca ?? ""} maxLength={80} className={`${CLASSE_CONTROLE} border-linha`} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filtro" className="block text-sm font-medium">Mostrar</label>
          <select id="filtro" name="filtro" defaultValue={filtroValido} className={`${CLASSE_CONTROLE} border-linha`}>
            {FILTROS.map(([v, n]) => (
              <option key={v} value={v}>{n}</option>
            ))}
          </select>
        </div>
        <Botao type="submit" variante="secundario">Buscar</Botao>
      </form>

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : r.dados.length === 0 ? (
        <Vazio Icone={Contact} titulo="Nenhum paciente encontrado">Mude a busca ou o filtro.</Vazio>
      ) : (
        <Cartao semPadding>
          <ul className="divide-y divide-linha">
            {r.dados.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <Avatar nome={p.nomeCompleto} tamanho="p" />
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{p.nomeCompleto}</p>
                    {p.restricao ? <Etiqueta tom="alerta">Impedido de marcar</Etiqueta> : null}
                    {p.faltas > 0 ? <Etiqueta tom="espera">{p.faltas} falta(s)</Etiqueta> : null}
                    {p.pagamentosPendentes > 0 ? <Etiqueta tom="alerta">{p.pagamentosPendentes} pagamento(s) pendente(s)</Etiqueta> : null}
                  </div>
                  <p className="text-sm text-tinta-suave">
                    CPF {p.cpfMascarado ?? "não informado"} · {p.telefone ?? "sem telefone"} · desde {dataCurta(p.cadastradoEm, clinica.fusoHorario)} · {p.consultasConcluidas} consulta(s) concluída(s)
                  </p>
                  {p.restricao ? (
                    <p className="text-sm text-alerta">
                      Motivo: {p.restricao.motivo} (desde {dataCurta(p.restricao.desde, clinica.fusoHorario)})
                    </p>
                  ) : null}
                </div>
                <RestricaoDoPaciente slug={slug} pacienteId={p.id} restrito={Boolean(p.restricao)} />
              </li>
            ))}
          </ul>
        </Cartao>
      )}
      <p className="text-sm text-tinta-suave">
        Mostra até 300 pacientes por vez: use a busca para achar alguém. Pedidos sobre dados pessoais (correção, cópia, exclusão) ficam em{" "}
        <Link href={`/c/${slug}/privacidade`} className="text-selo underline underline-offset-4">Pedidos LGPD</Link>.
      </p>
    </div>
  );
}
