import type { StatusConsulta, StatusDocumento } from "@tele/shared";
import { NOME_DO_STATUS } from "@/lib/datas";
import { Etiqueta, type Tom } from "./ui";

const TOM_DA_CONSULTA: Record<StatusConsulta, Tom> = {
  aguardando_pagamento: "espera",
  agendada: "info",
  em_andamento: "selo",
  concluida: "neutro",
  cancelada: "alerta",
};

export function StatusDaConsulta({ status }: { status: StatusConsulta }) {
  return <Etiqueta tom={TOM_DA_CONSULTA[status]}>{NOME_DO_STATUS[status] ?? status}</Etiqueta>;
}

const DOCUMENTO: Record<StatusDocumento, { tom: Tom; rotulo: string }> = {
  emitido: { tom: "espera", rotulo: "Aguardando assinatura" },
  assinado: { tom: "selo", rotulo: "Assinado digitalmente" },
  cancelado: { tom: "alerta", rotulo: "Cancelado" },
};

export function StatusDoDocumento({ status }: { status: StatusDocumento }) {
  const { tom, rotulo } = DOCUMENTO[status];
  return <Etiqueta tom={tom}>{rotulo}</Etiqueta>;
}

/** "receita_simples" -> "Receita simples" */
export function nomeDoTipoDeDocumento(tipo: string): string {
  const t = tipo.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
