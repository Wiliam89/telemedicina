"use client";

import { CreditCard, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CartaoResumo, MeiosDePagamento } from "@tele/shared";
import { AUTORIZACAO_DE_COBRANCA, bandeiraPeloNumero, numeroDeCartaoValido } from "@tele/shared/cobranca";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo, CLASSE_CONTROLE } from "@/componentes/Campo";
import { acaoNaApi } from "@/lib/navegador";

/** O pedaco do MercadoPago.js que usamos (campos seguros + token). */
interface CampoSeguro {
  mount(id: string): CampoSeguro;
  unmount(): void;
}
interface MercadoPagoSdk {
  fields: {
    create(tipo: "cardNumber" | "expirationDate" | "securityCode", opcoes?: { placeholder?: string }): CampoSeguro;
    createCardToken(dados: { cardholderName: string; identificationType?: string; identificationNumber?: string }): Promise<{ id: string }>;
  };
}
declare global {
  interface Window {
    MercadoPago?: new (chavePublica: string, opcoes?: { locale?: string }) => MercadoPagoSdk;
  }
}

const NOME_DA_BANDEIRA: Record<string, string> = { visa: "Visa", master: "Mastercard", mastercard: "Mastercard", amex: "American Express", elo: "Elo", hipercard: "Hipercard" };
const bandeira = (b: string) => NOME_DA_BANDEIRA[b] ?? "Cartão";
const validade = (c: CartaoResumo) => `${String(c.validadeMes).padStart(2, "0")}/${String(c.validadeAno).slice(-2)}`;

/**
 * CADASTRO DO CARTAO (ADR-0023). Opcional: quem cadastra e debitado ao final
 * de cada consulta; quem nao cadastra paga por Pix antes.
 *
 * O NUMERO DO CARTAO NUNCA CHEGA A PLATAFORMA. Ele vai do navegador direto
 * para o provedor de pagamento, que devolve um token; so o token e enviado a
 * nossa API. Com o provedor real, os campos sao iframes do proprio provedor:
 * nem o JavaScript desta pagina enxerga o que foi digitado.
 */
