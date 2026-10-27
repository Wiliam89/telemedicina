import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileSignature,
  Lock,
  MapPin,
  ScrollText,
  ShieldCheck,
  Siren,
  Video,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { LinkBotao } from "@/componentes/Botao";
import { usuarioAtual } from "@/lib/supabase-servidor";

const atraso = (s: number) => ({ "--atraso": `${s}s` }) as CSSProperties;

const RECURSOS = [
  { Icone: Video, titulo: "Teleconsulta", texto: "Sala exclusiva por consulta, aberta só para paciente e médico. Sem gravação." },
  { Icone: CalendarClock, titulo: "Agenda inteligente", texto: "Grade do médico, horários livres calculados e reserva sem conflito." },
  { Icone: Siren, titulo: "Pronto atendimento", texto: "Fila 24 horas com plantão, triagem por queixa e estimativa de espera." },
  { Icone: ClipboardList, titulo: "Prontuário eletrônico", texto: "Evolução SOAP, CID-10, histórico do paciente e registro imutável." },
  { Icone: FileSignature, titulo: "Assinatura ICP-Brasil", texto: "Receitas, atestados e pedidos de exame assinados em nuvem." },
  { Icone: CreditCard, titulo: "Pagamento com split", texto: "Pix e cartão, com o repasse feito pelo provedor de pagamento." },
];

const CONFORMIDADE = [
  { Icone: MapPin, titulo: "Dados no Brasil", texto: "Servidores em São Paulo, como exige a Resolução CFM 2.314/2022." },
  { Icone: Lock, titulo: "Isolamento por clínica", texto: "Garantido pelo banco de dados (RLS), não só pela tela." },
  { Icone: ScrollText, titulo: "Trilha de auditoria", texto: "Cada acesso ao prontuário fica registrado e não pode ser apagado." },
  { Icone: BadgeCheck, titulo: "Documento verificável", texto: "Qualquer farmácia confere a autenticidade pelo código, sem conta." },
];

/**
 * A CAPA DO SITE.
 *
 * Quem ja esta logado nao ve nada disto - vai direto para /clinicas, que
 * decide o destino. Server Component sem JavaScript no navegador: as
 * animacoes sao CSS puro, e quem reduz movimento ve tudo parado no lugar.
 */
