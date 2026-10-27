/**
 * =====================================================================
 * NOTIFICACOES (ADR-0019)
 * =====================================================================
 *
 * notificar()        registra o aviso (aparece na central da plataforma)
 * rodarAgendador()   a cada minuto: cria os lembretes de 24 h e de 1 h e
 *                    envia por e-mail o que ainda nao saiu
 *
 * Varias instancias da API podem rodar o agendador juntas: o lembrete tem
 * chave unica (entra uma vez so) e o envio reserva as linhas com
 * FOR UPDATE SKIP LOCKED (cada e-mail sai por uma instancia so).
 */
import { eq } from "drizzle-orm";
import { clinicas, notificacoes, type Banco } from "@tele/db";

export type TipoNotificacao = (typeof notificacoes.$inferInsert)["tipo"];

// --- envio de e-mail ---------------------------------------------------------

export interface EnviadorDeEmail {
  readonly nome: string;
  /** true = e-mail de verdade sai. O "console" so registra no log. */
  readonly real: boolean;
  enviar(m: { para: string; assunto: string; texto: string; html: string }): Promise<void>;
}

/** Desenvolvimento: nada sai; o aviso fica na central e no log. */
export class EnviadorConsole implements EnviadorDeEmail {
  readonly nome = "console";
  readonly real = false;
  readonly enviados: { para: string; assunto: string }[] = [];
  constructor(private readonly log: (m: string) => void = () => {}) {}
  async enviar(m: { para: string; assunto: string }): Promise<void> {
    this.enviados.push({ para: m.para, assunto: m.assunto });
    this.log(`[e-mail simulado] para ${m.para}: ${m.assunto}`);
  }
}

/** Resend (resend.com): API HTTP simples, plano gratuito para comecar. */
export class EnviadorResend implements EnviadorDeEmail {
  readonly nome = "resend";
  readonly real = true;
  constructor(
    private readonly chave: string,
    private readonly remetente: string,
  ) {}
  async enviar(m: { para: string; assunto: string; texto: string; html: string }): Promise<void> {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.chave}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.remetente, to: [m.para], subject: m.assunto, text: m.texto, html: m.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Resend respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

// --- registrar ---------------------------------------------------------------

export interface NovaNotificacao {
  perfilId: string;
  clinicaId: string | null;
  tipo: TipoNotificacao;
  titulo: string;
  corpo: string;
  link: string | null;
  /** Identifica o aviso: o mesmo nao entra duas vezes para a mesma pessoa. */
  chave: string;
}

type Executor = Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0];

export async function notificar(b: Executor, avisos: NovaNotificacao | NovaNotificacao[]): Promise<void> {
  const lista = Array.isArray(avisos) ? avisos : [avisos];
  if (lista.length === 0) return;
  await b.insert(notificacoes).values(lista).onConflictDoNothing({ target: [notificacoes.perfilId, notificacoes.chave] });
}

