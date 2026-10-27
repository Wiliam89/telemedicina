import {
  Activity,
  AlertTriangle,
  CalendarCheck2,
  ClipboardList,
  FileHeart,
  FileText,
  FolderOpen,
  HeartPulse,
  History,
  Lock,
  Paperclip,
  Pill,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type {
  AnexoResumo,
  EventoDaLinhaDoTempo,
  EvolucaoResumo,
  FichaClinicaResumo,
  PacienteDetalhe,
  SinalVitalResumo,
  TipoDeEvento,
} from "@tele/shared";
import { CATEGORIAS_DE_ANEXO, classificarImc } from "@tele/shared/prontuario";
import { Aviso } from "../Aviso";
import { Avatar, Cartao, Etiqueta, Vazio, type Tom } from "../ui";
import { chamarApi } from "@/lib/api";
import { BaixarAnexo, EnviarAnexo } from "./Anexos";
import { FormularioFicha } from "./FormularioFicha";
import { FormularioSinais } from "./FormularioSinais";
import { GraficoDeEvolucao, type Serie } from "./GraficoDeEvolucao";

export type Aba = "resumo" | "linha" | "sinais" | "exames" | "evolucoes";

const ABAS: { id: Aba; rotulo: string; Icone: LucideIcon; soMedico?: boolean }[] = [
  { id: "resumo", rotulo: "Resumo", Icone: ClipboardList },
  { id: "linha", rotulo: "Linha do tempo", Icone: History },
  { id: "evolucoes", rotulo: "Evoluções", Icone: Stethoscope, soMedico: true },
  { id: "sinais", rotulo: "Sinais vitais", Icone: HeartPulse },
  { id: "exames", rotulo: "Exames e anexos", Icone: Paperclip },
];

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const mascararCpf = (cpf: string) => `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;

/** Cabecalho com identificacao e o alerta de alergia - sempre visivel. */
export function CabecalhoDoPaciente({ p, ficha }: { p: PacienteDetalhe; ficha: FichaClinicaResumo | null }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
        <Avatar nome={p.nomeCompleto} tamanho="g" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl text-tinta">{p.nomeCompleto}</h1>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-tinta-suave">
            {p.idade !== null ? <span>{p.idade} anos</span> : null}
            {p.dataNascimento ? <span>Nasc. {new Date(`${p.dataNascimento}T12:00:00`).toLocaleDateString("pt-BR")}</span> : null}
            {p.cpf ? <span>CPF {mascararCpf(p.cpf)}</span> : null}
            {p.telefone ? <span>Tel. {p.telefone}</span> : null}
            {ficha?.tipoSanguineo ? <span>Tipo {ficha.tipoSanguineo}</span> : null}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-tinta-suave">Consultas</dt>
          <dd className="font-medium">{p.totalConsultas}</dd>
          <dt className="text-tinta-suave">Última</dt>
          <dd className="font-medium">{p.ultimaConsulta ? data(p.ultimaConsulta) : "—"}</dd>
          <dt className="text-tinta-suave">Próxima</dt>
          <dd className="font-medium">{p.proximaConsulta ? dataHora(p.proximaConsulta) : "—"}</dd>
        </dl>
      </div>

      {p.acessoClinico ? (
        ficha && ficha.alergias.length > 0 ? (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-alerta/30 bg-alerta-suave px-4 py-3 text-sm text-alerta">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Alergias</p>
              <p>{ficha.alergias.join(" · ")}</p>
            </div>
          </div>
        ) : ficha?.negaAlergias ? (
          <Aviso tipo="ok">Paciente nega alergias.</Aviso>
        ) : (
          <Aviso tipo="espera">Alergias ainda não registradas na ficha clínica.</Aviso>
        )
      ) : null}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr]">
      <dt className="text-sm text-tinta-suave">{rotulo}</dt>
      <dd className="whitespace-pre-wrap text-sm">{valor || <span className="text-tinta-suave">Não informado</span>}</dd>
    </div>
  );
}

/**
 * O valor mais recente DE CADA medida - a ultima afericao pode ter so a
 * pressao (medida em casa), e o peso de dois meses atras ainda importa.
 */
export function ResumoSinais({ sinais }: { sinais: SinalVitalResumo[] }) {
  if (sinais.length === 0) return <p className="text-sm text-tinta-suave">Nenhuma medida registrada.</p>;
  const ultimoCom = (f: (s: SinalVitalResumo) => unknown) => sinais.find((s) => f(s) !== null && f(s) !== undefined);
  const pa = ultimoCom((s) => s.pressaoSistolica);
  const fc = ultimoCom((s) => s.frequenciaCardiaca);
  const peso = ultimoCom((s) => s.pesoKg);
  const imc = ultimoCom((s) => s.imc);
  const temp = ultimoCom((s) => s.temperaturaC);
  const sat = ultimoCom((s) => s.saturacaoO2);
  const gli = ultimoCom((s) => s.glicemiaMgDl);
  const itens: [string, string, SinalVitalResumo][] = [];
  if (pa) itens.push(["Pressão", `${pa.pressaoSistolica}x${pa.pressaoDiastolica} mmHg`, pa]);
  if (fc) itens.push(["Freq. cardíaca", `${fc.frequenciaCardiaca} bpm`, fc]);
  if (peso) itens.push(["Peso", `${peso.pesoKg!.toLocaleString("pt-BR")} kg`, peso]);
  if (imc) itens.push(["IMC", `${imc.imc!.toLocaleString("pt-BR")} · ${classificarImc(imc.imc!)}`, imc]);
  if (temp) itens.push(["Temperatura", `${temp.temperaturaC!.toLocaleString("pt-BR")} °C`, temp]);
  if (sat) itens.push(["SpO₂", `${sat.saturacaoO2}%`, sat]);
  if (gli) itens.push(["Glicemia", `${gli.glicemiaMgDl} mg/dL`, gli]);
  return (
    <div className="grid grid-cols-2 gap-3">
      {itens.map(([r, v, s]) => (
        <div key={r} className="rounded-lg bg-superficie-alt px-3 py-2">
          <p className="text-xs text-tinta-suave">{r}</p>
          <p className="text-sm font-semibold">{v}</p>
          <p className="mt-0.5 text-[0.7rem] text-tinta-suave">
            {data(s.medidoEm)}
            {s.origem === "paciente" ? " · em casa" : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

const EVENTO: Record<TipoDeEvento, { Icone: LucideIcon; tom: Tom }> = {
  consulta: { Icone: CalendarCheck2, tom: "info" },
  evolucao: { Icone: Stethoscope, tom: "selo" },
  documento: { Icone: FileText, tom: "neutro" },
  sinais: { Icone: Activity, tom: "alerta" },
  anexo: { Icone: Paperclip, tom: "espera" },
  ficha: { Icone: FileHeart, tom: "neutro" },
};

const ESTADO: Record<string, { rotulo: string; tom: Tom }> = {
  agendada: { rotulo: "Agendada", tom: "info" },
  em_andamento: { rotulo: "Em andamento", tom: "selo" },
  concluida: { rotulo: "Concluída", tom: "neutro" },
  cancelada: { rotulo: "Cancelada", tom: "alerta" },
  rascunho: { rotulo: "Rascunho", tom: "espera" },
  finalizada: { rotulo: "Finalizada", tom: "selo" },
  emitido: { rotulo: "Aguardando assinatura", tom: "espera" },
  assinado: { rotulo: "Assinado", tom: "selo" },
  cancelado: { rotulo: "Cancelado", tom: "alerta" },
};

function LinhaDoTempo({ eventos }: { eventos: EventoDaLinhaDoTempo[] }) {
  if (eventos.length === 0) return <Vazio Icone={History} titulo="Nada registrado ainda" />;
  return (
    <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[1.2rem] before:top-3 before:w-px before:bg-linha">
      {eventos.map((e) => {
        const { Icone, tom } = EVENTO[e.tipo];
        const estado = e.estado ? ESTADO[e.estado] : null;
        return (
          <li key={`${e.tipo}-${e.id}`} className="relative flex gap-4 rounded-lg px-1 py-2.5">
            <span
              className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ring-4 ring-superficie ${
                tom === "selo" ? "bg-selo-suave text-selo" : tom === "info" ? "bg-info-suave text-info" : tom === "alerta" ? "bg-alerta-suave text-alerta" : tom === "espera" ? "bg-espera-suave text-espera" : "bg-marinho-suave text-tinta-suave"
              }`}
            >
              <Icone className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{e.titulo}</p>
                {estado ? <Etiqueta tom={estado.tom}>{estado.rotulo}</Etiqueta> : null}
              </div>
              {e.detalhe ? <p className="mt-0.5 text-sm text-tinta">{e.detalhe}</p> : null}
              <p className="mt-0.5 text-xs text-tinta-suave">
                {dataHora(e.em)}
                {e.autor ? ` · ${e.autor}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PainelDeSinais({ sinais }: { sinais: SinalVitalResumo[] }) {
  const cronologico = [...sinais].reverse();
  const serie = (nome: string, cor: string, f: (s: SinalVitalResumo) => number | null): Serie => ({
    nome,
    cor,
    pontos: cronologico.flatMap((s) => (f(s) === null ? [] : [{ em: s.medidoEm, valor: f(s)! }])),
  });
  const graficos: { titulo: string; unidade: string; series: Serie[] }[] = [
    { titulo: "Pressão arterial", unidade: "mmHg", series: [serie("Sistólica", "var(--color-serie-1)", (s) => s.pressaoSistolica), serie("Diastólica", "var(--color-serie-2)", (s) => s.pressaoDiastolica)] },
    { titulo: "Peso", unidade: "kg", series: [serie("Peso", "var(--color-serie-1)", (s) => s.pesoKg)] },
    { titulo: "Glicemia", unidade: "mg/dL", series: [serie("Glicemia", "var(--color-serie-1)", (s) => s.glicemiaMgDl)] },
    { titulo: "Frequência cardíaca", unidade: "bpm", series: [serie("FC", "var(--color-serie-1)", (s) => s.frequenciaCardiaca)] },
  ].filter((g) => g.series.some((s) => s.pontos.length > 0));

  return (
    <div className="space-y-6">
      {graficos.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {graficos.map((g) => (
            <div key={g.titulo} className="rounded-xl border border-linha bg-superficie p-4 shadow-cartao">
              <GraficoDeEvolucao titulo={g.titulo} unidade={g.unidade} series={g.series} />
            </div>
          ))}
        </div>
      ) : null}

      {sinais.length === 0 ? (
        <Vazio Icone={HeartPulse} titulo="Nenhuma medida registrada" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-linha bg-superficie shadow-cartao">
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">Histórico de sinais vitais</caption>
            <thead className="bg-superficie-alt text-left text-xs uppercase tracking-wide text-tinta-suave">
              <tr>
                {["Data", "PA", "FC", "FR", "Temp.", "SpO₂", "Peso", "IMC", "Glicemia", "Origem"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {sinais.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap px-3 py-2.5">{dataHora(s.medidoEm)}</td>
                  <td className="px-3 py-2.5">{s.pressaoSistolica ? `${s.pressaoSistolica}x${s.pressaoDiastolica}` : "—"}</td>
                  <td className="px-3 py-2.5">{s.frequenciaCardiaca ?? "—"}</td>
                  <td className="px-3 py-2.5">{s.frequenciaRespiratoria ?? "—"}</td>
                  <td className="px-3 py-2.5">{s.temperaturaC?.toLocaleString("pt-BR") ?? "—"}</td>
                  <td className="px-3 py-2.5">{s.saturacaoO2 ? `${s.saturacaoO2}%` : "—"}</td>
                  <td className="px-3 py-2.5">{s.pesoKg?.toLocaleString("pt-BR") ?? "—"}</td>
                  <td className="px-3 py-2.5">{s.imc?.toLocaleString("pt-BR") ?? "—"}</td>
                  <td className="px-3 py-2.5">{s.glicemiaMgDl ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Etiqueta tom={s.origem === "paciente" ? "espera" : "neutro"}>{s.origem === "paciente" ? "Paciente" : "Profissional"}</Etiqueta>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ListaDeEvolucoes({ evolucoes }: { evolucoes: EvolucaoResumo[] }) {
  if (evolucoes.length === 0) return <Vazio Icone={Stethoscope} titulo="Nenhuma evolução registrada" />;
  return (
    <div className="space-y-4">
      {evolucoes.map((e) => (
        <Cartao
          key={e.id}
          titulo={`${e.adendoDe ? "Adendo" : "Evolução"} · ${dataHora(e.finalizadaEm ?? e.criadoEm)}`}
          descricao={`${e.medico.nomeCompleto} · CRM ${e.medico.crm}-${e.medico.crmUf}`}
          acoes={<Etiqueta tom={e.status === "finalizada" ? "selo" : "espera"}>{e.status === "finalizada" ? "Finalizada" : "Rascunho"}</Etiqueta>}
        >
          <dl className="divide-y divide-linha">
            <Linha rotulo="S · Subjetivo" valor={e.subjetivo} />
            <Linha rotulo="O · Objetivo" valor={e.objetivo} />
            <Linha rotulo="A · Avaliação" valor={e.avaliacao} />
            <Linha rotulo="P · Plano" valor={e.plano} />
            {e.cid10 ? <Linha rotulo="CID-10" valor={e.cid10} /> : null}
          </dl>
        </Cartao>
      ))}
    </div>
  );
}

/**
 * O PRONTUARIO DO PACIENTE, numa tela so: cabecalho com alerta de
 * alergia, e abas para resumo, linha do tempo, evolucoes, sinais vitais e
 * exames. Usado pela equipe (/pacientes/<id>) e pelo proprio paciente
 * (/minha-saude) - o que cada um ve e decidido pela API.
 */
export async function ProntuarioDoPaciente({
  slug,
  token,
  pacienteId,
  aba,
  base,
  souMedico,
}: {
  slug: string;
  token: string;
  pacienteId: string;
  aba: Aba;
  /** Endereco desta tela, para os links das abas. */
  base: string;
  souMedico: boolean;
}) {
  const opcoes = { token, clinica: slug };
  const paciente = await chamarApi<PacienteDetalhe>(`/pacientes/${pacienteId}`, opcoes);
  if (!paciente.ok) return <Aviso tipo="erro">{paciente.erro.mensagem}</Aviso>;
  const p = paciente.dados;

  if (!p.acessoClinico) {
    return (
      <div className="space-y-6">
        <CabecalhoDoPaciente p={p} ficha={null} />
        <Vazio Icone={Lock} titulo="Dados clínicos protegidos">
          {souMedico
            ? "Você acessa o prontuário depois que houver uma consulta sua com este paciente nesta clínica."
            : "Recepção e administração veem o cadastro e a agenda, mas não o prontuário (LGPD, art. 6º, III)."}
        </Vazio>
      </div>
    );
  }

  const ficha = await chamarApi<FichaClinicaResumo | null>(`/pacientes/${pacienteId}/ficha`, opcoes);
  const f = ficha.ok ? ficha.dados : null;
  const abas = ABAS.filter((a) => !a.soMedico || souMedico);
  const atual = abas.some((a) => a.id === aba) ? aba : "resumo";

  let conteudo: React.ReactNode = null;
  if (atual === "resumo") {
    const sinais = await chamarApi<SinalVitalResumo[]>(`/pacientes/${pacienteId}/sinais`, opcoes);
    conteudo = (
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Cartao
          titulo="Ficha clínica"
          descricao={f ? `Versão ${f.versao} · ${f.registradoPor} · ${dataHora(f.criadoEm)}` : "Ainda não preenchida"}
          acoes={souMedico ? <FormularioFicha slug={slug} pacienteId={pacienteId} atual={f} /> : undefined}
        >
          {!f ? (
            <Vazio Icone={ClipboardList} titulo="Ficha clínica vazia">
              {souMedico ? "Registre alergias, medicamentos em uso e antecedentes." : "O médico preenche a ficha durante o atendimento."}
            </Vazio>
          ) : (
            <dl className="divide-y divide-linha">
              <div className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr]">
                <dt className="text-sm text-tinta-suave">Medicamentos em uso</dt>
                <dd>
                  {f.medicamentosEmUso.length === 0 ? (
                    <span className="text-sm text-tinta-suave">Nenhum</span>
                  ) : (
                    <ul className="space-y-1">
                      {f.medicamentosEmUso.map((m) => (
                        <li key={m} className="flex items-center gap-2 text-sm">
                          <Pill className="h-3.5 w-3.5 text-selo" aria-hidden="true" /> {m}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <Linha rotulo="Doenças e condições" valor={f.comorbidades} />
              <Linha rotulo="Antecedentes familiares" valor={f.antecedentesFamiliares} />
              <Linha rotulo="Cirurgias e internações" valor={f.cirurgiasInternacoes} />
              <Linha rotulo="Hábitos" valor={f.habitos} />
              <Linha rotulo="Observações" valor={f.observacoes} />
            </dl>
          )}
        </Cartao>
        <Cartao titulo="Últimos sinais vitais" acoes={<Link href={`${base}?aba=sinais`} className="text-sm font-medium text-selo hover:text-selo-forte">Histórico</Link>}>
          {sinais.ok ? <ResumoSinais sinais={sinais.dados} /> : <Aviso tipo="erro">{sinais.erro.mensagem}</Aviso>}
        </Cartao>
      </div>
    );
  } else if (atual === "linha") {
    const r = await chamarApi<EventoDaLinhaDoTempo[]>(`/pacientes/${pacienteId}/linha-do-tempo`, opcoes);
    conteudo = <Cartao>{r.ok ? <LinhaDoTempo eventos={r.dados} /> : <Aviso tipo="erro">{r.erro.mensagem}</Aviso>}</Cartao>;
  } else if (atual === "evolucoes") {
    const r = await chamarApi<EvolucaoResumo[]>(`/pacientes/${pacienteId}/prontuario`, opcoes);
    conteudo = r.ok ? <ListaDeEvolucoes evolucoes={r.dados} /> : <Aviso tipo="erro">{r.erro.mensagem}</Aviso>;
  } else if (atual === "sinais") {
    const r = await chamarApi<SinalVitalResumo[]>(`/pacientes/${pacienteId}/sinais`, opcoes);
    conteudo = (
      <div className="space-y-6">
        <Cartao titulo="Nova medida" descricao={souMedico ? "Registrada como medida profissional." : "Informe o que você mediu em casa (pressão, glicemia, peso)."}>
          <FormularioSinais slug={slug} pacienteId={pacienteId} />
        </Cartao>
        {r.ok ? <PainelDeSinais sinais={r.dados} /> : <Aviso tipo="erro">{r.erro.mensagem}</Aviso>}
      </div>
    );
  } else {
    const r = await chamarApi<AnexoResumo[]>(`/pacientes/${pacienteId}/anexos`, opcoes);
    conteudo = (
      <Cartao titulo="Exames e anexos" descricao="Arquivos guardados em armazenamento privado no Brasil. Cada abertura fica registrada." acoes={<EnviarAnexo slug={slug} pacienteId={pacienteId} />} semPadding>
        {!r.ok ? (
          <div className="p-5">
            <Aviso tipo="erro">{r.erro.mensagem}</Aviso>
          </div>
        ) : r.dados.length === 0 ? (
          <div className="p-5">
            <Vazio Icone={FolderOpen} titulo="Nenhum exame enviado">
              Envie resultados de exames, laudos e receitas de outros serviços em PDF ou imagem.
            </Vazio>
          </div>
        ) : (
          <ul className="divide-y divide-linha">
            {r.dados.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-espera-suave text-espera">
                  <Paperclip className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium">{a.titulo}</p>
                  <p className="text-sm text-tinta-suave">
                    {CATEGORIAS_DE_ANEXO[a.categoria]}
                    {a.dataDoExame ? ` · exame de ${data(a.dataDoExame)}` : ""} · enviado por {a.origem === "paciente" ? "paciente" : a.enviadoPor} em {data(a.criadoEm)} ·{" "}
                    {(a.tamanhoBytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB
                  </p>
                </div>
                <BaixarAnexo slug={slug} anexoId={a.id} />
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    );
  }

  return (
    <div className="space-y-6">
      <CabecalhoDoPaciente p={p} ficha={f} />
      <nav aria-label="Seções do prontuário" className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-linha px-1">
        {abas.map(({ id, rotulo, Icone }) => (
          <Link
            key={id}
            href={`${base}?aba=${id}`}
            aria-current={id === atual ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              id === atual ? "border-selo font-medium text-selo" : "border-transparent text-tinta-suave hover:text-tinta"
            }`}
          >
            <Icone className="h-4 w-4" aria-hidden="true" />
            {rotulo}
          </Link>
        ))}
      </nav>
      {conteudo}
    </div>
  );
}
