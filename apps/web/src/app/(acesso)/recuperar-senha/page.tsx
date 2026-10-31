import type { Metadata } from "next";
import { Aviso } from "@/componentes/Aviso";
import { FormularioRecuperarSenha } from "./FormularioRecuperarSenha";

export const metadata: Metadata = { title: "Recuperar senha" };

export default async function PaginaRecuperarSenha({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;

  return (
    <section className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-3xl text-tinta">Recuperar senha</h1>
        <p className="text-sm text-tinta-suave">Informe o e-mail da sua conta. Enviaremos um link para você criar uma senha nova.</p>
      </div>
      {erro ? <Aviso tipo="erro">Este link venceu ou já foi usado. Peça um novo abaixo e abra-o no mesmo navegador.</Aviso> : null}
      <FormularioRecuperarSenha />
    </section>
  );
}
