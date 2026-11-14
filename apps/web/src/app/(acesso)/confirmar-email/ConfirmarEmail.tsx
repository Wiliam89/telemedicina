"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

export function ConfirmarEmail({ tokenHash, tipo, destino }: { tokenHash: string | null; tipo: "email" | "recovery"; destino: string }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(!tokenHash);

  async function confirmar() {
    if (!tokenHash) return;
    setCarregando(true);
    const { error } = await criarClienteNavegador().auth.verifyOtp({ token_hash: tokenHash, type: tipo });
    if (error) {
      setFalhou(true);
      setCarregando(false);
      return;
    }
    router.replace(destino);
    router.refresh();
  }

  if (falhou) {
    return (
      <div className="space-y-4">
        <Aviso tipo="erro">
          Este link venceu ou já foi usado.{" "}
          {tipo === "recovery" ? "Peça um novo link de recuperação." : "Se a sua conta já foi confirmada, é só entrar. Caso contrário, peça um novo e-mail na tela de entrada."}
        </Aviso>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/entrar" className="text-selo underline underline-offset-4">
            Ir para Entrar
          </Link>
          {tipo === "recovery" ? (
            <Link href="/recuperar-senha" className="text-selo underline underline-offset-4">
              Pedir novo link
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Botao type="button" className="w-full" tamanho="g" carregando={carregando} onClick={confirmar}>
      {tipo === "recovery" ? "Continuar" : "Confirmar meu e-mail"}
    </Botao>
  );
}
