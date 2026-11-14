"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MedicoResumo, TipoDePreco } from "@tele/shared";
import { ESPECIALIDADES, NOME_DO_TIPO_DE_PRECO, TIPOS_DE_PRECO } from "@tele/shared/atendimento";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { CLASSE_CONTROLE } from "@/componentes/Campo";
import { chamarApi } from "@/lib/api";
import { paraCentavos } from "@/lib/dinheiro";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

interface Item {
  tipo: TipoDePreco;
  /** "" = valor padrao; "m:<id>" = de um medico; "e:<codigo>" = de uma especialidade. */
  alvo: string;
  texto: string;
}

const ehTeleconsulta = (tipo: TipoDePreco) => tipo === "agendada" || tipo === "teleconsulta_imediata";
const ehAgendado = (tipo: TipoDePreco) => tipo === "agendada" || tipo === "pronto_agendado";

/**
 * Os valores das duas linhas de atendimento, cada uma nos dois modos
 * (ADR-0024). Um valor pode ser o PADRAO do tipo, o de uma ESPECIALIDADE
 * (so na teleconsulta) ou o de um MEDICO (so no agendado, em que o paciente
 * escolhe com quem). Vale o mais especifico.
 */
export function EditorDePrecos({
  slug,
  inicial,
  medicos,
}: {
  slug: string;
  inicial: { tipo: string; medicoId: string | null; especialidade?: string | null; valorCentavos: number }[];
  medicos: MedicoResumo[];
}) {
  const router = useRouter();
  const [itens, setItens] = useState<Item[]>(
    inicial.map((p) => ({
      tipo: p.tipo as TipoDePreco,
      alvo: p.medicoId ? `m:${p.medicoId}` : p.especialidade ? `e:${p.especialidade}` : "",
      texto: (p.valorCentavos / 100).toFixed(2).replace(".", ","),
    })),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const mudar = (i: number, parte: Partial<Item>) => {
    setSalvo(false);
    setItens((a) => a.map((x, j) => (i === j ? { ...x, ...parte } : x)));
  };

  async function salvar() {
    setErro(null);
    const vistos = new Set<string>();
    const convertidos: { tipo: string; medicoId: string | null; especialidade: string | null; valorCentavos: number; comissaoPlataformaBps: number }[] = [];
    for (const i of itens) {
      const centavos = paraCentavos(i.texto);
      if (centavos === null || centavos < 100) {
        setErro(`Valor inválido em "${NOME_DO_TIPO_DE_PRECO[i.tipo]}". O mínimo é R$ 1,00.`);
        return;
      }
      const chave = `${i.tipo}|${i.alvo}`;
      if (vistos.has(chave)) {
        setErro(`Há dois valores iguais para "${NOME_DO_TIPO_DE_PRECO[i.tipo]}". Deixe só um.`);
        return;
      }
      vistos.add(chave);
      convertidos.push({
        tipo: i.tipo,
        medicoId: i.alvo.startsWith("m:") ? i.alvo.slice(2) : null,
        especialidade: i.alvo.startsWith("e:") ? i.alvo.slice(2) : null,
        valorCentavos: centavos,
        comissaoPlataformaBps: 0,
      });
    }
    setSalvando(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const r = await chamarApi<{ itens: number; aviso: string | null }>("/precos", { metodo: "PUT", token: data.session?.access_token, clinica: slug, corpo: { itens: convertidos } });
    if (r.ok) {
      setSalvo(true);
      setAviso(r.dados.aviso);
      router.refresh();
    } else setErro(r.erro.mensagem);
    setSalvando(false);
  }

  const semPadrao = TIPOS_DE_PRECO.filter((t) => !itens.some((i) => i.tipo === t && i.alvo === ""));

  return (
    <div className="max-w-3xl space-y-5">
      {semPadrao.length > 0 ? (
        <Aviso tipo="espera">
          Sem valor padrão definido: <strong>{semPadrao.map((t) => NOME_DO_TIPO_DE_PRECO[t]).join("; ")}</strong>. O atendimento imediato sem valor fica indisponível para o paciente, e a consulta agendada sem valor é marcada sem cobrança.
        </Aviso>
      ) : null}

      {itens.length === 0 ? null : (
        <ul className="space-y-3">
          {itens.map((item, i) => (
            <li key={i} className="grid gap-3 rounded-xl border border-linha bg-superficie p-4 shadow-cartao sm:grid-cols-[1.2fr_1.2fr_8rem_auto] sm:items-end">
              <div className="space-y-1.5">
                <label htmlFor={`tipo-${i}`} className="block text-sm font-medium">Atendimento</label>
                <select
                  id={`tipo-${i}`}
                  value={item.tipo}
                  onChange={(e) => {
                    const tipo = e.target.value as TipoDePreco;
                    // O alvo que nao faz sentido no novo tipo volta para o padrao.
                    const alvo = (item.alvo.startsWith("e:") && !ehTeleconsulta(tipo)) || (item.alvo.startsWith("m:") && !ehAgendado(tipo)) ? "" : item.alvo;
                    mudar(i, { tipo, alvo });
                  }}
                  className={`${CLASSE_CONTROLE} border-linha`}
                >
                  {TIPOS_DE_PRECO.map((t) => (
                    <option key={t} value={t}>{NOME_DO_TIPO_DE_PRECO[t]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`alvo-${i}`} className="block text-sm font-medium">Vale para</label>
                <select id={`alvo-${i}`} value={item.alvo} onChange={(e) => mudar(i, { alvo: e.target.value })} className={`${CLASSE_CONTROLE} border-linha`}>
                  <option value="">Todos (valor padrão)</option>
                  {ehTeleconsulta(item.tipo) ? (
                    <optgroup label="Uma especialidade">
                      {ESPECIALIDADES.map((e) => (
                        <option key={e.codigo} value={`e:${e.codigo}`}>{e.nome}</option>
                      ))}
                    </optgroup>
                  ) : null}
                  {ehAgendado(item.tipo) && medicos.length > 0 ? (
                    <optgroup label="Um médico">
                      {medicos.map((m) => (
                        <option key={m.id} value={`m:${m.id}`}>{m.nomeCompleto}</option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`valor-${i}`} className="block text-sm font-medium">Valor (R$)</label>
                <input
                  id={`valor-${i}`}
                  inputMode="decimal"
                  value={item.texto}
                  onChange={(e) => mudar(i, { texto: e.target.value })}
                  placeholder="150,00"
                  className={`${CLASSE_CONTROLE} border-linha text-right font-mono`}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSalvo(false);
                  setItens((a) => a.filter((_, j) => j !== i));
                }}
                className="text-sm text-alerta underline-offset-4 hover:underline"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {salvo ? <Aviso tipo="ok">Valores salvos.</Aviso> : null}
      {aviso ? <Aviso>{aviso}</Aviso> : null}

      <div className="flex flex-wrap gap-3">
        <Botao
          variante="secundario"
          onClick={() => {
            setSalvo(false);
            setItens((a) => [...a, { tipo: semPadrao[0] ?? "agendada", alvo: "", texto: "150,00" }]);
          }}
        >
          Adicionar valor
        </Botao>
        <Botao onClick={salvar} carregando={salvando}>Salvar</Botao>
      </div>
      <p className="text-sm text-tinta-suave">
        Vale sempre o valor mais específico: o do médico, depois o da especialidade, depois o padrão. O valor mostrado ao
        paciente quando ele marca ou entra na fila é o que será cobrado, mesmo que a tabela mude depois.
      </p>
    </div>
  );
}
