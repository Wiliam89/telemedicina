import type { Metadata } from "next";
import { Aviso } from "@/componentes/Aviso";
import { destinoSeguro } from "@/lib/validacao";
import { FormularioEntrar } from "./FormularioEntrar";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Server Component fino: so a moldura. O formulario e Client Component
 * porque precisa reagir a digitacao e chamar o Supabase do navegador.
 * O parametro ?depois=/inicio diz para onde voltar apos o login.
 */
export default async function PaginaEntrar({ searchParams }: { searchParams: Promise<{ depois?: string; aviso?: string }> }) {
  const { depois, aviso } = await searchParams;
  const destino = destinoSeguro(depois);

  return (
    <section className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-3xl text-tinta">Entrar</h1>
        <p className="text-sm text-tinta-suave">Bem-vindo(a) de volta. Use o e-mail e a senha da sua conta.</p>
      </div>
      {/* Retorno do link de confirmacao que nao abriu a sessao sozinho (auth/confirmar). */}
      {aviso === "confirmado" ? (
        <Aviso tipo="ok">Seu e-mail foi confirmado. Entre com o e-mail e a senha que você criou.</Aviso>
      ) : aviso === "link" ? (
        <Aviso tipo="espera">
          Este link de confirmação venceu ou já foi usado. Se a conta já foi confirmada, é só entrar. Se não, tente entrar mesmo assim: oferecemos o reenvio do e-mail.
        </Aviso>
      ) : null}
      <FormularioEntrar destino={destino} />
    </section>
  );
}