export function CartaoCadastrado({ slug, inicial, cpf }: { slug: string; inicial: MeiosDePagamento; cpf: string | null }) {
  const router = useRouter();
  const [cartao, setCartao] = useState(inicial.cartao);
  const [trocando, setTrocando] = useState(!inicial.cartao);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [autorizo, setAutorizo] = useState(false);
  const [nome, setNome] = useState("");
  // So no modo simulado: estes campos ficam no navegador e viram um token local.
  const [numero, setNumero] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [codigo, setCodigo] = useState("");
  const sdk = useRef<MercadoPagoSdk | null>(null);
  const [sdkPronto, setSdkPronto] = useState(false);

  const { provedor, chavePublica, disponivel } = inicial.tokenizacao;
  const simulado = provedor === "local_teste";

  // Provedor real: carrega o SDK e monta os campos seguros dele.
  useEffect(() => {
    if (!trocando || simulado || !disponivel || !chavePublica) return;
    let campos: CampoSeguro[] = [];
    let cancelado = false;
    const montar = () => {
      if (cancelado || !window.MercadoPago) return;
      try {
        const mp = new window.MercadoPago(chavePublica, { locale: "pt-BR" });
        sdk.current = mp;
        campos = [
          mp.fields.create("cardNumber", { placeholder: "0000 0000 0000 0000" }).mount("campo-numero"),
          mp.fields.create("expirationDate", { placeholder: "MM/AA" }).mount("campo-validade"),
          mp.fields.create("securityCode", { placeholder: "CVV" }).mount("campo-codigo"),
        ];
        setSdkPronto(true);
      } catch {
        setErro("Não foi possível carregar o formulário seguro do cartão. Recarregue a página.");
      }
    };
    if (window.MercadoPago) montar();
    else {
      const s = document.createElement("script");
      s.src = "https://sdk.mercadopago.com/js/v2";
      s.async = true;
      s.onload = montar;
      s.onerror = () => setErro("Não foi possível carregar o formulário seguro do cartão. Verifique sua conexão e recarregue a página.");
      document.head.appendChild(s);
    }
    return () => {
      cancelado = true;
      for (const c of campos) c.unmount();
      sdk.current = null;
      setSdkPronto(false);
    };
  }, [trocando, simulado, disponivel, chavePublica]);

  /** Transforma o cartao em token SEM sair do navegador (simulado) ou direto no provedor (real). */
  async function obterToken(): Promise<string | null> {
    if (nome.trim().length < 3) {
      setErro("Informe o nome como está no cartão.");
      return null;
    }
    if (simulado) {
      const m = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(vencimento.trim());
      if (!numeroDeCartaoValido(numero)) {
        setErro("Número de cartão inválido. Confira os dígitos.");
        return null;
      }
      if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) {
        setErro("Validade no formato MM/AA.");
        return null;
      }
      if (!/^\d{3,4}$/.test(codigo)) {
        setErro("Código de segurança com 3 ou 4 dígitos.");
        return null;
      }
      const ano = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
      const b = bandeiraPeloNumero(numero).replace(/[^a-z]/g, "") || "cartao";
      return `tok_teste_${numero.replace(/\D/g, "").slice(-4)}_${Number(m[1])}_${ano}_${b}`;
    }
    if (!sdk.current) {
      setErro("O formulário do cartão ainda está carregando. Tente de novo em instantes.");
      return null;
    }
    try {
      const t = await sdk.current.fields.createCardToken({ cardholderName: nome.trim(), ...(cpf ? { identificationType: "CPF", identificationNumber: cpf } : {}) });
      return t.id;
    } catch {
      setErro("Não foi possível validar o cartão. Confira o número, a validade e o código de segurança.");
      return null;
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(null);
    if (!autorizo) {
      setErro("Para cadastrar o cartão, é preciso autorizar a cobrança ao final da consulta.");
      return;
    }
    setOcupado(true);
    const tokenDoCartao = await obterToken();
    if (!tokenDoCartao) {
      setOcupado(false);
      return;
    }
    const r = await acaoNaApi<CartaoResumo>("/cartoes", { metodo: "POST", clinica: slug, corpo: { tokenDoCartao, autorizo: true } });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro.mensagem);
      return;
    }
    setCartao(r.dados);
    setTrocando(false);
    setNumero("");
    setVencimento("");
    setCodigo("");
    setAutorizo(false);
    setOk("Cartão cadastrado. A partir de agora suas consultas são debitadas ao final do atendimento.");
    router.refresh();
  }

  async function remover() {
    if (!cartao) return;
    setErro(null);
    setOk(null);
    setOcupado(true);
    const r = await acaoNaApi(`/cartoes/${cartao.id}/remover`, { metodo: "POST", clinica: slug });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro.mensagem);
      return;
    }
    setCartao(null);
    setTrocando(true);
    setOk("Cartão removido. Suas próximas consultas serão pagas por Pix, antes de começar.");
    router.refresh();
  }

  return (
    <div className="max-w-xl space-y-6">
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {cartao ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-linha bg-superficie p-5 shadow-cartao">
          <div className="flex items-center gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-selo-suave text-selo ring-1 ring-inset ring-selo/20">
              <CreditCard className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">
                {bandeira(cartao.bandeira)} final {cartao.ultimos4}
              </p>
              <p className={"text-sm " + (cartao.vencido ? "text-alerta" : "text-tinta-suave")}>{cartao.vencido ? `Vencido em ${validade(cartao)}` : `Válido até ${validade(cartao)}`}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {!trocando ? (
              <button type="button" onClick={() => setTrocando(true)} className="text-selo underline underline-offset-4">
                Trocar
              </button>
            ) : null}
            <button type="button" onClick={remover} disabled={ocupado} className="text-alerta underline-offset-4 hover:underline disabled:opacity-50">
              Remover
            </button>
          </div>
        </div>
      ) : null}

      {!disponivel ? (
        <Aviso>O cadastro de cartão ainda não está disponível. Enquanto isso, o pagamento é por Pix, antes de cada consulta.</Aviso>
      ) : trocando ? (
        <form onSubmit={salvar} className="space-y-5 rounded-xl border border-linha bg-superficie p-5 shadow-cartao" noValidate>
          <h2 className="text-base text-tinta">{cartao ? "Novo cartão" : "Cadastrar cartão de crédito"}</h2>

          {simulado ? (
            <Aviso tipo="espera">
              <strong>Ambiente de teste:</strong> nenhum cartão é cobrado de verdade. Use <span className="font-mono">4242 4242 4242 4242</span>, qualquer validade futura e qualquer código. O número <span className="font-mono">4000 0000 0000 0002</span> simula um cartão que é recusado no fim da consulta.
            </Aviso>
          ) : null}

          <Campo id="nome-no-cartao" rotulo="Nome como está no cartão" autoComplete="cc-name" required value={nome} onChange={(e) => setNome(e.target.value)} />

          {simulado ? (
            <>
              <Campo id="numero-do-cartao" rotulo="Número do cartão" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required value={numero} onChange={(e) => setNumero(e.target.value.replace(/[^\d ]/g, "").slice(0, 23))} />
              <div className="grid grid-cols-2 gap-4">
                <Campo id="validade-do-cartao" rotulo="Validade" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" required value={vencimento} onChange={(e) => setVencimento(e.target.value.replace(/[^\d/]/g, "").slice(0, 7))} />
                <Campo id="codigo-do-cartao" rotulo="Código de segurança" inputMode="numeric" autoComplete="cc-csc" placeholder="CVV" required value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              </div>
            </>
          ) : (
            <>
              {/* Campos do PROVEDOR (iframes): o que e digitado aqui nao passa por esta pagina. */}
              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-tinta">Número do cartão</span>
                <div id="campo-numero" className={`${CLASSE_CONTROLE} h-11 border-linha`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <span className="block text-sm font-medium text-tinta">Validade</span>
                  <div id="campo-validade" className={`${CLASSE_CONTROLE} h-11 border-linha`} />
                </div>
                <div className="space-y-1.5">
                  <span className="block text-sm font-medium text-tinta">Código de segurança</span>
                  <div id="campo-codigo" className={`${CLASSE_CONTROLE} h-11 border-linha`} />
                </div>
              </div>
              {!sdkPronto && !erro ? <p className="text-sm text-tinta-suave">Carregando o formulário seguro...</p> : null}
            </>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-linha bg-superficie-alt px-4 py-3">
            <input type="checkbox" checked={autorizo} onChange={(e) => setAutorizo(e.target.checked)} className="mt-1" />
            <span className="text-sm leading-relaxed">{AUTORIZACAO_DE_COBRANCA}</span>
          </label>

          {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Botao type="submit" carregando={ocupado} disabled={!simulado && !sdkPronto}>
              Salvar cartão
            </Botao>
            {cartao ? (
              <Botao type="button" variante="fantasma" onClick={() => setTrocando(false)}>
                Cancelar
              </Botao>
            ) : null}
          </div>
          <p className="flex items-start gap-2 text-xs text-tinta-suave">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            O número do cartão vai direto para o serviço de pagamento e não é guardado pela plataforma. Guardamos só a bandeira e os quatro últimos dígitos, para você reconhecer o cartão.
          </p>
        </form>
      ) : erro ? (
        <Aviso tipo="erro">{erro}</Aviso>
      ) : null}
    </div>
  );
}
