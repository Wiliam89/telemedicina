/** O que aparece enquanto o servidor monta a tela: navegar nunca parece travado. */
export default function Carregando() {
  return (
    <div className="space-y-4" role="status" aria-label="Carregando">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-linha" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded bg-linha" />
      <div className="h-48 w-full animate-pulse rounded-xl bg-linha/60" />
      <span className="sr-only">Carregando...</span>
    </div>
  );
}
