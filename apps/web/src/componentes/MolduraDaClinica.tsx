"use client";

import {
  Activity,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  ChevronsUpDown,
  Clock3,
  FileText,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  Menu,
  ShieldAlert,
  Siren,
  Tags,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { ClinicaResumo, PapelVinculo } from "@tele/shared";
import { NOME_DA_SITUACAO_CRM } from "@tele/shared/crm";
import { NOME_DO_PAPEL } from "@/lib/papeis";
import { BotaoSair } from "./BotaoSair";
import { SinoDeNotificacoes } from "./SinoDeNotificacoes";
import { Simbolo } from "./Marca";
import { Avatar } from "./ui";

interface Item {
  rotulo: string;
  caminho: string;
  Icone: LucideIcon;
  papeis: PapelVinculo[] | "todos";
}

const EQUIPE: PapelVinculo[] = ["medico", "recepcao", "admin_clinica"];

/**
 * O menu, em grupos. Cada item diz quem o ve - o mesmo criterio que a API
 * aplica nas rotas (o menu nao e a seguranca, so evita mostrar porta que
 * nao abre para aquele papel).
 */
const GRUPOS: { titulo: string; itens: Item[] }[] = [
  {
    titulo: "Atendimento",
    itens: [
      { rotulo: "Painel", caminho: "inicio", Icone: LayoutDashboard, papeis: "todos" },
      { rotulo: "Agenda", caminho: "agenda", Icone: CalendarDays, papeis: "todos" },
      { rotulo: "Marcar consulta", caminho: "marcar", Icone: CalendarPlus, papeis: ["paciente", "recepcao"] },
      { rotulo: "Pronto atendimento", caminho: "pronto-atendimento", Icone: Siren, papeis: ["paciente"] },
      { rotulo: "Plantão e fila", caminho: "plantao", Icone: Siren, papeis: EQUIPE },
      { rotulo: "Pacientes", caminho: "pacientes", Icone: Users, papeis: EQUIPE },
      { rotulo: "Minha saúde", caminho: "minha-saude", Icone: HeartPulse, papeis: ["paciente"] },
      { rotulo: "Documentos", caminho: "documentos", Icone: FileText, papeis: "todos" },
    ],
  },
  {
    titulo: "Configuração",
    itens: [
      { rotulo: "Meus horários", caminho: "grade", Icone: Clock3, papeis: ["medico"] },
      { rotulo: "Equipe", caminho: "equipe", Icone: Users, papeis: ["admin_clinica"] },
      { rotulo: "Valores", caminho: "precos", Icone: Tags, papeis: ["admin_clinica"] },
      { rotulo: "Indicadores", caminho: "indicadores", Icone: BarChart3, papeis: ["admin_clinica"] },
      { rotulo: "Pedidos LGPD", caminho: "privacidade", Icone: Inbox, papeis: ["admin_clinica"] },
      { rotulo: "Status do sistema", caminho: "diagnostico", Icone: Activity, papeis: EQUIPE },
    ],
  },
];

function Menu_({ clinica, aoNavegar }: { clinica: ClinicaResumo; aoNavegar?: () => void }) {
  const caminhoAtual = usePathname();
  return (
    <nav aria-label="Menu da clínica" className="space-y-6">
      {GRUPOS.map((g) => {
        const meus = clinica.papeis ?? [clinica.papel];
        const itens = g.itens.filter((i) => i.papeis === "todos" || i.papeis.some((p) => meus.includes(p)));
        if (itens.length === 0) return null;
        return (
          <div key={g.titulo} className="space-y-1">
            <p className="px-3 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-white/40">{g.titulo}</p>
            {itens.map(({ rotulo, caminho, Icone }) => {
              const href = `/c/${clinica.slug}/${caminho}`;
              const ativo = caminhoAtual === href || caminhoAtual.startsWith(`${href}/`);
              return (
                <Link
                  key={caminho}
                  href={href}
                  onClick={aoNavegar}
                  aria-current={ativo ? "page" : undefined}
                  className={
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors " +
                    (ativo ? "bg-white/12 font-medium text-white" : "text-white/70 hover:bg-white/6 hover:text-white")
                  }
                >
                  <Icone aria-hidden="true" className={"h-[1.1rem] w-[1.1rem] " + (ativo ? "text-[#5fd6cf]" : "text-white/50 group-hover:text-white/80")} />
                  {rotulo}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function Lateral({
  clinica,
  outras,
  nome,
  aoNavegar,
  comSino,
}: {
  clinica: ClinicaResumo;
  outras: ClinicaResumo[];
  nome: string;
  aoNavegar?: () => void;
  comSino?: boolean;
}) {
  return (
    <div className="flex h-full flex-col bg-marinho text-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Simbolo />
        <div className="min-w-0 flex-1">
          <p className="truncate font-titulo text-[0.95rem] font-semibold leading-tight">{clinica.nomeFantasia}</p>
          <p className="text-xs text-white/55">{NOME_DO_PAPEL[clinica.papel]}</p>
        </div>
        {comSino ? <SinoDeNotificacoes claro /> : null}
      </div>

      {outras.length > 1 ? (
        <Link
          href="/clinicas"
          onClick={aoNavegar}
          className="mx-3 mb-2 flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/6 hover:text-white"
        >
          Trocar de clínica
          <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <Menu_ clinica={clinica} aoNavegar={aoNavegar} />
      </div>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar nome={nome} tamanho="p" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{nome}</p>
            <div className="flex items-center gap-3 text-xs [&_button]:text-xs [&_button]:text-white/55 [&_button:hover]:text-white">
              <Link href="/conta" onClick={aoNavegar} className="text-white/55 hover:text-white">
                Minha conta
              </Link>
              <BotaoSair />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A moldura de toda tela de dentro de uma clinica: menu lateral fixo em
 * telas largas, gaveta em celular. Diz o tempo todo EM QUAL CLINICA voce
 * esta e COM QUAL PAPEL - num sistema onde a mesma pessoa atende em varios
 * lugares, esquecer isso e a origem do erro mais caro: registrar no lugar
 * errado.
 */
export function MolduraDaClinica({
  clinica,
  outras,
  nome,
  children,
}: {
  clinica: ClinicaResumo;
  outras: ClinicaResumo[];
  nome: string;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const caminhoAtual = usePathname();

  // Fecha a gaveta ao trocar de pagina e com Esc.
  useEffect(() => setAberto(false), [caminhoAtual]);
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16.5rem_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <Lateral clinica={clinica} outras={outras} nome={nome} comSino />
      </aside>

      {aberto ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-marinho/50 backdrop-blur-sm" aria-label="Fechar menu" onClick={() => setAberto(false)} />
          <div className="relative h-full w-72 max-w-[85vw] shadow-flutuante">
            <Lateral clinica={clinica} outras={outras} nome={nome} aoNavegar={() => setAberto(false)} />
            <button
              onClick={() => setAberto(false)}
              className="absolute right-3 top-5 rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-linha bg-superficie/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setAberto(true)} className="rounded-lg p-2 text-tinta hover:bg-marinho-suave" aria-label="Abrir menu">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <Simbolo className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{clinica.nomeFantasia}</p>
            <p className="text-xs text-tinta-suave">{NOME_DO_PAPEL[clinica.papel]}</p>
          </div>
          <SinoDeNotificacoes />
        </header>
        <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          {clinica.situacaoCrm && clinica.situacaoCrm !== "verificado" ? (
            <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-espera/30 bg-espera-suave px-4 py-3 text-sm text-espera">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{NOME_DA_SITUACAO_CRM[clinica.situacaoCrm]}</p>
                <p>
                  {clinica.situacaoCrm === "recusado"
                    ? "A administração da clínica recusou o CRM informado. Confira seu cadastro e fale com ela."
                    : "Até a administração da clínica conferir seu CRM no Conselho, você não emite documentos, não abre plantão e não recebe novas marcações."}
                </p>
              </div>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
