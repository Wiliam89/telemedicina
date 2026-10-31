import type { Metadata } from "next";
import { FormularioRedefinirSenha } from "./FormularioRedefinirSenha";

export const metadata: Metadata = { title: "Nova senha" };

/** So chega aqui quem tem sessao: o link do e-mail a cria (ver /auth/confirmar). */
export default function PaginaRedefinirSenha() {
  return (
    <section className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-3xl text-tinta">Crie uma senha nova</h1>
        <p className="text-sm text-tinta-suave">Depois de salvar, ela passa a valer para os próximos acessos.</p>
      </div>
      <FormularioRedefinirSenha />
    </section>
  );
}
