import Link from "next/link";
import type { MeiosDePagamento, PendenciaDePagamento, PerfilResposta } from "@tele/shared";
import { NOME_DO_STATUS_DO_CREDENCIAMENTO } from "@tele/shared/credenciamento";
import { Aviso } from "@/componentes/Aviso";
import { chamarApi } from "@/lib/api";
import { emReais } from "@/lib/dinheiro";

/**
 * O que a pessoa precisa saber assim que entra (ADR-0022 e ADR-0023):
 *   - consulta realizada cuja cobranca no cartao nao passou (bloqueia novas);
 *   - cartao cadastrado ou nao, e o que isso muda;
 *   - em que pe esta o credenciamento de quem pediu para atender.
 *
 * Server Component: busca na API e nao mostra nada quando nao ha o que dizer.
 */
export async function AvisosDaConta({ slug, token, perfil, souPaciente, souMedico }: { slug: string; token: string; perfil: PerfilResposta; souPaciente: boolean; souMedico: boolean }) {
  const base = `/c/${slug}`;
  const [pendencias, meios] = souPaciente
    ? await Promise.all([
        chamarApi<PendenciaDePagamento[]>("/pagamentos/pendencias", { token, clinica: slug }),
        chamarApi<MeiosDePagamento>("/cartoes", { token, clinica: slug }),
      ])
    : [null, null];

  const devidas = pendencias?.ok ? pendencias.dados : [];
  const cartao = meios?.ok ? meios.dados.cartao : null;
  const podeCadastrar = meios?.ok ? meios.dados.tokenizacao.disponivel : false;
  const pedido = perfil.medico && !souMedico ? (perfil.credenciamento ?? "rascunho") : null;

  if (devidas.length === 0 && !pedido && (cartao ? !cartao.vencido : !podeCadastrar || !souPaciente)) return null;

  return (
    <div className="space-y-3">
      {devidas.map((p) => (
        <Aviso key={p.consultaId} tipo="erro">
          A cobrança de <strong>{emReais(p.valorCentavos)}</strong> da sua consulta com {p.medicoNome} não foi aprovada no cartão. Regularize para marcar novos atendimentos.{" "}
          <Link href={`${base}/pagamento/${p.consultaId}`} className="font-medium underline underline-offset-4">
            Pagar agora
          </Link>
        </Aviso>
      ))}

      {pedido ? (
        <Aviso tipo={pedido === "recusado" || pedido === "pendente_de_ajuste" ? "erro" : pedido === "em_analise" ? "espera" : "info"}>
          <strong>Credenciamento médico: {NOME_DO_STATUS_DO_CREDENCIAMENTO[pedido]}.</strong>{" "}
          {pedido === "rascunho"
            ? "Para atender pela plataforma, envie seus documentos e confirme a sua identidade."
            : pedido === "em_analise"
              ? "A administração está conferindo seus documentos. Você recebe um aviso assim que houver resposta."
              : "Abra o seu pedido para ver a mensagem da administração."}{" "}
          <Link href={`${base}/credenciamento`} className="font-medium underline underline-offset-4">
            {pedido === "rascunho" ? "Começar" : "Ver o pedido"}
          </Link>
        </Aviso>
      ) : null}

      {souPaciente && cartao?.vencido ? (
        <Aviso tipo="espera">
          Seu cartão final {cartao.ultimos4} venceu. Até você cadastrar outro, o pagamento é por Pix, antes de cada consulta.{" "}
          <Link href={`${base}/cartao`} className="font-medium underline underline-offset-4">
            Atualizar cartão
          </Link>
        </Aviso>
      ) : souPaciente && !cartao && podeCadastrar ? (
        <Aviso>
          <strong>Quer pular o pagamento antes de cada consulta?</strong> Cadastre um cartão (opcional): o valor só é debitado quando a consulta termina. Sem cartão, você paga por Pix antes de cada atendimento.{" "}
          <Link href={`${base}/cartao`} className="font-medium text-selo underline underline-offset-4">
            Cadastrar cartão
          </Link>
        </Aviso>
      ) : null}
    </div>
  );
}
