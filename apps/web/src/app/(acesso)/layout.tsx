import { FileCheck2, ShieldCheck, Video } from "lucide-react";
import type { ReactNode } from "react";
import { Marca } from "@/componentes/Marca";

/**
 * Tela dividida de entrar / criar conta, como nas plataformas de mercado:
 * a esquerda o formulario, a direita (em telas largas) o que a pessoa
 * ganha ao entrar. Em celular, so o formulario.
 */
export default function LayoutAcesso({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Marca />
        <main id="conteudo" className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        <p className="text-xs text-tinta-suave">Seus dados ficam no Brasil e cada acesso ao prontuário é registrado.</p>
      </div>

      <aside className="relative hidden overflow-hidden bg-marinho lg:block">
        <div className="malha absolute inset-0 opacity-90" />
        <div className="grade-pontilhada absolute inset-0 opacity-30" />
        <div className="relative flex h-full flex-col justify-center gap-10 p-14 text-white">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Telemedicina</p>
            <h2 className="max-w-md text-4xl leading-tight text-white">Atendimento de verdade, a distância.</h2>
            <p className="max-w-md text-white/70">Agenda, teleconsulta, prontuário e documentos assinados digitalmente, num só lugar.</p>
          </div>
          <ul className="space-y-5">
            {[
              { Icone: Video, t: "Teleconsulta segura", d: "Sala exclusiva por consulta, sem gravação." },
              { Icone: FileCheck2, t: "Documentos verificáveis", d: "Receitas e atestados com assinatura ICP-Brasil." },
              { Icone: ShieldCheck, t: "Conforme a LGPD", d: "Dados no Brasil, acesso registrado e isolado por clínica." },
            ].map(({ Icone, t, d }) => (
              <li key={t} className="flex items-start gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icone aria-hidden="true" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="block text-sm text-white/65">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
