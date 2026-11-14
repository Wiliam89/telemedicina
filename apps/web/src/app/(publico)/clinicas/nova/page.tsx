import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Settings2 } from "lucide-react";
import type { PlataformaPublica } from "@tele/shared";
import { Folha } from "@/componentes/Folha";
import { chamarApi } from "@/lib/api";
import { NOME_DA_PLATAFORMA } from "@/lib/marca";
import { FormularioClinica } from "./FormularioClinica";

export const metadata: Metadata = { title: "Configuração" };

/**
 * PLATAFORMA UNICA (ADR-0022): esta tela so existe para a configuracao
 * inicial - a administracao informa a pessoa juridica que responde pelos
 * atendimentos, uma unica vez. Depois disso ela deixa de existir.
 *
 * VARIAS CLINICAS (modo antigo): criar uma clinica.
 */
export default async function PaginaNovaClinica() {
  const plataforma = await chamarApi<PlataformaPublica>("/plataforma");
  const unica = plataforma.ok && plataforma.dados.unica;
  if (unica && plataforma.dados.configurada) redirect("/clinicas");

  if (unica) {
    return (
      <Folha
        Icone={Settings2}
        largura="lg"
        sobretitulo="Configuração inicial"
        titulo={`Preparar ${NOME_DA_PLATAFORMA}`}
        descricao="A plataforma é quem atende. Informe a empresa responsável: ela aparece nos documentos médicos emitidos aqui. Esta etapa é feita uma única vez, pela administração."
      >
        <FormularioClinica slugFixo={plataforma.dados.slug!} />
      </Folha>
    );
  }

  return (
    <Folha
      Icone={Building2}
      largura="lg"
      titulo="Criar clínica"
      descricao="Os dados da pessoa jurídica ficam no cadastro porque os documentos médicos emitidos aqui identificam a clínica."
    >
      <FormularioClinica />
    </Folha>
  );
}
