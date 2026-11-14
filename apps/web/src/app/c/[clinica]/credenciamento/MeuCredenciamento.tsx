"use client";

import { Camera, CheckCircle2, FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { DocumentoDoMedicoResumo, MeuCredenciamento as Pedido, TipoDeDocumentoDoMedico } from "@tele/shared";
import { ESPECIALIDADES, nomeDaEspecialidade } from "@tele/shared/atendimento";
import {
  AJUDA_DO_DOCUMENTO_DO_MEDICO,
  DOCUMENTOS_OBRIGATORIOS,
  DOCUMENTOS_SO_IMAGEM,
  NOME_DO_DOCUMENTO_DO_MEDICO,
  NOME_DO_STATUS_DA_IDENTIDADE,
  NOME_DO_STATUS_DO_CREDENCIAMENTO,
  TERMO_DE_BIOMETRIA,
  TIPOS_DE_DOCUMENTO_DO_MEDICO,
} from "@tele/shared/credenciamento";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo, CLASSE_CONTROLE } from "@/componentes/Campo";
import { Cartao, Etiqueta } from "@/componentes/ui";
import { acaoNaApi, enviarArquivo } from "@/lib/navegador";
import { soDigitos } from "@/lib/validacao";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const MAXIMO_DE_ESPECIALIDADES = 6;

type Dados = Pedido & { medico: { crm: string; crmUf: string; especialidade: string | null } | null };

/**
 * O PEDIDO DE CREDENCIAMENTO (ADR-0022), em quatro partes: o CRM, o que o
 * medico quer atender, os documentos e a conferencia de identidade. So
 * depois de a administracao aprovar ele passa a atender.
 */
