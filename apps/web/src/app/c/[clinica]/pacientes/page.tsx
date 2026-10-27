import { ChevronRight, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PacienteNaLista } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { Avatar, CabecalhoDaPagina, Etiqueta, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";

export const metadata: Metadata = { title: "Pacientes" };

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/**
 * Lista de pacientes da clinica, com busca por nome ou CPF. A equipe ve o
 * cadastro; o prontuario abre so para o medico que atende (a API decide).
 * Formulario GET puro: a busca vai na URL e funciona sem JavaScript.
 */
export default async function PaginaPacientes({
  params,
  searchParams,
}: {
  params: Promise<{ clinica: string }>;
  searchParams: Promise<{ busca?: string; meus?: string }>;
}) {
  const { clinica: slug } = await params;
  const { busca = "", meus } = await searchParams;
  const { token, clinica } = await contextoDaClinica(slug);
  if (clinica.papel === "paciente") notFound();

  const souMedico = temPapel(clinica, "medico");
  const soMeus = souMedico && meus !== "0";
  const consulta = new URLSearchParams({ ...(busca ? { busca } : {}), ...(soMeus ? { meus: "1" } : {}) });
  const r = await chamarApi<PacienteNaLista[]>(`/pacientes?${consulta}`, { token, clinica: slug });

  return (
    <div className="space-y-6">
      <CabecalhoDaPagina
        titulo="Pacientes"
        descricao={souMedico ? "Seus pacientes e o prontuário de cada um." : "Cadastro dos pacientes da clínica. Dados clínicos ficam restritos ao médico que atende."}
      />

      <form className="flex flex-wrap items-center gap-3" role="search">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-suave" aria-hidden="true" />
          <label htmlFor="busca" className="sr-only">
            Buscar paciente
          </label>
          <input id="busca" name="busca" defaultValue={busca} placeholder="Buscar por nome ou CPF" className={`${CLASSE_CONTROLE} border-linha pl-9`} />
        </div>
        {souMedico ? (
          <select name="meus" defaultValue={soMeus ? "1" : "0"} className={`${CLASSE_CONTROLE} w-auto border-linha`} aria-label="Quais pacientes">
            <option value="1">Meus pacientes</option>
            <option value="0">Todos da clínica</option>
          </select>
        ) : null}
        <Botao type="submit" variante="secundario">
          Buscar
        </Botao>
      </form>

      {!r.ok ? (
        <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
      ) : r.dados.length === 0 ? (
        <Vazio Icone={Users} titulo={busca ? "Nenhum paciente encontrado" : "Nenhum paciente ainda"}>
          {busca ? "Confira a grafia ou busque pelo CPF." : souMedico ? "Os pacientes que você atender aparecem aqui." : "Divulgue o link de entrada da clínica (tela Equipe)."}
        </Vazio>
      ) : (
        <div className="overflow-hidden rounded-xl border border-linha bg-superficie shadow-cartao">
          <div className="hidden grid-cols-[1fr_7rem_9rem_10rem_1.5rem] gap-4 border-b border-linha bg-superficie-alt px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-tinta-suave md:grid">
            <span>Paciente</span>
            <span>Consultas</span>
            <span>Última</span>
            <span>Próxima</span>
            <span />
          </div>
          <ul className="divide-y divide-linha">
            {r.dados.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/c/${slug}/pacientes/${p.id}`}
                  className="grid grid-cols-[1fr_1.5rem] items-center gap-4 px-5 py-3.5 transition-colors hover:bg-superficie-alt md:grid-cols-[1fr_7rem_9rem_10rem_1.5rem]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar nome={p.nomeCompleto} tamanho="p" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.nomeCompleto}</span>
                      <span className="block text-sm text-tinta-suave">
                        {p.idade !== null ? `${p.idade} anos` : "Idade não informada"}
                        {p.telefone ? ` · ${p.telefone}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="hidden text-sm md:block">{p.totalConsultas}</span>
                  <span className="hidden text-sm md:block">{p.ultimaConsulta ? data(p.ultimaConsulta) : "—"}</span>
                  <span className="hidden md:block">{p.proximaConsulta ? <Etiqueta tom="info">{data(p.proximaConsulta)}</Etiqueta> : <span className="text-sm text-tinta-suave">—</span>}</span>
                  <ChevronRight className="h-4 w-4 text-tinta-suave" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
