"use client";

/**
 * Ultima rede de seguranca: falha no proprio layout raiz. Substitui a pagina
 * inteira, por isso traz o proprio <html> e nao depende de CSS nem de fonte.
 */
export default function ErroGlobal({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, padding: 16, color: "#0f172a", textAlign: "center" }}>
        <div>
          <h1 style={{ fontSize: 24 }}>Algo deu errado</h1>
          <p style={{ color: "#5b6779" }}>Tivemos um problema ao abrir a plataforma. Nada do que você salvou foi perdido.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 8, border: 0, background: "#0b7f7a", color: "#fff", fontSize: 16, cursor: "pointer" }}>
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
