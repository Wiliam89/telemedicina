import type { Metadata } from "next";
import type { MeuCredenciamento as Pedido } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { MeuCredenciamento } from "./MeuCredenciamento";

export const metadata: Metadata = { title: "Credenciamento médico" };

/**
 * O medico pede para atender pela plataforma (ADR-0022): CRM, o que quer
 * atender, documentos e conferencia de identidade. Ate a administracao
 * aprovar, ele continua sendo so mais uma conta - nao ve paciente nem fila.
 */
export default async function PaginaCredenciamento({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  const r = await chamarApi<Pedido & { medico: { crm: string; crmUf: string; especialidade: string | null } | null }>("/credenciamento", { token, clinica: slug });

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo="Para médicos"
        titulo="Credenciamento"
        descricao={`Para atender em ${clinica.nomeFantasia}, envie seus documentos e confirme a sua identidade. A administração confere tudo antes de liberar o atendimento.`}
      />
      {!r.ok ? <Aviso tipo="erro">{r.erro.mensagem}</Aviso> : <MeuCredenciamento slug={slug} inicial={r.dados} temCpf={Boolean(perfil.cpf)} />}
    </div>
  );
}
