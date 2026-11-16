"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import { problemaDaSenha } from "@/lib/validacao";

/** O Supabase so reenvia depois de um intervalo; o botao espera o mesmo tempo. */
const SEGUNDOS_PARA_REENVIAR = 60;

/**
 * Para onde o link do e-mail leva. Sem informar isto, o Supabase usa o
 * "Site URL" do painel - e se ele ainda estiver como localhost, o link que
 * chega no e-mail abre uma pagina que nao carrega. O endereco precisa estar
 * em Authentication > URL Configuration > Redirect URLs.
 */
function destinoDoLink(): string {
  return `${window.location.origin}/auth/confirmar?proximo=/completar-perfil`;
}

function explicarErro(mensagem: string): string {
  if (/already registered|already exists/i.test(mensagem)) return 'Este e-mail já tem conta. Use "Entrar".';
  // O limite e do ENVIO DE E-MAILS do projeto inteiro (nao desta pessoa): com o envio
  // padrao do Supabase sao poucos por hora. Ver docs/publicar.md, "SMTP proprio".
  if (/security purposes/i.test(mensagem)) return "Aguarde um minuto antes de pedir outro e-mail.";
  if (/rate limit|too many/i.test(mensagem)) return "Muitos cadastros em pouco tempo: o envio de e-mails está no limite. Tente de novo em alguns minutos.";
  if (/not authorized/i.test(mensagem)) return "Não conseguimos enviar o e-mail de confirmação agora. Tente de novo mais tarde.";
  if (/invalid.*email|email.*invalid/i.test(mensagem)) return "Este e-mail não parece válido. Confira e tente de novo.";
  if (/sending|smtp|confirmation email/i.test(mensagem)) return "Não conseguimos enviar o e-mail de confirmação agora. Tente de novo em alguns minutos.";
  if (/password/i.test(mensagem)) return "Esta senha não foi aceita. Use ao menos 8 caracteres, com letras e números.";
  return "Não foi possível criar a conta agora. Tente de novo em instantes.";
}

export function FormularioCriarConta() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aguardandoEmail, setAguardandoEmail] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [espera, setEspera] = useState(0);
  const [reenvio, setReenvio] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [reenviando, setReenviando] = useState(false);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    const problema = problemaDaSenha(senha);
    setErroSenha(problema);
    if (problema) return;
    if (!email.includes("@")) {
      setErro("Informe um e-mail válido.");
      return;
    }

    setCarregando(true);
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: senha, options: { emailRedirectTo: destinoDoLink() } });

    if (error) {
      setErro(explicarErro(error.message));
      setCarregando(false);
      return;
    }

    // Dois caminhos, conforme a configuracao do projeto no Supabase:
    //  - "Confirm email" DESLIGADO: ja vem a sessao -> segue para o perfil.
    //  - "Confirm email" LIGADO: sem sessao -> a pessoa precisa abrir o link do e-mail.
    //    Quando o e-mail JA tem conta, o Supabase responde igual e nao envia nada
    //    (para nao revelar quem tem conta): a tela abaixo orienta os dois casos.
    if (data.session) {
      router.push("/completar-perfil");
      router.refresh();
    } else {
      setAguardandoEmail(true);
      setEspera(SEGUNDOS_PARA_REENVIAR);
      setCarregando(false);
    }
  }

  async function reenviar() {
    setReenvio(null);
    setReenviando(true);
    const { error } = await criarClienteNavegador().auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: destinoDoLink() } });
    setReenviando(false);
    setEspera(SEGUNDOS_PARA_REENVIAR);
    setReenvio(error ? { tipo: "erro", texto: explicarErro(error.message) } : { tipo: "ok", texto: "Pedido de reenvio feito. O link anterior deixa de valer: use o mais recente." });
  }

  if (aguardandoEmail) {
    return (
      <div className="space-y-5">
        <Aviso tipo="ok">
          Enviamos um link de confirmação para <strong>{email.trim()}</strong>. Abra o e-mail e toque em confirmar: você volta para cá já com a conta ativa.
        </Aviso>
        <div className="space-y-2 text-sm text-tinta-suave">
          <p className="font-medium text-tinta">Não chegou?</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Confira a caixa de spam e a aba de promoções.</li>
            <li>Veja se o e-mail acima está escrito certo.</li>
            <li>
              Se você já tinha conta com este e-mail, nenhum link novo é enviado:{" "}
              <Link href="/entrar" className="text-selo underline underline-offset-4">entre</Link> ou{" "}
              <Link href="/recuperar-senha" className="text-selo underline underline-offset-4">recupere a senha</Link>.
            </li>
          </ul>
        </div>
        {reenvio ? <Aviso tipo={reenvio.tipo}>{reenvio.texto}</Aviso> : null}
        <Botao type="button" variante="secundario" className="w-full" onClick={reenviar} carregando={reenviando} disabled={espera > 0}>
          {espera > 0 ? `Reenviar em ${espera} s` : "Reenviar o e-mail"}
        </Botao>
        <button type="button" onClick={() => setAguardandoEmail(false)} className="text-sm text-selo underline underline-offset-4">
          Corrigir o e-mail
        </button>
      </div>
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
        ajuda="Ao menos 8 caracteres, com letras e números."
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
        Já tem conta?{" "}
        <Link href="/entrar" className="text-selo underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </form>
  );
}
