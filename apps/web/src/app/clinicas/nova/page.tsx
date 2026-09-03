import type { Metadata } from "next";
import { FormularioClinica } from "./FormularioClinica";

export const metadata: Metadata = { title: "Criar clinica" };

export default function PaginaNovaClinica() {
  return (
    <section className="max-w-lg space-y-6">
      <div className="space-y-1">
        <h1 className="font-titulo text-3xl tracking-tight">Criar clinica</h1>
        <p className="text-tinta-suave">
          Os dados da pessoa juridica ficam no cadastro porque documentos medicos emitidos aqui identificam a clinica.
        </p>
      </div>
      <FormularioClinica />
    </section>
  );
}
