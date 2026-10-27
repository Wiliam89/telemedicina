import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  CreditCard,
  FilePen,
  FileText,
  Siren,
  Stethoscope,
  Users,
  Video,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ConsultaResumo, DocumentoResumo, MedicoResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { LinkBotao } from "@/componentes/Botao";
import { Carimbo } from "@/componentes/Carimbo";
import { StatusDaConsulta } from "@/componentes/EtiquetaDeStatus";
import { Avatar, CabecalhoDaPagina, Cartao, Indicador, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { diaIso, diaPorExtenso, hora } from "@/lib/datas";
import { NOME_DO_PAPEL, temPapel } from "@/lib/papeis";
import { formatarCpf } from "@/lib/validacao";

export const metadata: Metadata = { title: "Painel" };

interface EstadoDaFila {
  totalAguardando: number;
  medicosDePlantao: number;
  minhaPosicao: number | null;
}

function saudacao(fuso: string): string {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/**
 * O PAINEL: a primeira tela dentro da clinica, com o que importa AGORA
 * para cada papel - como nas plataformas de mercado.
 *
 *   paciente  -> proxima consulta, documentos recebidos, atalhos
 *   medico    -> agenda de hoje, documentos esperando assinatura, fila
 *   equipe    -> movimento do dia, pagamentos pendentes, fila, medicos
 *
 * Tudo vem das rotas que ja existem (e que ja filtram pelo papel): esta
 * tela so escolhe o que mostrar.
 */
export default async function PaginaPainel({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, perfil, clinica } = await contextoDaClinica(slug);
  const fuso = clinica.fusoHorario;
  // Quem tambem atende (medica dona do consultorio) ve o painel de medico.
  const papel = temPapel(clinica, "medico") ? "medico" : clinica.papel;

  const [consultas, documentos, fila, medicos] = await Promise.all([
    chamarApi<ConsultaResumo[]>("/consultas", { token, clinica: slug }),
    chamarApi<DocumentoResumo[]>("/documentos", { token, clinica: slug }),
    chamarApi<EstadoDaFila>("/fila", { token, clinica: slug }),
    chamarApi<MedicoResumo[]>("/medicos", { token, clinica: slug }),
  ]);

  const agora = Date.now();
  const hoje = diaIso(new Date(), fuso);
  const lista = consultas.ok ? consultas.dados : [];
  const ativas = lista.filter((c) => c.status !== "cancelada");
  const deHoje = ativas.filter((c) => diaIso(new Date(c.inicio), fuso) === hoje);
  const proximas = ativas.filter((c) => new Date(c.fim).getTime() >= agora && c.status !== "concluida");
  const docs = documentos.ok ? documentos.dados : [];
  const semAssinatura = docs.filter((d) => d.status === "emitido");
  const aguardandoPagamento = ativas.filter((c) => c.status === "aguardando_pagamento");
  const qtdMedicos = medicos.ok ? medicos.dados.length : 0;
  const base = `/c/${slug}`;

  // Cada papel ve suas consultas com o rotulo certo: o paciente quer saber
  // COM QUEM e; a equipe quer saber QUEM vem.
  const destaque = papel === "medico" ? deHoje : proximas;
  const tituloDaLista = papel === "medico" ? "Agenda de hoje" : papel === "paciente" ? "Próximas consultas" : "Próximos atendimentos";

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo={diaPorExtenso(new Date().toISOString(), fuso)}
        titulo={`${saudacao(fuso)}, ${perfil.nomeCompleto.split(" ")[0]}`}
        descricao={
          papel === "paciente"
            ? `Acompanhe suas consultas e documentos em ${clinica.nomeFantasia}.`
            : papel === "medico"
              ? "Seus atendimentos, documentos e a fila de pronto atendimento."
              : `Movimento de ${clinica.nomeFantasia}.`
        }
        acoes={
          papel === "paciente" ? (
            <>
              <LinkBotao href={`${base}/pronto-atendimento`} variante="secundario" icone={<Siren className="h-4 w-4" aria-hidden="true" />}>
                Pronto atendimento
              </LinkBotao>
              <LinkBotao href={`${base}/marcar`} icone={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}>
                Marcar consulta
              </LinkBotao>
            </>
          ) : papel === "recepcao" ? (
            <LinkBotao href={`${base}/marcar`} icone={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}>
              Marcar para um paciente
            </LinkBotao>
          ) : papel === "medico" ? (
            <LinkBotao href={`${base}/plantao`} variante="secundario" icone={<Siren className="h-4 w-4" aria-hidden="true" />}>
              Plantão e fila
            </LinkBotao>
          ) : (
            <LinkBotao href={`${base}/equipe`} icone={<Users className="h-4 w-4" aria-hidden="true" />}>
              Convidar equipe
            </LinkBotao>
          )
        }
      />

      {!consultas.ok ? <Aviso tipo="erro">{consultas.erro.mensagem}</Aviso> : null}

      {/* --- indicadores ------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {papel === "paciente" ? (
          <>
            <Indicador
              Icone={CalendarCheck2}
              rotulo="Próxima consulta"
              valor={proximas[0] ? hora(proximas[0].inicio, fuso) : "—"}
              detalhe={proximas[0] ? diaPorExtenso(proximas[0].inicio, fuso) : "Nenhuma marcada"}
            />
            <Indicador Icone={CalendarDays} tom="info" rotulo="Consultas marcadas" valor={proximas.length} detalhe="nos próximos 30 dias" />
            <Indicador Icone={FileText} tom="neutro" rotulo="Documentos recebidos" valor={docs.length} />
            <Indicador
              Icone={Siren}
              tom="espera"
              rotulo="Pronto atendimento"
              valor={fila.ok ? (fila.dados.minhaPosicao ? `${fila.dados.minhaPosicao}º` : fila.dados.medicosDePlantao > 0 ? "Aberto" : "Fechado") : "—"}
              detalhe={fila.ok ? (fila.dados.minhaPosicao ? "sua posição na fila" : `${fila.dados.medicosDePlantao} médico(s) de plantão`) : undefined}
            />
          </>
        ) : papel === "medico" ? (
          <>
            <Indicador Icone={CalendarCheck2} rotulo="Consultas hoje" valor={deHoje.length} detalhe={`${deHoje.filter((c) => c.status === "concluida").length} concluída(s)`} />
            <Indicador Icone={CalendarDays} tom="info" rotulo="Próximos 30 dias" valor={proximas.length} />
            <Indicador Icone={FilePen} tom="espera" rotulo="Aguardando assinatura" valor={semAssinatura.length} detalhe="documentos emitidos" />
            <Indicador Icone={Siren} tom="alerta" rotulo="Fila agora" valor={fila.ok ? fila.dados.totalAguardando : "—"} detalhe={fila.ok ? `${fila.dados.medicosDePlantao} de plantão` : undefined} />
          </>
        ) : (
          <>
            <Indicador Icone={CalendarCheck2} rotulo="Consultas hoje" valor={deHoje.length} />
            <Indicador Icone={CreditCard} tom="espera" rotulo="Aguardando pagamento" valor={aguardandoPagamento.length} />
            <Indicador Icone={Siren} tom="alerta" rotulo="Fila agora" valor={fila.ok ? fila.dados.totalAguardando : "—"} detalhe={fila.ok ? `${fila.dados.medicosDePlantao} de plantão` : undefined} />
            <Indicador Icone={Stethoscope} tom="info" rotulo="Médicos na clínica" valor={qtdMedicos} />
          </>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        {/* --- consultas --------------------------------------------------- */}
        <Cartao
          titulo={tituloDaLista}
          semPadding
          acoes={
            <Link href={`${base}/agenda`} className="inline-flex items-center gap-1 text-sm font-medium text-selo hover:text-selo-forte">
              Ver agenda <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        >
          {destaque.length === 0 ? (
            <div className="p-5">
              <Vazio Icone={CalendarDays} titulo={papel === "medico" ? "Nenhuma consulta hoje" : "Nenhuma consulta marcada"}>
                {papel === "paciente" ? "Marque uma consulta ou entre no pronto atendimento." : papel === "medico" ? "Confira seus horários de atendimento para receber marcações." : null}
              </Vazio>
            </div>
          ) : (
            <ul className="divide-y divide-linha">
              {destaque.slice(0, 8).map((c) => {
                const nome = papel === "paciente" ? c.medico.nomeCompleto : c.paciente.nomeCompleto;
                const sub = papel === "paciente" ? (c.medico.especialidade ?? `CRM ${c.medico.crm}-${c.medico.crmUf}`) : (c.motivo ?? "Sem observação");
                const href =
                  papel === "medico" && c.medico.id === perfil.id
                    ? `${base}/atendimento/${c.id}`
                    : papel === "paciente" && c.status === "aguardando_pagamento"
                      ? `${base}/pagamento/${c.id}`
                      : papel === "paciente"
                        ? `${base}/consulta/${c.id}`
                        : `${base}/agenda`;
                return (
                  <li key={c.id}>
                    <Link href={href} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-superficie-alt">
                      <div className="w-16 shrink-0 text-center">
                        <p className="font-titulo text-lg font-semibold leading-none">{hora(c.inicio, fuso)}</p>
                        <p className="mt-1 text-[0.7rem] uppercase text-tinta-suave">
                          {diaIso(new Date(c.inicio), fuso) === hoje ? "hoje" : diaPorExtenso(c.inicio, fuso).split(",")[0]}
                        </p>
                      </div>
                      <Avatar nome={nome} tamanho="p" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{nome}</p>
                        <p className="truncate text-sm text-tinta-suave">{sub}</p>
                      </div>
                      <StatusDaConsulta status={c.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>

        <div className="space-y-6">
          {/* --- identidade -------------------------------------------------- */}
          <Cartao titulo="Seu cadastro">
            <div className="flex items-center gap-4">
              <Avatar nome={perfil.nomeCompleto} tamanho="g" />
              <div className="min-w-0">
                <p className="truncate font-medium">{perfil.nomeCompleto}</p>
                <p className="text-sm text-tinta-suave">{perfil.medico?.especialidade ?? NOME_DO_PAPEL[papel]}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Carimbo>{NOME_DO_PAPEL[papel]}</Carimbo>
              {perfil.medico ? <Carimbo>{`CRM ${perfil.medico.crm}-${perfil.medico.crmUf}`}</Carimbo> : null}
              {perfil.cpf ? <Carimbo>{`CPF ${formatarCpf(perfil.cpf)}`}</Carimbo> : null}
            </div>
          </Cartao>

          {/* --- atalhos por papel ----------------------------------------- */}
          {papel === "medico" && semAssinatura.length > 0 ? (
            <Aviso tipo="espera">
              {semAssinatura.length} documento(s) emitido(s) ainda sem assinatura digital.{" "}
              <Link href={`${base}/documentos`} className="font-medium underline underline-offset-4">
                Assinar agora
              </Link>
            </Aviso>
          ) : null}

          <Cartao titulo={papel === "paciente" ? "Médicos da clínica" : "Equipe médica"} semPadding>
            {!medicos.ok ? (
              <div className="p-5">
                <Aviso tipo="erro">{medicos.erro.mensagem}</Aviso>
              </div>
            ) : medicos.dados.length === 0 ? (
              <div className="p-5">
                <Vazio Icone={Stethoscope} titulo="Nenhum médico ainda">
                  {papel === "admin_clinica" ? "Convide a equipe na tela Equipe." : "A administração pode convidar a equipe."}
                </Vazio>
              </div>
            ) : (
              <ul className="divide-y divide-linha">
                {medicos.dados.slice(0, 6).map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar nome={m.nomeCompleto} tamanho="p" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.nomeCompleto}</p>
                      <p className="truncate text-xs text-tinta-suave">{m.especialidade ?? "Clínica geral"}</p>
                    </div>
                    <span className="font-mono text-[0.7rem] text-tinta-suave">
                      CRM {m.crm}-{m.crmUf}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          {papel === "paciente" ? (
            <Cartao>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-selo-suave text-selo">
                  <Video className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="text-sm">
                  <p className="font-medium">Como funciona a teleconsulta</p>
                  <p className="mt-1 text-tinta-suave">
                    No horário marcado, abra a consulta pela agenda e permita câmera e microfone. A chamada não é gravada.
                  </p>
                </div>
              </div>
            </Cartao>
          ) : null}
        </div>
      </div>
    </div>
  );
}
