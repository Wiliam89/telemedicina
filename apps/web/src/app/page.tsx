import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/supabase-servidor";

/**
 * CAPA. Quem ja esta logado vai para /clinicas, que decide o destino:
 * uma clinica so, entra direto; varias, escolhe; nenhuma, cria ou aceita
 * um convite.
 */
export default async function Capa() {
  if (await usuarioAtual()) redirect("/clinicas");

  return (
    <section className="max-w-xl space-y-6">
      <p className="text-xs uppercase tracking-[0.2em] text-tinta-suave">Plataforma de telemedicina</p>
      <h1 className="font-titulo text-4xl leading-tight tracking-tight">Consulta medica a distancia, com prontuario que fica no Brasil.</h1>
      <p className="text-lg text-tinta-suave">
        Cada clinica tem sua propria equipe, sua agenda e seus registros, isolados dos demais. Medicos com CRM ativo atendem; cada acesso ao prontuario fica registrado.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link href="/criar-conta" className="rounded-md bg-selo px-5 py-3 text-base font-medium text-white hover:bg-selo/90">Criar conta</Link>
        <Link href="/entrar" className="rounded-md border border-linha bg-superficie px-5 py-3 text-base font-medium hover:bg-selo-suave">Ja tenho conta</Link>
      </div>
    </section>
  );
}
