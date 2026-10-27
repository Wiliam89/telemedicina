"use client";

import { useState } from "react";

const L = 720;
const A = 220;
const M = { topo: 16, dir: 12, base: 28, esq: 36 };

function passoBonito(bruto: number): number {
  if (bruto <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Barras de UMA serie por categoria (consultas por dia). Uma cor so, sem
 * legenda - o titulo diz o que e. Barras finas com topo arredondado e 2px
 * de folga entre elas, grade discreta, e o valor exato ao passar o mouse
 * (alvo do hover e a coluna inteira, maior que a barra).
 */
export function GraficoDeBarras({
  titulo,
  dados,
  unidade,
}: {
  titulo: string;
  dados: { rotulo: string; detalhe: string; valor: number }[];
  /** Texto depois do numero no destaque ("consulta(s)"). */
  unidade: string;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  if (dados.length === 0) return null;
  const max = Math.max(1, ...dados.map((d) => d.valor));
  const passo = passoBonito(max / 4);
  const topo = Math.ceil(max / passo) * passo;
  const ticks = Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);
  const largura = (L - M.esq - M.dir) / dados.length;
  const barra = Math.max(2, Math.min(28, largura - 2));
  const y = (v: number) => M.topo + (1 - v / topo) * (A - M.topo - M.base);
  const rotular = (i: number) => dados.length <= 14 || i % Math.ceil(dados.length / 10) === 0 || i === dados.length - 1;

  return (
    <figure className="relative">
      <figcaption className="mb-2 text-sm font-medium text-tinta">{titulo}</figcaption>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label={`${titulo}: ${dados.map((d) => `${d.detalhe} ${d.valor}`).join("; ")}`} onPointerLeave={() => setFoco(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.esq} x2={L - M.dir} y1={y(t)} y2={y(t)} stroke="var(--color-linha)" />
            <text x={M.esq - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-tinta-suave)">
              {t}
            </text>
          </g>
        ))}
        {dados.map((d, i) => {
          const cx = M.esq + i * largura + largura / 2;
          const h = A - M.base - y(d.valor);
          return (
            <g key={d.rotulo} onPointerEnter={() => setFoco(i)}>
              <rect x={M.esq + i * largura} y={M.topo} width={largura} height={A - M.topo - M.base} fill="transparent" />
              {d.valor > 0 ? (
                <path
                  d={`M${cx - barra / 2},${A - M.base} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${barra - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`}
                  fill="var(--color-serie-1)"
                  opacity={foco === null || foco === i ? 1 : 0.45}
                />
              ) : null}
              {rotular(i) ? (
                <text x={cx} y={A - 10} textAnchor="middle" fontSize={10.5} fill="var(--color-tinta-suave)">
                  {d.rotulo}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {foco !== null ? (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-linha bg-superficie px-3 py-2 text-xs shadow-flutuante"
          style={{
            left: `${((M.esq + foco * largura + largura / 2) / L) * 100}%`,
            transform: foco > dados.length / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <p className="font-medium text-tinta">{dados[foco]!.detalhe}</p>
          <p className="text-tinta-suave">{dados[foco]!.valor} {unidade}</p>
        </div>
      ) : null}
    </figure>
  );
}
