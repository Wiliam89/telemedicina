"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ClinicaResumo } from "@tele/shared";
import { Aviso } from "@/componentes/Aviso";
import { Botao } from "@/componentes/Botao";
import { Campo } from "@/componentes/Campo";
import { chamarApi } from "@/lib/api";
import { criarClienteNavegador } from "@/lib/supabase-navegador";
import { cnpjValido, soDigitos, sugerirSlug } from "@/lib/validacao";

type Erros = Partial<Record<"nomeFantasia" | "razaoSocial" | "cnpj" | "slug", string>>;

export function FormularioClinica() {
  const router = useRouter();
  const [nomeFantasia, setNome] = useState("");
  const [razaoSocial, setRazao] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  function validar(): Erros {
    const e: Erros = {};
    if (nomeFantasia.trim().length < 3) e.nomeFantasia = "Informe o nome da clinica.";
    if (razaoSocial.trim().length < 3) e.razaoSocial = "Informe a razao social do CNPJ.";
    if (!cnpjValido(cnpj)) e.cnpj = "Este CNPJ nao e valido. Confira os digitos.";
    if (!/^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/.test(slug)) e.slug = "De 4 a 40 letras minusculas, numeros ou hifen.";
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

    const r = await chamarApi<ClinicaResumo>("/clinicas", {
      metodo: "POST",
      token,
      corpo: { nomeFantasia: nomeFantasia.trim(), razaoSocial: razaoSocial.trim(), cnpj: soDigitos(cnpj), slug },
    });

    if (r.ok) {
      router.push(`/c/${r.dados.slug}/inicio`);
      router.refresh();
      return;
    }
    if (r.status === 409 && r.erro.codigo === "ENDERECO_EM_USO") setErros({ slug: "Este endereco ja esta em uso. Escolha outro." });
    else if (r.status === 409) setErros({ cnpj: "Ja existe uma clinica com este CNPJ." });
    else if (r.status === 400 && Array.isArray(r.erro.detalhes)) {
      const doServidor: Erros = {};
      for (const d of r.erro.detalhes as { campo: string; problema: string }[]) doServidor[d.campo as keyof Erros] = d.problema;
      setErros(doServidor);
      setErroGeral("Confira os campos marcados.");
    } else setErroGeral(r.erro.mensagem);
    setCarregando(false);
  }

  return (
    <form onSubmit={enviar} className="space-y-5" noValidate>
      <Campo
        id="nomeFantasia"
        rotulo="Nome da clinica"
        required
        value={nomeFantasia}
        onChange={(e) => {
          setNome(e.target.value);
          if (!slugTocado) setSlug(sugerirSlug(e.target.value));
        }}
        erro={erros.nomeFantasia}
        ajuda="Como os pacientes conhecem a clinica."
      />
      <Campo id="razaoSocial" rotulo="Razao social" required value={razaoSocial} onChange={(e) => setRazao(e.target.value)} erro={erros.razaoSocial} ajuda="Como consta no CNPJ." />
      <Campo id="cnpj" rotulo="CNPJ" inputMode="numeric" required placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} erro={erros.cnpj} />
      <Campo
        id="slug"
        rotulo="Endereco da clinica no sistema"
        required
        value={slug}
        onChange={(e) => {
          setSlugTocado(true);
          setSlug(sugerirSlug(e.target.value));
        }}
        erro={erros.slug}
        ajuda={<>A equipe acessara por <span className="font-mono">/c/{slug || "sua-clinica"}</span>. Escolha com calma: mudar depois quebra os links salvos.</>}
      />
      {erroGeral ? <Aviso tipo="erro">{erroGeral}</Aviso> : null}
      <Botao type="submit" carregando={carregando} className="w-full">
        Criar clinica
      </Botao>
    </form>
  );
}
