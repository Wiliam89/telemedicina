import type { Metadata } from "next";
import { FormularioCriarConta } from "./FormularioCriarConta";

export const metadata: Metadata = { title: "Criar conta" };

export default function PaginaCriarConta() {
  return (
    <section className="max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Criar conta</h1>
        <p className="text-tinta-suave">Primeiro o acesso (e-mail e senha). Na tela seguinte, quem voce e: paciente ou medico.</p>
      </div>
      <FormularioCriarConta />
    </section>
  );
}
