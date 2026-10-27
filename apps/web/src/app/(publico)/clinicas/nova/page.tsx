import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { Folha } from "@/componentes/Folha";
import { FormularioClinica } from "./FormularioClinica";

export const metadata: Metadata = { title: "Criar clínica" };

export default function PaginaNovaClinica() {
  return (
    <Folha
      Icone={Building2}
      largura="lg"
      titulo="Criar clínica"
      descricao="Os dados da pessoa jurídica ficam no cadastro porque os documentos médicos emitidos aqui identificam a clínica."
    >
      <FormularioClinica />
    </Folha>
  );
}
