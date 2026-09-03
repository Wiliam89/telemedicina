"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import { problemaDaSenha } from "@/lib/validacao";

export function FormularioCriarConta() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aguardandoEmail, setAguardandoEmail] = useState(false);
  const [carregando, setCarregando] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    const problema = problemaDaSenha(senha);
    setErroSenha(problema);
    if (problema) return;

    setCarregando(true);
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: senha });

    if (error) {
      setErro(/already registered|already exists/i.test(error.message) ? "Este e-mail ja tem conta. Use \"Entrar\"." : `Nao foi possivel criar a conta: ${error.message}`);
      setCarregando(false);
      return;
    }

    // Dois caminhos, conforme a configuracao do projeto no Supabase:
    //  - "Confirm email" DESLIGADO: ja vem a sessao -> segue para o perfil.
    //  - "Confirm email" LIGADO: sem sessao -> a pessoa precisa abrir o link do e-mail.
    if (data.session) {
      router.push("/completar-perfil");
      router.refresh();
    } else {
      setAguardandoEmail(true);
      setCarregando(false);
    }
  }

  if (aguardandoEmail) {
    return (
      <Aviso tipo="ok">
        Enviamos um link para <strong>{email}</strong>. Abra-o para confirmar a conta e depois volte em{" "}
        <Link href="/entrar" className="underline underline-offset-4">Entrar</Link>.
      </Aviso>
    );
  }

  return (
    <form onSubmit={criar} className="space-y-5" noValidate>
      <Campo id="email" rotulo="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Campo
        id="senha"
        rotulo="Senha"
        type="password"
        autoComplete="new-password"
        required
        ajuda="Ao menos 8 caracteres, com letras e numeros."
        erro={erroSenha}
        value={senha}
        onChange={(e) => {
          setSenha(e.target.value);
          if (erroSenha) setErroSenha(null);
        }}
      />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao type="submit" carregando={carregando} className="w-full">
        Criar conta
      </Botao>
      <p className="text-sm text-tinta-suave">
        Ja tem conta?{" "}
        <Link href="/entrar" className="text-selo underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </form>
  );
}
