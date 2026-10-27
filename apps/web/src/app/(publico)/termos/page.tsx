import type { Metadata } from "next";
import Link from "next/link";
import { VERSOES_LEGAIS } from "@tele/shared/lgpd";
import { DocumentoLegal } from "@/componentes/DocumentoLegal";
import { EMPRESA, ENCARREGADO, NOME_DA_PLATAFORMA } from "@/lib/marca";

export const metadata: Metadata = { title: "Termos de uso", robots: { index: true, follow: true } };

/**
 * Termos de uso da plataforma e o termo de consentimento para atendimento
 * por telemedicina (Resolucao CFM 2.314/2022, art. 15). Revisao juridica
 * antes de publicar e recomendada; a versao fica em VERSOES_LEGAIS.
 */
export default function PaginaTermos() {
  return (
    <DocumentoLegal
      titulo="Termos de uso"
      versao={VERSOES_LEGAIS.termos_de_uso}
      resumo={
        <p>
          Regras de uso do {NOME_DA_PLATAFORMA}, mantido por {EMPRESA.razaoSocial} (CNPJ {EMPRESA.cnpj}). Leia também a{" "}
          <Link href="/privacidade" className="font-medium text-selo">
            Política de privacidade
          </Link>
          .
        </p>
      }
      secoes={[
        {
          id: "servico",
          titulo: "O que é a plataforma",
          conteudo: (
            <p>
              Um sistema para clínicas e médicos realizarem atendimento a distância: agenda, pronto atendimento, videochamada, prontuário eletrônico,
              emissão de documentos com assinatura digital e pagamento. <strong>A plataforma não presta atendimento médico</strong>: quem atende é o
              médico, com registro ativo no Conselho Regional de Medicina, vinculado a uma clínica que responde pelo serviço.
            </p>
          ),
        },
        {
          id: "conta",
          titulo: "Sua conta",
          conteudo: (
            <ul>
              <li>Os dados do cadastro devem ser verdadeiros e seus. A conta é pessoal e intransferível.</li>
              <li>Guarde sua senha; não a compartilhe. Avise-nos se suspeitar de uso indevido.</li>
              <li>Menores de 18 anos são atendidos com a presença e o consentimento do responsável legal.</li>
            </ul>
          ),
        },
        {
          id: "medicos",
          titulo: "Profissionais de saúde",
          conteudo: (
            <ul>
              <li>O médico declara ter CRM ativo; a clínica confere o registro no Conselho antes de liberar a emissão de documentos e o atendimento.</li>
              <li>O médico é responsável pelo ato médico, pelo prontuário e pelos documentos que emite, segundo o Código de Ética Médica.</li>
              <li>Documentos com valor legal exigem assinatura digital com certificado ICP-Brasil do próprio médico.</li>
              <li>Cabe ao médico decidir se o caso pode ser atendido a distância ou exige atendimento presencial.</li>
            </ul>
          ),
        },
        {
          id: "telemedicina",
          titulo: "Consentimento para atendimento por telemedicina",
          conteudo: (
            <>
              <p>Ao aceitar este termo, você declara estar ciente de que:</p>
              <ul>
                <li>a teleconsulta tem limitações em relação à consulta presencial, como a impossibilidade de exame físico completo;</li>
                <li>o médico pode, a qualquer momento, recomendar atendimento presencial ou de urgência;</li>
                <li>em emergência (dor no peito, falta de ar, desmaio, sangramento intenso, sinais de AVC), ligue 192 (SAMU) ou vá ao pronto-socorro;</li>
                <li>a videochamada é feita em sala exclusiva da consulta e <strong>não é gravada</strong>;</li>
                <li>o atendimento é registrado em prontuário, guardado com segurança no Brasil, ao qual você tem acesso;</li>
                <li>você pode revogar este consentimento em Minha conta; sem ele, o atendimento a distância não pode ser feito.</li>
              </ul>
            </>
          ),
        },
        {
          id: "uso",
          titulo: "Uso permitido",
          conteudo: (
            <ul>
              <li>É proibido usar a plataforma para fins ilícitos, inserir dados de terceiros sem autorização ou tentar acessar dados de outras pessoas.</li>
              <li>É proibido gravar, fotografar ou divulgar a teleconsulta sem o consentimento de todos os participantes.</li>
              <li>Tentativas de burlar a segurança são registradas e podem ser comunicadas às autoridades.</li>
            </ul>
          ),
        },
        {
          id: "pagamento",
          titulo: "Pagamento",
          conteudo: (
            <p>
              Os valores são definidos por cada clínica. O pagamento é processado por provedor especializado, com o repasse feito diretamente à clínica;
              a plataforma não guarda dados de cartão. Cancelamentos e reembolsos seguem a política da clínica e o Código de Defesa do Consumidor.
            </p>
          ),
        },
        {
          id: "disponibilidade",
          titulo: "Disponibilidade e responsabilidade",
          conteudo: (
            <p>
              Trabalhamos para manter a plataforma disponível e segura, mas falhas de conexão podem acontecer. A plataforma não substitui serviços de
              urgência e emergência. A responsabilidade pelo ato médico é do profissional e da clínica.
            </p>
          ),
        },
        {
          id: "contato",
          titulo: "Contato e foro",
          conteudo: (
            <p>
              Dúvidas sobre dados pessoais: {ENCARREGADO.nome}, {ENCARREGADO.email}. Estes termos seguem a lei brasileira. Quando estes termos mudarem,
              pediremos um novo aceite.
            </p>
          ),
        },
      ]}
    />
  );
}
