import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BadgeDollarSign, CalendarCheck2, ClipboardList, IdCard, Inbox, Percent, Radio, RotateCcw, Siren, Stethoscope, Users, Wallet } from "lucide-react";
import type { ResumoDaAdministracao } from "@tele/shared";
import { formatarPercentual } from "@tele/shared/admin";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Cartao, Indicador } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { emReais } from "@/lib/dinheiro";
import { temPapel } from "@/lib/papeis";

export const metadata: Metadata = { title: "Administração" };

/**
 * O PAINEL DA ADMINISTRACAO (ADR-0026): o que esta acontecendo agora, como
 * foram os ultimos 30 dias e - o mais importante - o que esta esperando uma
 * decisao. Cada pendencia leva direto a tela onde ela se resolve.
 */
export default async function PaginaAdministracao({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();
  const r = await chamarApi<ResumoDaAdministracao>("/admin/resumo", { token, clinica: slug });
  const base = `/c/${slug}`;
  if (!r.ok) return <Aviso tipo="erro">{r.erro.mensagem}</Aviso>;
  const d = r.dados;

  const pendencias = [
    { n: d.pendencias.credenciamentos, texto: "pedido(s) de credenciamento esperando análise", href: `${base}/credenciamentos`, Icone: IdCard },
    { n: d.pendencias.reembolsos, texto: "reembolso(s) a fazer", href: `${base}/admin/financeiro#reembolsos`, Icone: RotateCcw },
    { n: d.pendencias.pagamentosDePacientes, texto: "consulta(s) com cobrança recusada no cartão do paciente", href: `${base}/admin/financeiro#recusadas`, Icone: BadgeDollarSign },
    { n: d.pendencias.pedidosLgpd, texto: "pedido(s) de pacientes sobre dados pessoais (LGPD)", href: `${base}/privacidade`, Icone: Inbox },
    { n: d.pendencias.medicosSemPercentual, texto: "médico(s) sem porcentagem definida — consultas marcadas antes de definir usarão a porcentagem do dia em que você definir", href: `${base}/admin/configuracoes`, Icone: Percent },
    { n: d.pendencias.crmVencendo, texto: "CRM(s) com conferência vencendo em 30 dias", href: `${base}/equipe`, Icone: Stethoscope },
  ].filter((p) => p.n > 0);

  const atalhos = [
    { titulo: "Médicos", texto: "Porcentagens, especialidades e quem está online", href: `${base}/admin/medicos`, Icone: Stethoscope },
    { titulo: "Financeiro", texto: "Receita, repasses aos médicos e reembolsos", href: `${base}/admin/financeiro`, Icone: Wallet },
    { titulo: "Valores das consultas", texto: "Quanto custa cada atendimento", href: `${base}/precos`, Icone: BadgeDollarSign },
    { titulo: "Credenciamentos", texto: "Novos médicos querendo atender", href: `${base}/credenciamentos`, Icone: IdCard },
    { titulo: "Equipe", texto: "Recepção, administração, suspender acesso", href: `${base}/equipe`, Icone: Users },
    { titulo: "Indicadores", texto: "Gráficos de consultas e atendimento", href: `${base}/indicadores`, Icone: CalendarCheck2 },
    { titulo: "Auditoria", texto: "Quem fez o quê, e quando", href: `${base}/admin/auditoria`, Icone: ClipboardList },
    { titulo: "Configurações", texto: "Dados da empresa, porcentagem padrão, fuso", href: `${base}/admin/configuracoes`, Icone: Percent },
  ];

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina sobretitulo="Administração" titulo={d.plataforma.nome} descricao="Tudo o que acontece na plataforma, num lugar só." />

      {!d.plataforma.recebimentoConfigurado ? (
        <Aviso tipo="erro">
          A conta de recebimento ainda não está configurada: os pacientes não conseguem pagar. Veja “Conta de recebimento” no guia de publicação.
        </Aviso>
      ) : null}

      <section aria-labelledby="titulo-hoje" className="space-y-3">
        <h2 id="titulo-hoje" className="text-lg text-tinta">Agora</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador Icone={CalendarCheck2} rotulo="Consultas hoje" valor={d.hoje.consultas} detalhe={`${d.hoje.concluidas} concluída(s)`} />
          <Indicador Icone={Siren} tom="alerta" rotulo="Pacientes na fila" valor={d.hoje.naFila} />
          <Indicador Icone={Radio} tom="info" rotulo="Médicos online" valor={d.hoje.medicosOnline} />
          <Indicador Icone={Wallet} tom="espera" rotulo="A repassar aos médicos" valor={emReais(d.saldoTotalARepassarCentavos)} detalhe="saldo de todos" />
        </div>
      </section>

      <section aria-labelledby="titulo-30" className="space-y-3">
        <h2 id="titulo-30" className="text-lg text-tinta">Últimos 30 dias</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador Icone={BadgeDollarSign} rotulo="Recebido dos pacientes" valor={emReais(d.ultimos30dias.receitaCentavos)} />
          <Indicador Icone={Wallet} tom="info" rotulo="Ganho dos médicos" valor={emReais(d.ultimos30dias.repasseCentavos)} detalhe={`porcentagem padrão: ${formatarPercentual(d.plataforma.repassePadraoBps)}`} />
          <Indicador Icone={CalendarCheck2} tom="neutro" rotulo="Consultas concluídas" valor={d.ultimos30dias.consultasConcluidas} />
          <Indicador Icone={Users} tom="neutro" rotulo="Pacientes novos" valor={d.ultimos30dias.pacientesNovos} />
        </div>
      </section>

      <Cartao titulo="Precisa da sua atenção" semPadding>
        {pendencias.length === 0 ? (
          <p className="p-5 text-sm text-tinta-suave">Nada pendente agora. Tudo em dia.</p>
        ) : (
          <ul className="divide-y divide-linha">
            {pendencias.map(({ n, texto, href, Icone }) => (
              <li key={texto}>
                <Link href={href} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-superficie-alt">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-espera-suave text-espera">
                    <Icone className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="flex-1 text-sm">
                    <strong className="font-titulo text-base">{n}</strong> {texto}
                  </span>
                  <ArrowRight className="h-4 w-4 text-tinta-suave" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <section aria-labelledby="titulo-gerenciar" className="space-y-3">
        <h2 id="titulo-gerenciar" className="text-lg text-tinta">Gerenciar</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {atalhos.map(({ titulo, texto, href, Icone }) => (
            <li key={titulo}>
              <Link href={href} className="flex h-full flex-col gap-2 rounded-xl border border-linha bg-superficie p-4 shadow-cartao transition-colors hover:border-selo/60 hover:bg-selo-suave/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-selo/20">
                <Icone className="h-5 w-5 text-selo" aria-hidden="true" />
                <span className="font-medium text-tinta">{titulo}</span>
                <span className="text-sm text-tinta-suave">{texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