export function MeuCredenciamento({ slug, inicial, temCpf }: { slug: string; inicial: Dados; temCpf: boolean }) {
  const router = useRouter();
  const [pedido, setPedido] = useState(inicial);
  const [crm, setCrm] = useState("");
  const [crmUf, setCrmUf] = useState("SP");
  const [pronto, setPronto] = useState(inicial.querProntoAtendimento);
  const [especialidades, setEspecialidades] = useState<string[]>(inicial.especialidadesSolicitadas);
  const [rqe, setRqe] = useState(inicial.rqe ?? "");
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const arquivos = useRef<Partial<Record<TipoDeDocumentoDoMedico, HTMLInputElement | null>>>({});

  const editavel = pedido.status === "rascunho" || pedido.status === "pendente_de_ajuste" || pedido.status === "recusado";
  const documentoDe = (tipo: TipoDeDocumentoDoMedico) => pedido.documentos.find((d) => d.tipo === tipo);

  async function recarregar() {
    const r = await acaoNaApi<Dados>("/credenciamento", { clinica: slug });
    if (r.ok) setPedido(r.dados);
    router.refresh();
  }

  /** Grava o rascunho. E tambem o que cria o cadastro de medico de quem entrou so como paciente. */
  async function salvarRascunho(): Promise<boolean> {
    if (!pedido.medico && !/^\d{4,7}$/.test(crm)) {
      setErro("Informe o CRM: de 4 a 7 dígitos, só números.");
      return false;
    }
    if (!pronto && especialidades.length === 0) {
      setErro("Escolha ao menos uma forma de atender: pronto atendimento ou uma especialidade.");
      return false;
    }
    const r = await acaoNaApi("/credenciamento", {
      metodo: "PUT",
      clinica: slug,
      corpo: { especialidadesSolicitadas: especialidades, querProntoAtendimento: pronto, rqe: rqe.trim() || undefined, ...(pedido.medico ? {} : { medico: { crm, crmUf } }) },
    });
    if (!r.ok) {
      setErro(r.erro.mensagem);
      return false;
    }
    return true;
  }

  async function salvar() {
    setErro(null);
    setOk(null);
    setOcupado("salvar");
    if (await salvarRascunho()) {
      setOk("Dados salvos. Agora envie os documentos.");
      await recarregar();
    }
    setOcupado(null);
  }

  async function enviarDocumento(tipo: TipoDeDocumentoDoMedico, arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    setOk(null);
    if (arquivo.size > 15 * 1024 * 1024) {
      setErro("O arquivo passa de 15 MB. Envie uma versão menor.");
      return;
    }
    setOcupado(tipo);
    // O cadastro de medico precisa existir antes do primeiro documento.
    if (!pedido.medico && !(await salvarRascunho())) {
      setOcupado(null);
      return;
    }
    const dados = new FormData();
    // O campo vai ANTES do arquivo: e assim que a API o le.
    dados.append("tipo", tipo);
    dados.append("arquivo", arquivo);
    const r = await enviarArquivo<DocumentoDoMedicoResumo>("/credenciamento/documentos", dados, slug);
    if (!r.ok) setErro(r.erro.mensagem);
    else await recarregar();
    const campo = arquivos.current[tipo];
    if (campo) campo.value = "";
    setOcupado(null);
  }

  async function enviarPedido() {
    setErro(null);
    setOk(null);
    if (!aceito) {
      setErro("Para enviar, é preciso concordar com a conferência de identidade.");
      return;
    }
    setOcupado("enviar");
    if (await salvarRascunho()) {
      const r = await acaoNaApi("/credenciamento/enviar", { metodo: "POST", clinica: slug, corpo: { aceitoBiometria: true } });
      if (!r.ok) {
        const faltas = (r.erro.detalhes as { pendencias?: string[] } | undefined)?.pendencias;
        setErro(faltas?.length ? `Ainda falta: ${faltas.join(" ")}` : r.erro.mensagem);
      } else {
        setOk("Pedido enviado. A administração vai conferir seus documentos e você recebe um aviso com a resposta.");
        await recarregar();
      }
    }
    setOcupado(null);
  }

  const alternar = (codigo: string) =>
    setEspecialidades((atual) => (atual.includes(codigo) ? atual.filter((c) => c !== codigo) : atual.length >= MAXIMO_DE_ESPECIALIDADES ? atual : [...atual, codigo]));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Etiqueta tom={pedido.status === "aprovado" ? "selo" : pedido.status === "em_analise" ? "espera" : pedido.status === "rascunho" ? "neutro" : "alerta"}>
          {NOME_DO_STATUS_DO_CREDENCIAMENTO[pedido.status]}
        </Etiqueta>
        {pedido.enviadoEm ? <span className="text-sm text-tinta-suave">Enviado em {new Date(pedido.enviadoEm).toLocaleDateString("pt-BR")}</span> : null}
      </div>

      {pedido.status === "aprovado" ? (
        <Aviso tipo="ok">Seu credenciamento foi aprovado. Monte seus horários em “Meus horários” e fique online em “Atendimento imediato” para começar a atender.</Aviso>
      ) : pedido.status === "em_analise" ? (
        <Aviso tipo="espera">
          Seu pedido está em análise. Enquanto isso não é possível alterá-lo.
          {pedido.identidade ? ` Conferência de identidade: ${NOME_DO_STATUS_DA_IDENTIDADE[pedido.identidade.status].toLowerCase()}.` : ""}
        </Aviso>
      ) : pedido.motivo ? (
        <Aviso tipo="erro">
          <strong>{pedido.status === "recusado" ? "Pedido não aprovado." : "A administração pediu um ajuste."}</strong> {pedido.motivo} Corrija o que for preciso e envie de novo.
        </Aviso>
      ) : null}

      {pedido.urlDaProvaDeVida ? (
        <Aviso>
          Falta a prova de vida no serviço de verificação de identidade.{" "}
          <a href={pedido.urlDaProvaDeVida} target="_blank" rel="noopener noreferrer" className="font-medium text-selo underline underline-offset-4">
            Fazer agora
          </a>
        </Aviso>
      ) : null}

      {!temCpf ? (
        <Aviso tipo="espera">
          Seu CPF ainda não está no cadastro, e ele é necessário para conferir a identidade e assinar documentos.{" "}
          <a href="/conta" className="font-medium underline underline-offset-4">Informar em Minha conta</a>
        </Aviso>
      ) : null}

      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <Cartao titulo="1. Registro profissional">
        {pedido.medico ? (
          <p className="text-sm">
            CRM <strong>{pedido.medico.crm}-{pedido.medico.crmUf}</strong>
            <span className="text-tinta-suave"> · conferido pela administração no Conselho Federal de Medicina.</span>
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <Campo id="crm" rotulo="CRM" inputMode="numeric" required value={crm} onChange={(e) => setCrm(soDigitos(e.target.value).slice(0, 7))} ajuda="Só os números." />
            <div className="space-y-1.5">
              <label htmlFor="crmUf" className="block text-sm font-medium">UF do CRM</label>
              <select id="crmUf" value={crmUf} onChange={(e) => setCrmUf(e.target.value)} className={`${CLASSE_CONTROLE} border-linha`}>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Cartao>

      <Cartao titulo="2. O que você quer atender" descricao="A administração libera o que for comprovado pelos documentos.">
        <fieldset disabled={!editavel} className="space-y-5">
          <label className="flex items-start gap-3 rounded-lg border border-linha bg-superficie-alt px-4 py-3">
            <input type="checkbox" checked={pronto} onChange={(e) => setPronto(e.target.checked)} className="mt-1" />
            <span>
              <span className="block font-medium">Pronto atendimento (clínico geral)</span>
              <span className="block text-sm text-tinta-suave">Queixas do dia a dia, sem especialidade. Você recebe os pedidos quando estiver online.</span>
            </span>
          </label>

          <div className="space-y-2">
            <p className="text-sm font-medium">Teleconsulta especializada <span className="font-normal text-tinta-suave">(até {MAXIMO_DE_ESPECIALIDADES}; exige título de especialista)</span></p>
            {especialidades.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {especialidades.map((c) => (
                  <li key={c}>
                    <button type="button" onClick={() => alternar(c)} className="rounded-full bg-selo-suave px-3 py-1 text-sm text-selo-forte ring-1 ring-inset ring-selo/25 hover:bg-selo/15" aria-label={`Remover ${nomeDaEspecialidade(c)}`}>
                      {nomeDaEspecialidade(c)} ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <label htmlFor="nova-especialidade" className="sr-only">Adicionar especialidade</label>
            <select
              id="nova-especialidade"
              value=""
              onChange={(e) => e.target.value && alternar(e.target.value)}
              disabled={especialidades.length >= MAXIMO_DE_ESPECIALIDADES}
              className={`${CLASSE_CONTROLE} max-w-md border-linha`}
            >
              <option value="">Adicionar especialidade...</option>
              {ESPECIALIDADES.filter((e) => !especialidades.includes(e.codigo)).map((e) => (
                <option key={e.codigo} value={e.codigo}>{e.nome}</option>
              ))}
            </select>
          </div>

          {especialidades.length > 0 ? (
            <div className="max-w-md">
              <Campo id="rqe" rotulo="RQE (registro de qualificação de especialista)" value={rqe} onChange={(e) => setRqe(e.target.value.slice(0, 60))} ajuda="Se tiver mais de um, separe por vírgula." />
            </div>
          ) : null}

          {editavel ? (
            <Botao type="button" variante="secundario" onClick={salvar} carregando={ocupado === "salvar"} disabled={ocupado !== null}>
              Salvar
            </Botao>
          ) : null}
        </fieldset>
      </Cartao>

      <Cartao titulo="3. Documentos" descricao="PDF, JPG, PNG ou WEBP, até 15 MB cada. Só a administração da plataforma tem acesso." semPadding>
        <ul className="divide-y divide-linha">
          {TIPOS_DE_DOCUMENTO_DO_MEDICO.filter((t) => t !== "selfie").map((tipo) => {
            const enviado = documentoDe(tipo);
            const obrigatorio = DOCUMENTOS_OBRIGATORIOS.includes(tipo) || (tipo === "titulo_especialista" && especialidades.length > 0);
            return (
              <li key={tipo} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {NOME_DO_DOCUMENTO_DO_MEDICO[tipo]} {obrigatorio ? null : <span className="font-normal text-tinta-suave">(opcional)</span>}
                  </p>
                  <p className="text-xs text-tinta-suave">{AJUDA_DO_DOCUMENTO_DO_MEDICO[tipo]}</p>
                  {enviado ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-selo-forte">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Enviado em {new Date(enviado.criadoEm).toLocaleDateString("pt-BR")}
                    </p>
                  ) : null}
                </div>
                {editavel ? (
                  <>
                    <input
                      ref={(el) => {
                        arquivos.current[tipo] = el;
                      }}
                      type="file"
                      accept={DOCUMENTOS_SO_IMAGEM.includes(tipo) ? "image/jpeg,image/png,image/webp" : "application/pdf,image/jpeg,image/png,image/webp"}
                      className="sr-only"
                      id={`arquivo-${tipo}`}
                      onChange={(e) => enviarDocumento(tipo, e.target.files?.[0])}
                    />
                    <Botao type="button" variante="secundario" tamanho="p" icone={<FileUp className="h-4 w-4" aria-hidden="true" />} carregando={ocupado === tipo} disabled={ocupado !== null} onClick={() => arquivos.current[tipo]?.click()} aria-label={`${enviado ? "Trocar" : "Enviar"}: ${NOME_DO_DOCUMENTO_DO_MEDICO[tipo]}`}>
                      {enviado ? "Trocar" : "Enviar"}
                    </Botao>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Cartao>

      <Cartao titulo="4. Conferência de identidade" descricao="Garante que ninguém atenda usando o registro de outra pessoa.">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{NOME_DO_DOCUMENTO_DO_MEDICO.selfie}</p>
              <p className="text-xs text-tinta-suave">{AJUDA_DO_DOCUMENTO_DO_MEDICO.selfie}</p>
              {documentoDe("selfie") ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-selo-forte">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Enviada em {new Date(documentoDe("selfie")!.criadoEm).toLocaleDateString("pt-BR")}
                </p>
              ) : null}
            </div>
            {editavel ? (
              <>
                <input
                  ref={(el) => {
                    arquivos.current.selfie = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  // No celular abre direto a camera da frente.
                  capture="user"
                  className="sr-only"
                  id="arquivo-selfie"
                  onChange={(e) => enviarDocumento("selfie", e.target.files?.[0])}
                />
                <Botao type="button" variante="secundario" tamanho="p" icone={<Camera className="h-4 w-4" aria-hidden="true" />} carregando={ocupado === "selfie"} disabled={ocupado !== null} onClick={() => arquivos.current.selfie?.click()}>
                  {documentoDe("selfie") ? "Tirar outra foto" : "Tirar a foto"}
                </Botao>
              </>
            ) : null}
          </div>

          {pedido.identidade ? (
            <p className="text-sm text-tinta-suave">
              Situação: <strong className="text-tinta">{NOME_DO_STATUS_DA_IDENTIDADE[pedido.identidade.status]}</strong>
              {pedido.identidade.status === "reprovada" && pedido.identidade.observacao ? ` — ${pedido.identidade.observacao}` : ""}
            </p>
          ) : null}

          {editavel ? (
            <label className="flex items-start gap-3 rounded-lg border border-linha bg-superficie-alt px-4 py-3">
              <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} className="mt-1" />
              <span className="text-sm leading-relaxed">{TERMO_DE_BIOMETRIA}</span>
            </label>
          ) : null}
        </div>
      </Cartao>

      {editavel ? (
        <div className="space-y-3">
          {pedido.pendencias.length > 0 ? (
            <div className="rounded-lg border border-linha bg-superficie px-4 py-3 text-sm text-tinta-suave">
              <p className="font-medium text-tinta">Para enviar, ainda falta:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {pedido.pendencias.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Botao type="button" tamanho="g" onClick={enviarPedido} carregando={ocupado === "enviar"} disabled={ocupado !== null}>
            Enviar para análise
          </Botao>
        </div>
      ) : null}
    </div>
  );
}