export default async function Capa() {
  if (await usuarioAtual()) redirect("/clinicas");

  return (
    <div>
      {/* --- heroi ------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-linha bg-superficie">
        <div className="malha absolute inset-0" aria-hidden="true" />
        <div className="grade-pontilhada absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <p
              className="surge inline-flex items-center gap-2 rounded-full border border-selo/25 bg-selo-suave px-3 py-1 text-xs font-semibold text-selo-forte"
              style={atraso(0.05)}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Conforme CFM 2.314/2022 e LGPD
            </p>
            <h1 className="surge mt-6 text-4xl leading-[1.08] text-tinta sm:text-5xl lg:text-[3.6rem]" style={atraso(0.15)}>
              Telemedicina completa para <span className="text-selo">clínicas e médicos</span>
            </h1>
            <p className="surge mt-6 max-w-xl text-lg leading-relaxed text-tinta-suave" style={atraso(0.3)}>
              Agenda, teleconsulta, prontuário eletrônico, receitas com assinatura digital e pagamento — numa plataforma só,
              com os dados guardados no Brasil.
            </p>
            <div className="surge mt-9 flex flex-wrap items-center gap-3" style={atraso(0.45)}>
              <LinkBotao href="/criar-conta" tamanho="g" icone={<ArrowRight className="order-last h-4 w-4" aria-hidden="true" />}>
                Começar agora
              </LinkBotao>
              <LinkBotao href="/entrar" tamanho="g" variante="secundario">
                Já tenho conta
              </LinkBotao>
            </div>
            <ul className="surge mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-tinta-suave" style={atraso(0.6)}>
              {["Sem instalar nada", "Funciona no celular", "Sala de vídeo segura"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-selo" aria-hidden="true" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* ilustracao: uma "tela" de consulta montada com HTML */}
          <div className="surge relative" style={atraso(0.35)} aria-hidden="true">
            <div className="rounded-2xl border border-linha bg-superficie p-3 shadow-flutuante">
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-gradient-to-br from-marinho to-[#123d5e]">
                <div className="malha absolute inset-0 opacity-60" />
                <div className="absolute inset-0 grid place-items-center">
                  <div className="grid h-24 w-24 place-items-center rounded-full bg-white/10 ring-1 ring-white/20">
                    <span className="font-titulo text-3xl font-semibold text-white">DR</span>
                  </div>
                </div>
                <div className="absolute bottom-3 right-3 h-20 w-28 rounded-lg bg-white/15 ring-1 ring-white/25 backdrop-blur" />
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-xs text-white">
                  <span className="h-2 w-2 rounded-full bg-[#5fd6cf]" /> Em consulta · 12:04
                </div>
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={`h-9 w-9 rounded-full ${i === 2 ? "bg-alerta" : "bg-white/20"}`} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 p-3">
                {["Prontuário", "Receita", "Atestado"].map((t) => (
                  <div key={t} className="rounded-xl border border-linha bg-superficie-alt px-3 py-2 text-xs font-medium text-tinta-suave">
                    {t}
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-6 -left-4 hidden items-center gap-3 rounded-xl border border-linha bg-superficie px-4 py-3 shadow-flutuante sm:flex">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-selo-suave text-selo">
                <FileSignature className="h-5 w-5" />
              </span>
              <div className="text-xs">
                <p className="font-semibold text-tinta">Receita assinada</p>
                <p className="text-tinta-suave">ICP-Brasil · verificável</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- recursos ---------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-selo">Tudo em um lugar</p>
          <h2 className="mt-3 text-3xl text-tinta sm:text-4xl">Do agendamento ao documento assinado</h2>
          <p className="mt-4 text-tinta-suave">Cada etapa do atendimento a distância, pensada para quem atende e para quem é atendido.</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {RECURSOS.map(({ Icone, titulo, texto }) => (
            <div key={titulo} className="group rounded-xl border border-linha bg-superficie p-6 shadow-cartao transition-shadow hover:shadow-flutuante">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-selo-suave text-selo transition-colors group-hover:bg-selo group-hover:text-white">
                <Icone className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-lg text-tinta">{titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --- como funciona ----------------------------------------------- */}
      <section className="border-y border-linha bg-superficie">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-3xl text-tinta sm:text-4xl">Como funciona</h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-4">
            {[
              ["Crie sua conta", "Paciente ou médico, em menos de um minuto."],
              ["Escolha o horário", "Ou entre na fila do pronto atendimento."],
              ["Faça a consulta", "Por vídeo, no navegador do celular ou computador."],
              ["Receba os documentos", "Receita e atestado assinados, prontos para a farmácia."],
            ].map(([t, d], i) => (
              <li key={t} className="relative">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-marinho font-titulo font-semibold text-white">{i + 1}</span>
                <h3 className="mt-4 text-base text-tinta">{t}</h3>
                <p className="mt-1 text-sm text-tinta-suave">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --- conformidade ------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-selo">Segurança e conformidade</p>
            <h2 className="mt-3 text-3xl text-tinta sm:text-4xl">Dado de saúde tratado como dado de saúde</h2>
            <p className="mt-4 text-tinta-suave">
              A plataforma foi construída a partir das exigências do CFM e da LGPD — não adaptada depois.
            </p>
            <Link href="/validar" className="mt-6 inline-flex items-center gap-1.5 font-medium text-selo hover:text-selo-forte">
              Validar um documento <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {CONFORMIDADE.map(({ Icone, titulo, texto }) => (
              <div key={titulo} className="flex gap-4 rounded-xl border border-linha bg-superficie p-5">
                <Icone className="mt-0.5 h-5 w-5 shrink-0 text-selo" aria-hidden="true" />
                <div>
                  <h3 className="text-base text-tinta">{titulo}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-tinta-suave">{texto}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- chamada final ----------------------------------------------- */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-marinho px-6 py-14 text-center sm:px-12">
          <div className="malha absolute inset-0 opacity-80" aria-hidden="true" />
          <div className="relative">
            <Building2 className="mx-auto h-10 w-10 text-[#5fd6cf]" aria-hidden="true" />
            <h2 className="mx-auto mt-5 max-w-2xl text-3xl text-white sm:text-4xl">Abra sua clínica digital hoje</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/70">Crie a conta, cadastre a clínica e convide sua equipe. Cada clínica tem agenda, equipe e prontuários isolados.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <LinkBotao href="/criar-conta" tamanho="g">
                Criar conta
              </LinkBotao>
              <LinkBotao href="/entrar" tamanho="g" variante="fantasma" className="text-white hover:bg-white/10 hover:text-white">
                Entrar
              </LinkBotao>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
