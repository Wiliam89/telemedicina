"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/componentes/Botao";
import { criarClienteNavegador } from "@/lib/supabase-navegador";

const LIMITE_MS = 30 * 60 * 1000;
const AVISO_MS = 2 * 60 * 1000;
const CHAVE = "telesaude:ultima-atividade";

/** Avisa quem tem texto aberto: o atendimento salva o rascunho antes de a sessao fechar. */
export const EVENTO_ANTES_DE_ENCERRAR = "telesaude:antes-de-encerrar-sessao";

/**
 * Computador esquecido aberto na clinica nao pode continuar mostrando prontuario.
 * Vale para quem trabalha na clinica, com aviso antes e o que estiver sendo
 * digitado protegido:
 *   - digitar, clicar ou rolar conta como atividade, em qualquer aba;
 *   - durante a videochamada nunca encerra: a pessoa pode so estar conversando;
 *   - antes de sair, o atendimento salva o rascunho aberto.
 */
export function EncerrarPorInatividade() {
  const router = useRouter();
  const [restante, setRestante] = useState<number | null>(null);
  const ultima = useRef(Date.now());

  useEffect(() => {
    function ler(): number {
      try {
        return Math.max(ultima.current, Number(localStorage.getItem(CHAVE)) || 0);
      } catch {
        return ultima.current;
      }
    }
    function marcar() {
      const agora = Date.now();
      // Evita gravar a cada tecla: uma vez a cada 5 s ja basta.
      if (agora - ultima.current < 5000) return;
      ultima.current = agora;
      try {
        localStorage.setItem(CHAVE, String(agora));
      } catch {
        /* navegacao privada: cada aba conta sozinha */
      }
    }

    const eventos = ["keydown", "pointerdown", "scroll", "touchstart"] as const;
    for (const e of eventos) window.addEventListener(e, marcar, { passive: true });

    const relogio = setInterval(async () => {
      if (document.querySelector("[data-em-chamada='sim']")) {
        // Grava para as outras abas, que nao sabem da chamada, nao encerrarem a sessao.
        ultima.current = 0;
        marcar();
        setRestante(null);
        return;
      }
      const falta = LIMITE_MS - (Date.now() - ler());
      if (falta > AVISO_MS) {
        setRestante(null);
        return;
      }
      if (falta > 0) {
        setRestante(Math.ceil(falta / 1000));
        return;
      }
      clearInterval(relogio);
      window.dispatchEvent(new Event(EVENTO_ANTES_DE_ENCERRAR));
      await new Promise((r) => setTimeout(r, 1500));
      // So neste aparelho: o celular da pessoa pode estar em atendimento.
      await criarClienteNavegador().auth.signOut({ scope: "local" });
      router.push("/entrar");
      router.refresh();
    }, 1000);

    return () => {
      clearInterval(relogio);
      for (const e of eventos) window.removeEventListener(e, marcar);
    };
  }, [router]);

  if (restante === null) return null;

  return (
    <div role="alertdialog" aria-labelledby="aviso-inatividade" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-linha bg-superficie p-5 shadow-flutuante">
      <p id="aviso-inatividade" className="font-medium">Sua sessão vai encerrar por inatividade</p>
      <p className="mt-1 text-sm text-tinta-suave">
        Por segurança, encerramos em {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, "0")}. O rascunho aberto será salvo.
      </p>
      <Botao
        className="mt-3"
        onClick={() => {
          ultima.current = Date.now();
          try {
            localStorage.setItem(CHAVE, String(ultima.current));
          } catch {
            /* navegacao privada */
          }
          setRestante(null);
        }}
      >
        Continuar conectado
      </Botao>
    </div>
  );
}
