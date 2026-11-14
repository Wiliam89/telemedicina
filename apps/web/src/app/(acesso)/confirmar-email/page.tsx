import type { Metadata } from "next";
import { destinoSeguro } from "@/lib/validacao";
import { ConfirmarEmail } from "./ConfirmarEmail";

export const metadata: Metadata = { title: "Confirmar e-mail", robots: { index: false } };

/**
 * Onde chega o link de confirmacao do modelo de e-mail recomendado
 * (docs/publicar.md):  /confirmar-email?token_hash=...&type=email
 *
 * A confirmacao acontece quando a PESSOA toca no botao, e nao quando a
 * pagina abre. Leitores de e-mail e antivirus costumam "visitar" os links
 * antes do dono da caixa; se abrir a pagina ja confirmasse, o link chegaria
 * usado e a pessoa veria "link vencido".
 */
export default async function PaginaConfirmarEmail({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; proximo?: string }> }) {
  const { token_hash: tokenHash, type, proximo } = await searchParams;
  const tipo = type === "recovery" ? "recovery" : "email";
  return (
    <section className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-3xl text-tinta">{tipo === "recovery" ? "Criar nova senha" : "Confirmar e-mail"}</h1>
        <p className="text-sm text-tinta-suave">
          {tipo === "recovery" ? "Toque no botão para continuar e escolher a nova senha." : "Falta um toque para ativar a sua conta."}
        </p>
      </div>
      <ConfirmarEmail tokenHash={tokenHash ?? null} tipo={tipo} destino={destinoSeguro(proximo, tipo === "recovery" ? "/redefinir-senha" : "/completar-perfil")} />
    </section>
  );
}