/** "qui, 29/10 às 09:00" no fuso da clinica. */
export function quandoNaClinica(instante: Date, fuso: string): string {
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  return `${(p.weekday ?? "").replace(".", "")}, ${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

export async function fusoDaClinica(b: Executor, clinicaId: string): Promise<{ fuso: string; nome: string; slug: string }> {
  const [c] = await b.select({ fuso: clinicas.fusoHorario, nome: clinicas.nomeFantasia, slug: clinicas.slug }).from(clinicas).where(eq(clinicas.id, clinicaId)).limit(1);
  return c ?? { fuso: "America/Sao_Paulo", nome: "", slug: "" };
}

// --- agendador ---------------------------------------------------------------

const MAX_TENTATIVAS = 5;

function html(titulo: string, corpo: string, link: string | null, urlDoSite: string, plataforma: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const botao = link
    ? `<p style="margin:24px 0"><a href="${urlDoSite}${link}" style="background:#0b7f7a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Abrir na plataforma</a></p>`
    : "";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
<p style="color:#0b7f7a;font-weight:700">${esc(plataforma)}</p>
<h1 style="font-size:20px">${esc(titulo)}</h1>
<p style="line-height:1.6">${esc(corpo)}</p>${botao}
<p style="font-size:12px;color:#5b6779">Por segurança, este e-mail não traz dados clínicos. Entre na plataforma para ver os detalhes.</p>
</div>`;
}

export interface ResultadoDoAgendador {
  lembretes: number;
  enviados: number;
  falhas: number;
}

export async function rodarAgendador(
  banco: Banco,
  enviador: EnviadorDeEmail,
  opcoes: { urlDoSite: string; plataforma: string; agora?: Date },
): Promise<ResultadoDoAgendador> {
  const agora = opcoes.agora ?? new Date();
  const sqlc = banco.$client;

  // 1) Lembretes. Janelas largas (23-25 h, 50-70 min) para nao perder
  //    consulta se o agendador ficar parado alguns minutos.
  let lembretes = 0;
  const janelas = [
    { tipo: "lembrete_24h" as const, de: 23 * 60, ate: 25 * 60, titulo: "Lembrete: consulta amanhã" },
    { tipo: "lembrete_1h" as const, de: 50, ate: 70, titulo: "Sua consulta começa em breve" },
  ];
  for (const j of janelas) {
    const de = new Date(agora.getTime() + j.de * 60000).toISOString();
    const ate = new Date(agora.getTime() + j.ate * 60000).toISOString();
    const proximas = await sqlc<{ id: string; inicio: Date; paciente_id: string; medico_id: string; clinica_id: string; fuso: string; slug: string; medico: string; paciente: string }[]>`
      select c.id, c.inicio, c.paciente_id, c.medico_id, c.clinica_id, cl.fuso_horario as fuso, cl.slug,
             pm.nome_completo as medico, pp.nome_completo as paciente
      from consultas c
      join clinicas cl on cl.id = c.clinica_id
      join perfis pm on pm.id = c.medico_id
      join perfis pp on pp.id = c.paciente_id
      where c.status = 'agendada' and c.inicio between ${de}::timestamptz and ${ate}::timestamptz`;
    for (const c of proximas) {
      const quando = quandoNaClinica(new Date(c.inicio), c.fuso);
      await notificar(banco, [
        {
          perfilId: c.paciente_id,
          clinicaId: c.clinica_id,
          tipo: j.tipo,
          titulo: j.titulo,
          corpo: `Teleconsulta com Dr(a). ${c.medico} ${quando}. Tenha uma boa conexão e permita câmera e microfone.`,
          link: `/c/${c.slug}/agenda`,
          chave: `${j.tipo}:${c.id}`,
        },
        {
          perfilId: c.medico_id,
          clinicaId: c.clinica_id,
          tipo: j.tipo,
          titulo: j.titulo,
          corpo: `Atendimento de ${c.paciente} ${quando}.`,
          link: `/c/${c.slug}/agenda`,
          chave: `${j.tipo}:${c.id}`,
        },
      ]);
      lembretes += 2;
    }
  }

  // 2) E-mails pendentes. Reservar com SKIP LOCKED: duas instancias nunca
  //    pegam a mesma linha. A tentativa conta antes do envio - se a
  //    instancia cair no meio, o aviso volta na proxima rodada.
  let enviados = 0;
  let falhas = 0;
  const lote = await sqlc<{ id: string; titulo: string; corpo: string; link: string | null; email: string | null }[]>`
    update notificacoes n set email_tentativas = n.email_tentativas + 1
    from (
      select id from notificacoes
      where email_enviado_em is null and email_tentativas < ${MAX_TENTATIVAS} and criado_em > now() - interval '2 days'
      order by criado_em
      limit 50
      for update skip locked
    ) alvo
    where n.id = alvo.id
    returning n.id, n.titulo, n.corpo, n.link, (select u.email from auth.users u where u.id = n.perfil_id) as email`;

  for (const n of lote) {
    try {
      if (!n.email) throw new Error("pessoa sem e-mail");
      await enviador.enviar({ para: n.email, assunto: n.titulo, texto: `${n.corpo}\n\n${n.link ? opcoes.urlDoSite + n.link : opcoes.urlDoSite}`, html: html(n.titulo, n.corpo, n.link, opcoes.urlDoSite, opcoes.plataforma) });
      await banco.update(notificacoes).set({ emailEnviadoEm: new Date(), emailErro: null }).where(eq(notificacoes.id, n.id));
      enviados++;
    } catch (e) {
      await banco.update(notificacoes).set({ emailErro: String((e as Error).message).slice(0, 300) }).where(eq(notificacoes.id, n.id));
      falhas++;
    }
  }

  return { lembretes, enviados, falhas };
}
