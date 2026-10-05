import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/supabase-servidor";

/**
 * TELA DE ENTRADA.
 *
 * A porta da plataforma: o titulo assenta na tela, uma linha e tracada
 * embaixo dele, e ha um caminho so a seguir. Quem ja esta logado nao ve
 * nada disso - vai direto para /clinicas, que decide o destino.
 *
 * A animacao e CSS puro, sem biblioteca: esta pagina e um Server
 * Component e nao envia JavaScript nenhum ao navegador por causa dela.
 * Cada parte entra com um atraso proprio (--atraso), e o estado final e
 * o padrao - quem configurou o sistema para reduzir movimento ve tudo
 * parado, no lugar, sem perder conteudo.
 */
export default async function Entrada() {
  if (await usuarioAtual()) redirect("/clinicas");

  const titulo = ["Consulte", "Telemedicina"];

  return (
    <div className="space-y-20">
      {/* --- a porta ------------------------------------------------- */}
      <section className="flex min-h-[56vh] flex-col justify-center">
        <p className="surge text-xs uppercase tracking-[0.3em] text-tinta-suave" style={{ "--atraso": "0.05s" } as React.CSSProperties}>
          Plataforma de telemedicina
        </p>

        <h1 className="mt-5 font-titulo text-5xl leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          {titulo.map((palavra, i) => (
            <span
              key={palavra}
              className="surge inline-block"
              style={{ "--atraso": `${0.2 + i * 0.13}s` } as React.CSSProperties}
            >
              {palavra}
              {i < titulo.length - 1 ? " " : null}
            </span>
          ))}
        </h1>

        <div
          className="traca mt-8 h-px w-full max-w-md bg-selo"
          style={{ "--atraso": "0.55s" } as React.CSSProperties}
          aria-hidden="true"
        />

        <p
          className="surge mt-8 max-w-xl text-lg leading-relaxed text-tinta-suave"
          style={{ "--atraso": "0.7s" } as React.CSSProperties}
        >
          Consulta médica a distância, com prontuário que fica no Brasil. Médicos com CRM ativo atendem por agendamento
          ou por pronto atendimento, e cada acesso ao registro clínico fica guardado.
        </p>

        <div className="surge mt-10" style={{ "--atraso": "0.85s" } as React.CSSProperties}>
          <Link
            href="/entrar"
            className="inline-flex items-center gap-3 rounded-md bg-selo px-7 py-4 text-base font-medium text-white transition-colors hover:bg-selo/90"
          >
            Acessar a plataforma
            <span aria-hidden="true">&rarr;</span>
          </Link>
          <p className="mt-3 text-sm text-tinta-suave">
            Ainda não tem conta?{" "}
            <Link href="/criar-conta" className="text-selo underline underline-offset-4">
              Criar conta
            </Link>
          </p>
        </div>
      </section>

      {/* --- o que sustenta ------------------------------------------ */}
      <section className="space-y-8 border-t border-linha pt-12">
        <h2 className="font-titulo text-2xl tracking-tight">O que sustenta esta plataforma</h2>
        <dl className="grid gap-8 sm:grid-cols-3">
          <div className="space-y-2">
            <dt className="font-medium">Prontuário que fica no Brasil</dt>
            <dd className="text-sm leading-relaxed text-tinta-suave">
              Os dados ficam em servidores em São Paulo, como pedem o CFM e a LGPD. A região foi escolhida no primeiro
              dia e não pode ser trocada depois.
            </dd>
          </div>
          <div className="space-y-2">
            <dt className="font-medium">Cada clínica isolada</dt>
            <dd className="text-sm leading-relaxed text-tinta-suave">
              Equipe, agenda e registros de uma clínica não se misturam com os de outra. O isolamento é decidido pelo
              banco de dados, não apenas pelo código.
            </dd>
          </div>
          <div className="space-y-2">
            <dt className="font-medium">Todo acesso registrado</dt>
            <dd className="text-sm leading-relaxed text-tinta-suave">
              Quem abriu o prontuário de quem, e quando. O registro clínico, depois de finalizado, não pode ser alterado
              nem apagado — nem por quem o escreveu.
            </dd>
          </div>
        </dl>
        <p className="text-sm text-tinta-suave">
          Documentos emitidos aqui podem ser conferidos por qualquer pessoa em{" "}
          <Link href="/validar" className="text-selo underline underline-offset-4">
            /validar
          </Link>
          , sem precisar de conta.
        </p>
      </section>
    </div>
  );
}
