"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";

export function FormularioValidacao({ codigoInicial }: { codigoInicial: string }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState(codigoInicial);

  function enviar(e: FormEvent) {
    e.preventDefault();
    // O codigo vai na URL para que o resultado possa ser compartilhado e
    // aberto de novo - util quando o RH confere e precisa guardar o link.
    router.push(`/validar?codigo=${encodeURIComponent(codigo.trim())}`);
  }

  return (
    <form onSubmit={enviar} className="flex flex-wrap items-end gap-3" noValidate>
      <div className="min-w-[16rem] flex-1">
        <Campo
          id="codigo"
          rotulo="Codigo de validacao"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="ABCD-EFGH-JKMN"
          className="font-mono uppercase"
          ajuda="Pode digitar com ou sem hifen."
        />
      </div>
      <Botao type="submit">Conferir</Botao>
    </form>
  );
}
