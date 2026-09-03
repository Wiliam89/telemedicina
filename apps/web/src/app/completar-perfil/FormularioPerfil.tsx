"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { PerfilResposta } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import { cpfValido, dataNascimentoValida, soDigitos } from "@/lib/validacao";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

type Erros = Partial<Record<"nomeCompleto" | "telefone" | "crm" | "crmUf" | "dataNascimento" | "cpf", string>>;

/**
 * O formulario de POST /perfis. Valida no navegador (feedback na hora) e
 * manda para a API, que valida de novo e grava com auditoria.
 * O token vai no cabecalho Authorization - e o crachá do Modulo 4.
 */
export function FormularioPerfil({ destino }: { destino: string }) {
  const router = useRouter();
  const [souMedico, setSouMedico] = useState(false);
  const [nomeCompleto, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [crm, setCrm] = useState("");
  const [crmUf, setCrmUf] = useState("SP");
  const [especialidade, setEspecialidade] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [cpf, setCpf] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  function validar(): Erros {
    const e: Erros = {};
    if (nomeCompleto.trim().length < 3) e.nomeCompleto = "Escreva o nome completo.";
    if (telefone && !/^\d{10,11}$/.test(soDigitos(telefone))) e.telefone = "Telefone com DDD: 10 ou 11 digitos.";
    if (souMedico) {
      if (!/^\d{4,7}$/.test(crm)) e.crm = "CRM tem de 4 a 7 digitos.";
      if (!UFS.includes(crmUf)) e.crmUf = "Escolha o estado do CRM.";
    }
    if (!dataNascimentoValida(dataNascimento)) e.dataNascimento = "Informe uma data de nascimento valida.";
    if (cpf && !cpfValido(cpf)) e.cpf = "Este CPF nao e valido. Confira os digitos.";
    return e;
  }

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setErroGeral(null);
    const e = validar();
    setErros(e);
    if (Object.keys(e).length > 0) return;

    setCarregando(true);
    const { data } = await criarClienteNavegador().auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setErroGeral("Sua sessao expirou. Entre de novo.");
      setCarregando(false);
      return;
    }

    const corpo = {
      nomeCompleto: nomeCompleto.trim(),
      telefone: telefone ? soDigitos(telefone) : undefined,
      cpf: cpf ? soDigitos(cpf) : undefined,
      paciente: { dataNascimento },
      ...(souMedico ? { medico: { crm, crmUf, especialidade: especialidade.trim() || undefined } } : {}),
    };

    const r = await chamarApi<PerfilResposta>("/perfis", { metodo: "POST", token, corpo });

    if (r.ok) {
      router.push(destino);
      router.refresh();
      return;
    }
    if (r.status === 409) setErroGeral("Esta conta ja tem perfil, ou o CRM/CPF ja esta cadastrado em outra conta.");
    else if (r.status === 400 && Array.isArray(r.erro.detalhes)) {
      // A API devolve [{campo, problema}]; mostramos cada um no campo certo.
      const doServidor: Erros = {};
      for (const d of r.erro.detalhes as { campo: string; problema: string }[]) {
        const chave = d.campo.split(".").pop() as keyof Erros;
        doServidor[chave] = d.problema;
      }
      setErros(doServidor);
      setErroGeral("Confira os campos marcados.");
    } else setErroGeral(r.erro.mensagem);
    setCarregando(false);
  }

  return (
    <form onSubmit={enviar} className="space-y-6" noValidate>

      <Campo id="nomeCompleto" rotulo="Nome completo" autoComplete="name" required value={nomeCompleto} onChange={(e) => setNome(e.target.value)} erro={erros.nomeCompleto} ajuda="Como aparece em documentos. Vai para atestados e prescricoes." />
      <Campo id="telefone" rotulo="Telefone (opcional)" type="tel" inputMode="numeric" autoComplete="tel" placeholder="11 99999-0000" value={telefone} onChange={(e) => setTelefone(e.target.value)} erro={erros.telefone} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id="dataNascimento" rotulo="Data de nascimento" type="date" required value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} erro={erros.dataNascimento} />
        <Campo id="cpf" rotulo="CPF (opcional por enquanto)" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} erro={erros.cpf} ajuda="Sera pedido antes da primeira prescricao." />
      </div>

      <label className="flex items-start gap-3 rounded-md border border-linha bg-superficie px-4 py-3">
        <input type="checkbox" checked={souMedico} onChange={(e) => setSouMedico(e.target.checked)} className="mt-1" />
        <span>
          <span className="block font-medium">Sou medico(a) e vou atender</span>
          <span className="block text-sm text-tinta-suave">Seu CRM fica no seu cadastro e vale em qualquer clinica onde voce atuar.</span>
        </span>
      </label>

      {souMedico ? (
        <div className="grid gap-5 sm:grid-cols-[1fr_7rem]">
          <Campo id="crm" rotulo="CRM" inputMode="numeric" required value={crm} onChange={(e) => setCrm(soDigitos(e.target.value))} erro={erros.crm} ajuda="So os numeros." />
          <div className="space-y-1.5">
            <label htmlFor="crmUf" className="block text-sm font-medium">UF do CRM</label>
            <select id="crmUf" value={crmUf} onChange={(e) => setCrmUf(e.target.value)} className="w-full rounded-md border border-linha bg-superficie px-3 py-2 text-base">
              {UFS.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
            {erros.crmUf ? <p role="alert" className="text-sm text-alerta">{erros.crmUf}</p> : null}
          </div>
          <div className="sm:col-span-2">
            <Campo id="especialidade" rotulo="Especialidade (opcional)" value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} placeholder="Clinica geral" />
          </div>
        </div>
      ) : null}

      {erroGeral ? <Aviso tipo="erro">{erroGeral}</Aviso> : null}
      <Botao type="submit" carregando={carregando} className="w-full">
        Salvar e continuar
      </Botao>
    </form>
  );
}
