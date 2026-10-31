"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import { problemaDaSenha } from "@/lib/validacao";

export function FormularioRedefinirSenha() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const problema = problemaDaSenha(senha) ?? (senha === repetida ? null : "As duas senhas não são iguais.");
    setErroSenha(problema);
    if (problema) return;

    setCarregando(true);
    const { error } = await criarClienteNavegador().auth.updateUser({ password: senha });
    if (error) {
      setErro(/different from the old/i.test(error.message) ? "Escolha uma senha diferente da anterior." : "Não foi possível salvar a senha. Peça um novo link e tente de novo.");
      setCarregando(false);
      return;
    }
    router.push("/clinicas");
    router.refresh();
  }

  return (
    <form onSubmit={salvar} className="space-y-5" noValidate>
      <Campo id="senha" rotulo="Senha nova" type="password" autoComplete="new-password" required ajuda="Ao menos 8 caracteres, com letras e números." erro={erroSenha} value={senha} onChange={(e) => setSenha(e.target.value)} />
      <Campo id="senha-repetida" rotulo="Repita a senha nova" type="password" autoComplete="new-password" required value={repetida} onChange={(e) => setRepetida(e.target.value)} />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Botao type="submit" carregando={carregando} className="w-full">
        Salvar senha
      </Botao>
    </form>
  );
}
