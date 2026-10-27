import { Eye, FileDown, ShieldCheck, UserRound, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { AcessoAosMeusDados, ConsentimentoResumo, PerfilResposta, SolicitacaoResumo } from "@tele/shared";
import { NOME_DO_CONSENTIMENTO, TIPOS_DE_SOLICITACAO, VERSOES_LEGAIS, type TipoConsentimento } from "@tele/shared/lgpd";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Cartao, Etiqueta, Vazio, type Tom } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { ENCARREGADO } from "@/lib/marca";
import { formatarCpf } from "@/lib/validacao";
import { tokenAtual, usuarioAtual } from "@/lib/supabase-servidor";
import { BaixarMeusDados, CorrigirDados, NovoPedido, RevogarConsentimento } from "./Acoes";

export const metadata: Metadata = { title: "Minha conta e privacidade" };

const STATUS: Record<SolicitacaoResumo["status"], { rotulo: string; tom: Tom }> = {
  aberta: { rotulo: "Aberta", tom: "info" },
  em_andamento: { rotulo: "Em andamento", tom: "espera" },
  concluida: { rotulo: "Concluída", tom: "selo" },
  negada: { rotulo: "Negada", tom: "alerta" },
};

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * A AREA DO TITULAR (LGPD art. 18): o que a lei garante, exercido sem
 * precisar escrever para ninguem - ver e corrigir o cadastro, baixar uma
 * copia de tudo, ver quem acessou o prontuario, revogar consentimentos e
 * fazer pedidos ao controlador, com prazo de resposta.
 */
