import type { ReactNode } from "react";
import { MolduraDaClinica } from "@/componentes/MolduraDaClinica";
import { contextoDaClinica } from "@/lib/clinica";

/**
 * Moldura de toda tela de dentro de uma clinica (/c/<slug>/...).
 * contextoDaClinica ja redireciona quem nao tem perfil ou vinculo; a pagina
 * chama a mesma funcao e o cache() faz a API ser consultada uma vez so.
 */
export default async function LayoutDaClinica({ children, params }: { children: ReactNode; params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { perfil, clinica } = await contextoDaClinica(slug);

  return (
    <MolduraDaClinica clinica={clinica} outras={perfil.clinicas} nome={perfil.nomeCompleto}>
      {children}
    </MolduraDaClinica>
  );
}
