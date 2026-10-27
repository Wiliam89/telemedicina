"use client";

import { useMemo, useRef, useState } from "react";

export interface Serie {
  nome: string;
  /** Variavel CSS da cor (var(--color-serie-1)...). Ordem fixa, nunca sorteada. */
  cor: string;
  pontos: { em: string; valor: number }[];
}

const L = 640;
const A = 190;
const M = { topo: 14, dir: 64, base: 26, esq: 40 };

function passoBonito(bruto: number): number {
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

/**
 * Grafico de linha de UMA medida ao longo do tempo (peso, pressao...).
 *
 * Um eixo so - pressao e peso nunca dividem grafico, cada medida tem o seu
 * (pequenos multiplos). Linha de 2px, marcadores de 8px com anel da cor do
 * fundo, grade discreta, rotulo direto no fim de cada linha quando ha mais
 * de uma serie, e uma mira com o valor exato ao passar o mouse. A tabela
 * logo abaixo na tela e a versao em texto dos mesmos numeros.
 */
export function GraficoDeEvolucao({ titulo, unidade, series }: { titulo: string; unidade: string; series: Serie[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const dados = useMemo(() => {
    const instantes = [...new Set(series.flatMap((s) => s.pontos.map((p) => p.em)))].sort();
    const valores = series.flatMap((s) => s.pontos.map((p) => p.valor));
    if (valores.length === 0) return null;
    let min = Math.min(...valores);
    let max = Math.max(...valores);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const passo = passoBonito((max - min) / 3);
    const y0 = Math.floor(min / passo) * passo;
    const y1 = Math.ceil(max / passo) * passo;
    const ticks: number[] = [];
    for (let v = y0; v <= y1 + passo / 2; v += passo) ticks.push(Math.round(v * 100) / 100);

    const t0 = new Date(instantes[0]!).getTime();
    const t1 = new Date(instantes[instantes.length - 1]!).getTime();
    const x = (iso: string) => (t1 === t0 ? (M.esq + L - M.dir) / 2 : M.esq + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (L - M.esq - M.dir));
    const y = (v: number) => M.topo + (1 - (v - y0) / (y1 - y0)) * (A - M.topo - M.base);
    return { instantes, ticks, x, y };
  }, [series]);

  if (!dados) return null;
  const { instantes, ticks, x, y } = dados;
  const ultimo = (s: Serie) => s.pontos[s.pontos.length - 1];

  function aoMover(e: React.PointerEvent<SVGSVGElement>) {
    const caixa = svg.current?.getBoundingClientRect();
    if (!caixa) return;
    const px = ((e.clientX - caixa.left) / caixa.width) * L;
    let melhor = 0;
    instantes.forEach((iso, i) => {
      if (Math.abs(x(iso) - px) < Math.abs(x(instantes[melhor]!) - px)) melhor = i;
    });
    setFoco(melhor);
  }

  const emFoco = foco === null ? null : instantes[foco]!;
  const xFoco = emFoco ? x(emFoco) : 0;

  return (
    <figure className="relative">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-tinta">{titulo}</span>
        <span className="text-xs text-tinta-suave">{unidade}</span>
      </figcaption>
      <svg
        ref={svg}
        viewBox={`0 0 ${L} ${A}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`${titulo}: ${series.map((s) => `${s.nome} de ${s.pontos[0]?.valor} a ${ultimo(s)?.valor} ${unidade}`).join("; ")}`}
        onPointerMove={aoMover}
        onPointerLeave={() => setFoco(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.esq} x2={L - M.dir} y1={y(t)} y2={y(t)} stroke="var(--color-linha)" strokeWidth={1} />
            <text x={M.esq - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-tinta-suave)">
              {t.toLocaleString("pt-BR")}
            </text>
          </g>
        ))}
        <text x={M.esq} y={A - 6} fontSize={11} fill="var(--color-tinta-suave)">
          {dataCurta(instantes[0]!)}
        </text>
        {instantes.length > 1 ? (
          <text x={L - M.dir} y={A - 6} textAnchor="end" fontSize={11} fill="var(--color-tinta-suave)">
            {dataCurta(instantes[instantes.length - 1]!)}
          </text>
        ) : null}

        {emFoco ? <line x1={xFoco} x2={xFoco} y1={M.topo} y2={A - M.base} stroke="var(--color-linha-forte)" strokeWidth={1} /> : null}

        {series.map((s) => (
          <g key={s.nome}>
            <polyline
              points={s.pontos.map((p) => `${x(p.em)},${y(p.valor)}`).join(" ")}
              fill="none"
              stroke={s.cor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.pontos.map((p) => (
              <circle
                key={p.em}
                cx={x(p.em)}
                cy={y(p.valor)}
                r={p.em === emFoco ? 5 : 4}
                fill={s.cor}
                stroke="var(--color-superficie)"
                strokeWidth={2}
              />
            ))}
            {series.length > 1 && ultimo(s) ? (
              <text x={x(ultimo(s)!.em) + 10} y={y(ultimo(s)!.valor)} dy="0.32em" fontSize={11} fontWeight={600} fill="var(--color-tinta)">
                {s.nome}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      {emFoco ? (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-linha bg-superficie px-3 py-2 text-xs shadow-flutuante"
          style={{ left: `${(xFoco / L) * 100}%`, transform: xFoco > L / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
        >
          <p className="mb-1 font-medium text-tinta">{new Date(emFoco).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
          {series.map((s) => {
            const p = s.pontos.find((q) => q.em === emFoco);
            return p ? (
              <p key={s.nome} className="flex items-center gap-2 text-tinta-suave">
                <span className="h-2 w-2 rounded-full" style={{ background: s.cor }} />
                {s.nome}: <span className="font-medium text-tinta">{p.valor.toLocaleString("pt-BR")} {unidade}</span>
              </p>
            ) : null;
          })}
        </div>
      ) : null}
    </figure>
  );
}
