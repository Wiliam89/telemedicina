import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MedicoNaAdministracao } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { FormularioDeConfiguracoes, type Configuracoes } from "./FormularioDeConfiguracoes";

export const metadata: Metadata = { title: "Configurações" };

export default async function PaginaConfiguracoes({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();
  const [config, medicos] = await Promise.all([
    chamarApi<Configuracoes & { recebimentoConfigurado: boolean }>("/admin/configuracoes", { token, clinica: slug }),
    chamarApi<MedicoNaAdministracao[]>("/admin/medicos", { token, clinica: slug }),
  ]);
  return (
    <div className="space-y-8">
      <CabecalhoDaPagina sobretitulo="Administração" titulo="Configurações" descricao="Dados da empresa, porcentagem padrão dos médicos e prazo do retorno sem custo. Cada alteração fica registrada na auditoria." />
      {!config.ok ? (
        <Aviso tipo="erro">{config.erro.mensagem}</Aviso>
      ) : (
        <>
          {!config.dados.recebimentoConfigurado ? (
            <Aviso tipo="espera">A conta de recebimento (serviço de pagamento) é configurada pelo suporte técnico, no servidor, e não aparece aqui por segurança.</Aviso>
          ) : null}
          <FormularioDeConfiguracoes slug={slug} inicial={config.dados} medicos={medicos.ok ? medicos.dados : []} />
        </>
      )}
    </div>
  );
}
