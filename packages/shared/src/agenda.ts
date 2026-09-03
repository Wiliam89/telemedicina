/**
 * =====================================================================
 * CALCULO DE HORARIOS LIVRES
 * =====================================================================
 *
 * Fica em @tele/shared, e nao na API, por um motivo: o site precisa dos
 * MESMOS horarios que a API vai aceitar. Se cada lado calculasse do seu
 * jeito, o paciente veria "10:30 livre", clicaria, e levaria um erro.
 *
 * A regra, em uma frase: um horario aparece se estiver dentro da grade
 * semanal do medico, nao cair dentro de um bloqueio, nao colidir com
 * consulta ja marcada, e nao estar no passado.
 *
 * SOBRE FUSO HORARIO (ADR-0009): a grade e escrita em hora LOCAL da
 * clinica ("segunda, 08:00"), porque e assim que a recepcao pensa. Ja a
 * consulta e gravada em instante absoluto (timestamptz). A conversao
 * entre os dois acontece aqui, uma vez, com o fuso da clinica - nunca
 * com o fuso do computador de quem esta olhando.
 */

export interface BlocoDaGrade {
  diaSemana: number;
  /** "08:00:00" */
  horaInicio: string;
  horaFim: string;
  duracaoMinutos: number;
}

export interface Periodo {
  /** ISO 8601 com fuso. */
  inicio: string;
  fim: string;
}

export interface HorarioLivre {
  inicio: string;
  fim: string;
  /** "09:30" - ja no fuso da clinica, pronto para exibir. */
  rotulo: string;
}

/** Minutos desde a meia-noite: "08:30:00" -> 510. */
export function minutosDoDia(hora: string): number {
  const [h = "0", m = "0"] = hora.split(":");
  return Number(h) * 60 + Number(m);
}

/** 510 -> "08:30" */
export function formatarMinutos(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Descobre o deslocamento do fuso (em minutos) de uma data num fuso IANA.
 * Usa Intl, que ja conhece o historico de horario de verao - por isso nao
 * escrevemos "-03:00" fixo em lugar nenhum.
 */
export function deslocamentoDoFuso(data: Date, fuso: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(data).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return (comoUtc - Math.floor(data.getTime() / 1000) * 1000) / 60000;
}

/** O instante exato de "dia 2026-09-10, 08:30" no fuso da clinica. */
export function instanteLocal(dataIso: string, minutos: number, fuso: string): Date {
  const [ano = 0, mes = 1, dia = 1] = dataIso.split("-").map(Number);
  // Primeiro chute em UTC; depois corrige pelo deslocamento daquele dia.
  const chute = new Date(Date.UTC(ano, mes - 1, dia, 0, minutos, 0));
  const desloc = deslocamentoDoFuso(chute, fuso);
  return new Date(chute.getTime() - desloc * 60000);
}

/** Que dia da semana e essa data, no fuso da clinica? (0 = domingo) */
export function diaDaSemanaLocal(dataIso: string, fuso: string): number {
  const meioDia = instanteLocal(dataIso, 12 * 60, fuso);
  const nome = new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short" }).format(meioDia);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nome);
}

const seCruzam = (aInicio: number, aFim: number, bInicio: number, bFim: number) => aInicio < bFim && bInicio < aFim;

export interface EntradaHorarios {
  /** Data pedida, "AAAA-MM-DD". */
  data: string;
  fuso: string;
  grade: BlocoDaGrade[];
  /** Bloqueios e consultas ja marcadas, como instantes absolutos. */
  ocupado: Periodo[];
  /** "Agora" - horarios anteriores a isto nao aparecem. */
  agora?: Date;
  /** Quanto tempo antes do horario ainda da para marcar (padrao: 0). */
  antecedenciaMinutos?: number;
}

/**
 * Monta a lista de horarios livres de um medico num dia.
 * Determinista: as mesmas entradas dao sempre a mesma saida - por isso da
 * para testar sem banco, sem rede e sem depender do relogio.
 */
export function calcularHorariosLivres(e: EntradaHorarios): HorarioLivre[] {
  const dia = diaDaSemanaLocal(e.data, e.fuso);
  const agora = e.agora ?? new Date();
  const limite = agora.getTime() + (e.antecedenciaMinutos ?? 0) * 60000;

  const ocupado = e.ocupado.map((p) => ({ i: new Date(p.inicio).getTime(), f: new Date(p.fim).getTime() }));
  const livres: HorarioLivre[] = [];

  for (const bloco of e.grade.filter((b) => b.diaSemana === dia)) {
    const inicioMin = minutosDoDia(bloco.horaInicio);
    const fimMin = minutosDoDia(bloco.horaFim);

    for (let m = inicioMin; m + bloco.duracaoMinutos <= fimMin; m += bloco.duracaoMinutos) {
      const inicio = instanteLocal(e.data, m, e.fuso);
      const fim = new Date(inicio.getTime() + bloco.duracaoMinutos * 60000);

      if (inicio.getTime() < limite) continue;
      if (ocupado.some((o) => seCruzam(inicio.getTime(), fim.getTime(), o.i, o.f))) continue;

      livres.push({ inicio: inicio.toISOString(), fim: fim.toISOString(), rotulo: formatarMinutos(m) });
    }
  }

  return livres.sort((a, b) => a.inicio.localeCompare(b.inicio));
}
