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
  return `Nao foi possivel entrar: ${mensagem}`;
}

export function FormularioEntrar({ destino }: { destino: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);

    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });

    if (error) {
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
      <Botao type="submit" carregando={carregando} className="w-full">
        Entrar
      </Botao>
      <p className="text-sm text-tinta-suave">
        Ainda nao tem conta?{" "}
        <Link href="/criar-conta" className="text-selo underline underline-offset-4">
          Criar conta
        </Link>
      </p>
    </form>
  );
}
