"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

/** Traduz os erros do Supabase Auth para algo que orienta. */
function explicarErroDeLogin(mensagem: string): string {
  if (/invalid login credentials/i.test(mensagem)) return "E-mail ou senha incorretos. Confira e tente de novo.";
  if (/email not confirmed/i.test(mensagem)) return "Confirme seu e-mail antes de entrar: abra o link que enviamos.";
  if (/rate limit|too many/i.test(mensagem)) return "Muitas tentativas. Aguarde um minuto e tente de novo.";
  return "Não foi possível entrar agora. Tente de novo em instantes.";
}

export function FormularioEntrar({ destino }: { destino: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  // Conta criada e ainda nao confirmada: em vez de so dizer "confirme", oferece o reenvio.
  const [semConfirmar, setSemConfirmar] = useState(false);
  const [reenvio, setReenvio] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [reenviando, setReenviando] = useState(false);

  async function reenviar() {
    setReenviando(true);
    const { error } = await criarClienteNavegador().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirmar?proximo=/completar-perfil` },
    });
    setReenviando(false);
    setReenvio(
      error
        ? { tipo: "erro", texto: /rate limit|too many|security purposes/i.test(error.message) ? "Aguarde um minuto antes de pedir outro e-mail." : "Não conseguimos reenviar agora. Tente de novo em alguns minutos." }
        : { tipo: "ok", texto: "E-mail reenviado. Confira também a caixa de spam e use sempre o link mais recente." },
    );
  }

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setReenvio(null);
    setSemConfirmar(false);
    setCarregando(true);

    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });

    if (error) {
      setSemConfirmar(/email not confirmed/i.test(error.message));
      setErro(explicarErroDeLogin(error.message));
      setCarregando(false);
      return;
    }
    // O cookie da sessao ja foi gravado pelo cliente do navegador.
    // router.refresh() faz o layout (Server Component) reler quem esta logado.
    router.push(destino);
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="space-y-5" noValidate>
      <Campo id="email" rotulo="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Campo id="senha" rotulo="Senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {semConfirmar ? (
        <div className="space-y-3">
          {reenvio ? <Aviso tipo={reenvio.tipo}>{reenvio.texto}</Aviso> : null}
          <Botao type="button" variante="secundario" className="w-full" carregando={reenviando} onClick={reenviar}>
            Reenviar o e-mail de confirmação
          </Botao>
        </div>
      ) : null}
      <Botao type="submit" carregando={carregando} className="w-full">
        Entrar
      </Botao>
      <p className="text-sm">
        <Link href="/recuperar-senha" className="text-selo underline underline-offset-4">
          Esqueci minha senha
        </Link>
      </p>
      <p className="text-sm text-tinta-suave">
        Ainda não tem conta?{" "}
        <Link href="/criar-conta" className="text-selo underline underline-offset-4">
          Criar conta
        </Link>
      </p>
    </form>
  );
}
