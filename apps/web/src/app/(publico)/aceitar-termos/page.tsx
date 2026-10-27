import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PerfilResposta } from "@tele/shared";
import { Folha } from "@/componentes/Folha";
import { chamarApi } from "@/lib/api";
import { tokenAtual } from "@/lib/supabase-servidor";
import { FormularioAceite } from "./FormularioAceite";

export const metadata: Metadata = { title: "Termos atualizados" };

/**
 * Quem ainda nao aceitou a versao ATUAL dos termos, da politica ou do
 * consentimento para telemedicina passa por aqui antes de continuar
 * (ADR-0018). So aparecem os itens pendentes.
 */
export default async function PaginaAceitarTermos({ searchParams }: { searchParams: Promise<{ depois?: string }> }) {
  const { depois } = await searchParams;
  const destino = depois && depois.startsWith("/") && !depois.startsWith("//") ? depois : "/clinicas";
  const r = await chamarApi<PerfilResposta>("/perfis/eu", { token: await tokenAtual() });
  if (!r.ok && r.status === 404) redirect(`/completar-perfil?depois=${encodeURIComponent(destino)}`);
  if (r.ok && r.dados.consentimentosPendentes.length === 0) redirect(destino);
  const pendentes = r.ok ? r.dados.consentimentosPendentes : [];

  return (
    <Folha
      Icone={ScrollText}
      largura="lg"
      titulo="Antes de continuar"
      descricao="Nossos termos foram publicados ou atualizados. Leia e confirme os itens abaixo - cada aceite fica registrado com a versão do texto e a data."
    >
      <FormularioAceite pendentes={pendentes} destino={destino} />
    </Folha>
  );
}
