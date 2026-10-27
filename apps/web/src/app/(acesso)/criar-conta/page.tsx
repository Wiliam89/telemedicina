import type { Metadata } from "next";
import { FormularioCriarConta } from "./FormularioCriarConta";

export const metadata: Metadata = { title: "Criar conta" };

export default function PaginaCriarConta() {
  return (
    <section className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-3xl text-tinta">Criar conta</h1>
        <p className="text-sm text-tinta-suave">Primeiro o acesso (e-mail e senha). Na tela seguinte, quem você é: paciente ou médico.</p>
      </div>
      <FormularioCriarConta />
    </section>
  );
}
