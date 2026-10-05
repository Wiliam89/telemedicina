/**
 * Tarja de ambiente.
 *
 * Uma plataforma publicada na internet para demonstracao e indistinguivel
 * da de verdade para quem chega nela. Se as assinaturas nao tem valor
 * legal, isso precisa estar na cara - senao alguem leva uma receita a
 * farmacia e passa vergonha, ou pior, deixa de tomar o remedio.
 *
 * Aparece sempre que NEXT_PUBLIC_AMBIENTE for diferente de "producao".
 */
export function TarjaDeAmbiente() {
  const ambiente = process.env.NEXT_PUBLIC_AMBIENTE ?? "desenvolvimento";
  if (ambiente === "producao") return null;

  const rotulo = ambiente === "homologacao" ? "Ambiente de demonstração" : "Ambiente de desenvolvimento";

  return (
    <div role="status" className="bg-alerta px-4 py-2 text-center text-sm text-white">
      <strong>{rotulo}.</strong> Os documentos emitidos aqui <strong>não têm valor legal</strong> e não devem ser usados
      em farmácia ou apresentados como atestado. A videochamada pode estar <strong>simulada</strong> — a própria sala
      avisa quando não há vídeo. Não cadastre dados de paciente real.
    </div>
  );
}
