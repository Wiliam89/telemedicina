import type { Metadata } from "next";
import Link from "next/link";
import { VERSOES_LEGAIS } from "@tele/shared/lgpd";
import { DocumentoLegal } from "@/componentes/DocumentoLegal";
import { EMPRESA, ENCARREGADO, NOME_DA_PLATAFORMA } from "@/lib/marca";

export const metadata: Metadata = { title: "Política de privacidade", robots: { index: true, follow: true } };

/**
 * Politica de privacidade (LGPD art. 9: informacao clara, adequada e
 * ostensiva). Escrita para o paciente entender - e para a pericia achar
 * cada ponto que a lei exige. Revisao juridica antes de publicar e
 * recomendada; a versao fica em VERSOES_LEGAIS.
 */
export default function PaginaPrivacidade() {
  return (
    <DocumentoLegal
      titulo="Política de privacidade"
      versao={VERSOES_LEGAIS.politica_de_privacidade}
      resumo={
        <p>
          Como o {NOME_DA_PLATAFORMA} trata seus dados pessoais, em especial os dados de saúde, de acordo com a Lei Geral de Proteção de Dados (Lei
          13.709/2018), a Resolução CFM 2.314/2022 e a Lei do Prontuário Eletrônico (Lei 13.787/2018).
        </p>
      }
      secoes={[
        {
          id: "quem",
          titulo: "Quem trata seus dados",
          conteudo: (
            <>
              <p>
                Cada <strong>clínica</strong> que usa a plataforma é a <strong>controladora</strong> dos dados dos seus pacientes: é ela quem decide o
                atendimento e responde pelo prontuário, sob a direção técnica de um médico.
              </p>
              <p>
                A <strong>{EMPRESA.razaoSocial}</strong> (CNPJ {EMPRESA.cnpj}, {EMPRESA.endereco}), que mantém o {NOME_DA_PLATAFORMA}, é{" "}
                <strong>operadora</strong>: trata os dados em nome das clínicas, segundo as instruções delas e esta política. Para os dados de cadastro da
                sua conta (nome, e-mail, CPF), a empresa também é controladora.
              </p>
            </>
          ),
        },
        {
          id: "dados",
          titulo: "Quais dados coletamos",
          conteudo: (
            <ul>
              <li>
                <strong>Cadastro:</strong> nome, e-mail, telefone, CPF, data de nascimento; para médicos, CRM, UF e especialidade.
              </li>
              <li>
                <strong>Dados de saúde (sensíveis):</strong> motivo da consulta, prontuário (evoluções, ficha clínica, sinais vitais), exames enviados,
                receitas, atestados e pedidos de exame.
              </li>
              <li>
                <strong>Atendimento:</strong> agenda, fila de pronto atendimento, pagamentos (sem guardar número de cartão) e registro de entrada na sala
                de vídeo.
              </li>
              <li>
                <strong>Registros de acesso:</strong> quem acessou o quê e quando, endereço IP e navegador - exigidos pelo Marco Civil da Internet (art.
                15) e pela Resolução CFM 1.821/2007.
              </li>
            </ul>
          ),
        },
        {
          id: "finalidades",
          titulo: "Para que usamos e com que base legal",
          conteudo: (
            <ul>
              <li>
                <strong>Prestar o atendimento médico e manter o prontuário</strong> - tutela da saúde, por profissional de saúde (LGPD art. 11, II,
                &quot;f&quot;) e cumprimento de obrigação legal (art. 11, II, &quot;a&quot;; Lei 13.787/2018).
              </li>
              <li>
                <strong>Emitir documentos verificáveis</strong> (receitas, atestados) - obrigação legal e regulatória.
              </li>
              <li>
                <strong>Operar a conta, a agenda e o pagamento</strong> - execução de contrato (art. 7, V).
              </li>
              <li>
                <strong>Segurança, auditoria e prevenção a fraude</strong> - obrigação legal e legítimo interesse (art. 7, II e IX; art. 11, II, &quot;g&quot;).
              </li>
              <li>
                <strong>Atendimento por telemedicina</strong> - com o seu consentimento específico (Resolução CFM 2.314/2022), que você pode revogar a
                qualquer momento.
              </li>
            </ul>
          ),
        },
        {
          id: "compartilhamento",
          titulo: "Com quem compartilhamos",
          conteudo: (
            <>
              <p>
                <strong>Não vendemos dados.</strong> Seus dados de saúde não são usados para publicidade. Compartilhamos apenas o necessário com:
              </p>
              <ul>
                <li>a clínica e os profissionais que atendem você (cada clínica vê só os próprios registros);</li>
                <li>provedores de infraestrutura que guardam os dados no Brasil (banco de dados e arquivos em São Paulo);</li>
                <li>o provedor de videochamada, só durante a consulta - a chamada não é gravada;</li>
                <li>o provedor de assinatura digital ICP-Brasil, que recebe apenas o resumo criptográfico do documento, nunca o conteúdo;</li>
                <li>o provedor de pagamento, para processar a cobrança;</li>
                <li>autoridades, quando a lei ou uma ordem judicial exigir.</li>
              </ul>
            </>
          ),
        },
        {
          id: "seguranca",
          titulo: "Como protegemos",
          conteudo: (
            <ul>
              <li>Dados hospedados no Brasil (região São Paulo), com criptografia em trânsito e em repouso.</li>
              <li>Isolamento entre clínicas garantido no próprio banco de dados (segurança por linha).</li>
              <li>Recepção e administração da clínica não acessam o prontuário: só o médico que atende e o próprio paciente.</li>
              <li>O prontuário finalizado não pode ser alterado nem apagado; correções são feitas por adendo.</li>
              <li>Todo acesso ao prontuário fica registrado em trilha de auditoria que não pode ser editada.</li>
            </ul>
          ),
        },
        {
          id: "retencao",
          titulo: "Por quanto tempo guardamos",
          conteudo: (
            <>
              <p>
                O <strong>prontuário</strong> é guardado por no mínimo <strong>20 anos</strong> a partir do último registro, como determina a Lei
                13.787/2018. Por isso, um pedido de exclusão não apaga o registro clínico: ele é mantido por obrigação legal (LGPD art. 16, I), com acesso
                restrito.
              </p>
              <p>
                Registros de acesso são guardados por pelo menos 6 meses (Marco Civil, art. 15). Dados de cadastro que não forem mais necessários são
                excluídos ou anonimizados.
              </p>
            </>
          ),
        },
        {
          id: "direitos",
          titulo: "Seus direitos",
          conteudo: (
            <>
              <p>Pela LGPD (art. 18), você pode, a qualquer momento:</p>
              <ul>
                <li>confirmar se tratamos seus dados e acessá-los;</li>
                <li>corrigir dados incompletos, inexatos ou desatualizados;</li>
                <li>pedir anonimização, bloqueio ou eliminação de dados desnecessários;</li>
                <li>receber seus dados em formato estruturado (portabilidade);</li>
                <li>saber com quem seus dados foram compartilhados;</li>
                <li>revogar o consentimento e saber as consequências disso.</li>
              </ul>
              <p>
                Vários desses direitos você exerce sozinho em{" "}
                <Link href="/conta" className="font-medium text-selo hover:text-selo-forte">
                  Minha conta
                </Link>
                : ver e baixar seus dados, ver quem acessou seu prontuário, corrigir seu cadastro, revogar consentimentos e fazer pedidos. Respondemos em até
                15 dias.
              </p>
            </>
          ),
        },
        {
          id: "cookies",
          titulo: "Cookies",
          conteudo: (
            <p>
              Usamos apenas cookies <strong>estritamente necessários</strong>: o que mantém você conectado com segurança. Não usamos cookies de publicidade
              nem de rastreamento de terceiros.
            </p>
          ),
        },
        {
          id: "encarregado",
          titulo: "Encarregado (DPO) e contato",
          conteudo: (
            <>
              <p>
                Encarregado pelo tratamento de dados pessoais: <strong>{ENCARREGADO.nome}</strong> -{" "}
                <a href={`mailto:${ENCARREGADO.email}`} className="font-medium text-selo">
                  {ENCARREGADO.email}
                </a>
                .
              </p>
              <p>
                Se não ficar satisfeito com a resposta, você pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em{" "}
                <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer" className="font-medium text-selo">
                  gov.br/anpd
                </a>
                .
              </p>
            </>
          ),
        },
        {
          id: "mudancas",
          titulo: "Mudanças nesta política",
          conteudo: (
            <p>
              Quando esta política mudar, a data da versão no topo muda e pedimos que você leia e aceite de novo no próximo acesso. Cada aceite fica
              registrado com a versão do texto, a data e o endereço IP.
            </p>
          ),
        },
      ]}
    />
  );
}
