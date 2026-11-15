"use client";

import { Contact } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PacienteNaAdministracao } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { Avatar, Cartao, Etiqueta, Vazio } from "@/componentes/ui";
import { dataCurta } from "@/lib/datas";
import { acaoNaApi } from "@/lib/navegador";
import { RestricaoDoPaciente } from "./RestricaoDoPaciente";

/**
 * A lista e a busca. A busca (nome ou CPF) vai no CORPO de um POST, nunca no
 * endereco da pagina: endereco fica em log de servidor e no historico (LGPD).
 */
export function ListaDePacientes({ slug, fuso, filtro, inicial }: { slug: string; fuso: string; filtro: string; inicial: PacienteNaAdministracao[] }) {
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function buscar(e: { preventDefault(): void } | FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    const r = await acaoNaApi<PacienteNaAdministracao[]>("/admin/pacientes/buscar", { metodo: "POST", clinica: slug, corpo: { filtro, ...(busca.trim() ? { busca: busca.trim() } : {}) } });
    setOcupado(false);
    if (r.ok) setLista(r.dados);
    else setErro(r.erro.mensagem);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={buscar} className="flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label htmlFor="busca" className="block text-sm font-medium">Buscar por nome ou CPF</label>
          <input id="busca" value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={80} autoComplete="off" className={`${CLASSE_CONTROLE} border-linha`} />
        </div>
        <Botao type="submit" variante="secundario" carregando={ocupado}>Buscar</Botao>
      </form>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {lista.length === 0 ? (
        <Vazio Icone={Contact} titulo="Nenhum paciente encontrado">Mude a busca ou o filtro.</Vazio>
      ) : (
        <Cartao semPadding>
          <ul className="divide-y divide-linha" aria-busy={ocupado}>
            {lista.map((p) => (
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
                    CPF {p.cpfMascarado ?? "não informado"} · {p.telefone ?? "sem telefone"} · desde {dataCurta(p.cadastradoEm, fuso)} · {p.consultasConcluidas} consulta(s) concluída(s)
                  </p>
                  {p.restricao ? (
                    <p className="text-sm text-alerta">
                      Motivo: {p.restricao.motivo} (desde {dataCurta(p.restricao.desde, fuso)})
                    </p>
                  ) : null}
                </div>
                <RestricaoDoPaciente slug={slug} pacienteId={p.id} restrito={Boolean(p.restricao)} aoMudar={buscar} />
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}
