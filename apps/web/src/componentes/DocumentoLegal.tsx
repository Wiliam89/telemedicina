import type { ReactNode } from "react";

/**
 * Moldura dos textos legais (termos, politica, consentimento): titulo,
 * versao em destaque e um sumario que leva a cada secao. A versao e a
 * mesma registrada em cada aceite (ADR-0018) - e assim que se prova QUAL
 * texto a pessoa aceitou.
 */
export function DocumentoLegal({
  titulo,
  versao,
  resumo,
  secoes,
}: {
  titulo: string;
  versao: string;
  resumo: ReactNode;
  secoes: { id: string; titulo: string; conteudo: ReactNode }[];
}) {
  const data = new Date(`${versao}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="mb-10 max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-selo">Documento legal · versão de {data}</p>
        <h1 className="text-3xl text-tinta sm:text-4xl">{titulo}</h1>
        <div className="text-tinta-suave">{resumo}</div>
      </header>
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Sumário" className="hidden lg:block">
          <ol className="sticky top-24 space-y-2 text-sm">
            {secoes.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-tinta-suave hover:text-selo">
                  {i + 1}. {s.titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="space-y-10 rounded-2xl border border-linha bg-superficie p-6 shadow-cartao sm:p-10">
          {secoes.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 space-y-3">
              <h2 className="text-xl text-tinta">
                {i + 1}. {s.titulo}
              </h2>
              <div className="space-y-3 leading-relaxed text-tinta [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">{s.conteudo}</div>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