export default async function PaginaConta() {
  const token = await tokenAtual();
  const usuario = await usuarioAtual();
  const perfil = await chamarApi<PerfilResposta>("/perfis/eu", { token });
  if (!perfil.ok && perfil.status === 404) redirect("/completar-perfil?depois=/conta");
  if (!perfil.ok) return <div className="mx-auto max-w-4xl px-4 py-12"><Aviso tipo="erro">{perfil.erro.mensagem}</Aviso></div>;
  const p = perfil.dados;

  const [acessos, aceites, pedidos] = await Promise.all([
    chamarApi<AcessoAosMeusDados[]>("/lgpd/acessos", { token }),
    chamarApi<ConsentimentoResumo[]>("/lgpd/consentimentos", { token }),
    chamarApi<SolicitacaoResumo[]>("/lgpd/solicitacoes", { token }),
  ]);
  const deOutros = acessos.ok ? acessos.dados.filter((a) => !a.souEu) : [];
  const ultimoDe = (tipo: TipoConsentimento) => (aceites.ok ? aceites.dados.find((a) => a.tipo === tipo) : undefined);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
      <CabecalhoDaPagina
        titulo="Minha conta e privacidade"
        descricao={
          <>
            Seus direitos como titular de dados (LGPD, art. 18), num só lugar. Dúvidas: encarregado de dados,{" "}
            <a href={`mailto:${ENCARREGADO.email}`} className="font-medium text-selo">
              {ENCARREGADO.email}
            </a>
            .
          </>
        }
        acoes={p.clinicas[0] ? <Link href={`/c/${p.clinicas[0].slug}/inicio`} className="text-sm font-medium text-selo hover:text-selo-forte">Voltar à clínica</Link> : undefined}
      />

      <Cartao titulo={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-selo" aria-hidden="true" /> Meus dados</span>} descricao="Corrija nome e telefone. CPF, CRM e data de nascimento mudam por pedido, pois identificam você em documentos já emitidos.">
        <dl className="mb-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-tinta-suave">E-mail</dt>
            <dd className="font-medium">{usuario?.email}</dd>
          </div>
          <div>
            <dt className="text-tinta-suave">CPF</dt>
            <dd className="font-medium">{p.cpf ? formatarCpf(p.cpf) : "Não informado"}</dd>
          </div>
          <div>
            <dt className="text-tinta-suave">Nascimento</dt>
            <dd className="font-medium">{p.paciente ? new Date(`${p.paciente.dataNascimento}T12:00:00`).toLocaleDateString("pt-BR") : "—"}</dd>
          </div>
          {p.medico ? (
            <div>
              <dt className="text-tinta-suave">CRM</dt>
              <dd className="font-medium">
                {p.medico.crm}-{p.medico.crmUf}
              </dd>
            </div>
          ) : null}
        </dl>
        <CorrigirDados nome={p.nomeCompleto} telefone={p.telefone} />
      </Cartao>

      <Cartao titulo={<span className="flex items-center gap-2"><FileDown className="h-4 w-4 text-selo" aria-hidden="true" /> Cópia dos meus dados</span>} descricao="Tudo o que a plataforma guarda sobre você - cadastro, consultas, prontuário, documentos, consentimentos - num arquivo que você pode levar para outro serviço (portabilidade).">
        <BaixarMeusDados />
      </Cartao>

      <Cartao
        titulo={<span className="flex items-center gap-2"><Eye className="h-4 w-4 text-selo" aria-hidden="true" /> Quem acessou meus dados</span>}
        descricao="Cada acesso de profissional ao seu prontuário e aos seus documentos fica registrado e não pode ser apagado."
        acoes={<Etiqueta>{deOutros.length} registro(s)</Etiqueta>}
        semPadding
      >
        {!acessos.ok ? (
          <div className="p-5"><Aviso tipo="erro">{acessos.erro.mensagem}</Aviso></div>
        ) : deOutros.length === 0 ? (
          <div className="p-5"><Vazio Icone={Eye} titulo="Ninguém além de você acessou seus dados ainda" /></div>
        ) : (
          <ul className="max-h-96 divide-y divide-linha overflow-y-auto">
            {deOutros.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{a.descricao}</p>
                  <p className="text-tinta-suave">
                    {a.quem ?? "Sistema"}
                    {a.clinica ? ` · ${a.clinica}` : ""}
                  </p>
                </div>
                <span className="text-xs text-tinta-suave">{dataHora(a.quando)}</span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao titulo={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-selo" aria-hidden="true" /> Consentimentos</span>} descricao="O que você aceitou, em qual versão e quando." semPadding>
        <ul className="divide-y divide-linha">
          {(Object.keys(VERSOES_LEGAIS) as TipoConsentimento[]).map((tipo) => {
            const u = ultimoDe(tipo);
            const vigente = u && u.acao === "aceito" && u.versao === VERSOES_LEGAIS[tipo];
            return (
              <li key={tipo} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-[14rem] flex-1">
                  <p className="font-medium">{NOME_DO_CONSENTIMENTO[tipo]}</p>
                  <p className="text-sm text-tinta-suave">
                    {u ? `${u.acao === "aceito" ? "Aceito" : "Revogado"} em ${dataHora(u.criadoEm)} · versão ${u.versao}` : "Nunca aceito"}
                  </p>
                </div>
                <Etiqueta tom={vigente ? "selo" : "espera"}>{vigente ? "Vigente" : "Pendente"}</Etiqueta>
                {vigente ? <RevogarConsentimento tipo={tipo} /> : null}
              </li>
            );
          })}
        </ul>
      </Cartao>

      <Cartao titulo={<span className="flex items-center gap-2"><Inbox className="h-4 w-4 text-selo" aria-hidden="true" /> Pedidos ao encarregado de dados</span>} descricao="Para o que você não consegue fazer sozinho aqui. Prazo de resposta: 15 dias (LGPD, art. 19).">
        <NovoPedido clinicas={p.clinicas} />
        {pedidos.ok && pedidos.dados.length > 0 ? (
          <ul className="mt-6 divide-y divide-linha rounded-lg border border-linha">
            {pedidos.dados.map((s) => (
              <li key={s.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{TIPOS_DE_SOLICITACAO[s.tipo]}</p>
                  <Etiqueta tom={STATUS[s.status].tom}>{STATUS[s.status].rotulo}</Etiqueta>
                  <span className="text-xs text-tinta-suave">
                    {s.clinica ?? "Plataforma"} · aberto em {dataHora(s.criadoEm)} · prazo {new Date(s.prazo).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <p className="text-tinta-suave">{s.descricao}</p>
                {s.resposta ? <p className="rounded-lg bg-selo-suave px-3 py-2 text-selo-forte">Resposta: {s.resposta}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Cartao>
    </div>
  );
}
