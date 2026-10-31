"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/**
 * A resposta e a mesma exista o e-mail ou nao: dizer "este e-mail nao tem conta"
 * revelaria quem e paciente na plataforma. Aqui a unica excecao e o limite de
 * tentativas, que nao diz nada sobre a conta.
 */
export function FormularioRecuperarSenha() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!email.includes("@")) {
      setErro("Informe um e-mail válido.");
      return;
    }
    setCarregando(true);
    const { error } = await criarClienteNavegador().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirmar?proximo=/redefinir-senha`,
    });
    setCarregando(false);
    if (error && /rate limit|too many|security purposes/i.test(error.message)) {
      setErro("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      return;
    }
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="space-y-4">
        <Aviso tipo="ok">
          Se houver uma conta com <strong>{email.trim()}</strong>, o link chega em instantes. Confira também a caixa de spam e abra o link neste mesmo navegador.
        </Aviso>
        <Link href="/entrar" className="text-sm text-selo underline underline-offset-4">
          Voltar para Entrar
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-5" noValidate>
      <Campo id="email" rotulo="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao type="submit" carregando={carregando} className="w-full">
        Enviar link
      </Botao>
      <p className="text-sm text-tinta-suave">
        Lembrou a senha?{" "}
        <Link href="/entrar" className="text-selo underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </form>
  );
}
