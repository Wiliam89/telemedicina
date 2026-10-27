"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsultaResumo, PapelVinculo } from "@tele/shared";
import { decidirEntrada } from "@tele/shared/video";
import { Botao, LinkBotao } from "@/componentes/Botao";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * Os botoes de cada consulta. Quem pode o que ja e decidido pela API - aqui
 * so evitamos oferecer o que certamente sera recusado, para nao frustrar.
 */
export function AcoesDaConsulta({
  slug,
  consulta,
  papel,
  souOMedico,
}: {
  slug: string;
  consulta: ConsultaResumo;
  papel: PapelVinculo;
  souOMedico: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const encerrada = consulta.status === "cancelada" || consulta.status === "concluida";

  /** A janela da sala de video desta consulta (Modulo 12). */
  const entrada = decidirEntrada({
    status: consulta.status,
    inicio: new Date(consulta.inicio),
    fim: new Date(consulta.fim),
    agora: new Date(),
  });

  async function chamar(rota: string, corpo?: unknown) {
    setErro(null);
    setOcupado(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi(rota, { metodo: "POST", token: data.session?.access_token, clinica: slug, corpo });
    if (r.ok) router.refresh();
    else setErro(r.erro.mensagem);
    setOcupado(false);
  }

  async function cancelar() {
    const motivo = window.prompt("Por que esta consulta esta sendo cancelada?\n(fica registrado na auditoria)");
    if (!motivo || motivo.trim().length < 3) return;
    await chamar(`/consultas/${consulta.id}/cancelar`, { motivo: motivo.trim() });
  }

  if (encerrada) {
    return (
      <div className="flex items-center gap-3">
        {souOMedico && consulta.status === "concluida" ? (
          <LinkBotao href={`/c/${slug}/atendimento/${consulta.id}`} variante="secundario" tamanho="p">
            Prontuário
          </LinkBotao>
        ) : null}
      </div>
    );
  }

  // Consulta reservada esperando pagamento: a acao principal e pagar.
  if (consulta.status === "aguardando_pagamento") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <LinkBotao href={`/c/${slug}/pagamento/${consulta.id}`} tamanho="p">
          Pagar
        </LinkBotao>
        <Botao variante="fantasma" tamanho="p" onClick={cancelar} disabled={ocupado} className="text-alerta hover:text-alerta">
          Cancelar
        </Botao>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {erro ? <span className="w-full text-sm text-alerta">{erro}</span> : null}

      {souOMedico && consulta.status === "agendada" ? (
        <Botao variante="secundario" tamanho="p" carregando={ocupado} onClick={() => chamar(`/consultas/${consulta.id}/status`, { status: "em_andamento" })}>
          Iniciar
        </Botao>
      ) : null}
      {souOMedico ? (
        <LinkBotao href={`/c/${slug}/atendimento/${consulta.id}`} tamanho="p">
          Atender
        </LinkBotao>
      ) : null}

      {/*
        O CAMINHO DO PACIENTE PARA A SALA (Modulo 12).

        A mesma regra que a API usa para liberar a entrada decide o que
        aparece aqui - ela vive em @tele/shared/video justamente para os dois
        lados concordarem. Fora da janela, em vez de um botao que responde
        erro, a tela diz a que horas a sala abre.

        O relogio usado aqui e o do computador da pessoa, que pode estar
        errado; por isso quem decide de verdade continua sendo a API. Esta
        checagem e so para nao oferecer o que vai ser recusado.
      */}
      {papel === "paciente" ? (
        entrada.pode ? (
          <LinkBotao href={`/c/${slug}/consulta/${consulta.id}`} tamanho="p">
            Entrar na consulta
          </LinkBotao>
        ) : entrada.motivo === "cedo_demais" ? (
          <span className="text-sm text-tinta-suave">
            A sala abre às {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(entrada.abreEm)}
          </span>
        ) : null
      ) : null}
      {souOMedico && consulta.status === "em_andamento" ? (
        <Botao tamanho="p" carregando={ocupado} onClick={() => chamar(`/consultas/${consulta.id}/status`, { status: "concluida" })}>
          Concluir
        </Botao>
      ) : null}
      {papel !== "medico" || souOMedico ? (
        <Botao variante="fantasma" tamanho="p" onClick={cancelar} disabled={ocupado} className="text-alerta hover:text-alerta">
          Cancelar
        </Botao>
      ) : null}
    </div>
  );
}
