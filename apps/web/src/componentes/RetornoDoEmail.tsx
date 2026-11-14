"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * O Supabase as vezes devolve o erro do link de e-mail depois do "#"
 * (ex.: /#error=access_denied&error_code=otp_expired). O que vem depois do
 * "#" nunca chega ao servidor, entao so o navegador consegue ver - e, sem
 * isto, a pessoa ficava parada na capa sem saber que o link tinha vencido.
 */
export function RetornoDoEmail() {
  const router = useRouter();
  useEffect(() => {
    const fragmento = window.location.hash.slice(1);
    if (!fragmento || !/(^|&)error(_code)?=/.test(fragmento)) return;
    const ehRecuperacao = /type=recovery/.test(fragmento) || window.location.pathname.startsWith("/redefinir-senha");
    router.replace(ehRecuperacao ? "/recuperar-senha?erro=link" : "/entrar?aviso=link");
  }, [router]);
  return null;
}
