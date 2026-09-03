/**
 * O carimbo do receituario: usado SO para o que certifica identidade
 * (papel, CRM, CPF). Se aparecer em qualquer outro lugar, esta errado.
 */
export function Carimbo({ children }: { children: string }) {
  return <span className="carimbo">{children}</span>;
}
