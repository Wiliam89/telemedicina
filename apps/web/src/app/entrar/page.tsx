import type { Metadata } from "next";
import { FormularioEntrar } from "./FormularioEntrar";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Server Component fino: so a moldura. O formulario e Client Component
 * porque precisa reagir a digitacao e chamar o Supabase do navegador.
 * O parametro ?depois=/inicio diz para onde voltar apos o login.
 */
export default async function PaginaEntrar({ searchParams }: { searchParams: Promise<{ depois?: string }> }) {
  const { depois } = await searchParams;
  const destino = depois && depois.startsWith("/") ? depois : "/clinicas";

  return (
    <section className="max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Entrar</h1>
        <p className="text-tinta-suave">Use o e-mail e a senha da sua conta.</p>
      </div>
      <FormularioEntrar destino={destino} />
    </section>
  );
}
