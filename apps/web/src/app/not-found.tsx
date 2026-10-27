import { SearchX } from "lucide-react";
import { LinkBotao } from "@/componentes/Botao";

/**
 * 404. Tambem aparece quando a pessoa nao tem acesso a uma clinica ou
 * consulta: de proposito, nao dizemos se aquilo existe.
 */
export default function NaoEncontrado() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-marinho-suave text-tinta-suave">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="text-2xl">Página não encontrada</h1>
      <p className="text-sm text-tinta-suave">O endereço pode estar errado, ou você não tem acesso a este conteúdo com o seu perfil atual.</p>
      <LinkBotao href="/clinicas">Voltar para minhas clínicas</LinkBotao>
    </div>
  );
}
