/**
 * Trava dos comandos que GRAVAM (migrar, demonstracao, prova de ponta a
 * ponta): em servidor remoto eles so rodam com confirmacao explicita.
 *
 * Existe porque o mesmo .env ja apontou para o banco da producao: um comando
 * rodado "so para testar" gravaria onde estao os dados de verdade.
 */
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function ehEnderecoLocal(url: string): boolean {
  try {
    return HOSTS_LOCAIS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Para o processo se `url` for remota e ninguem tiver confirmado. */
export function exigirConfirmacaoDeBancoRemoto(url: string, acao: string): void {
  if (ehEnderecoLocal(url) || process.env.CONFIRMAR_BANCO_REMOTO === "sim") return;
  let host = "(endereco invalido)";
  try {
    host = new URL(url).hostname;
  } catch {
    // a mensagem abaixo ja basta
  }
  console.error(`\nRecusado: ${acao} grava em ${host}, que nao e um banco local.`);
  console.error("Confira se este e mesmo o banco certo. Para continuar, defina CONFIRMAR_BANCO_REMOTO=sim neste terminal.");
  console.error('  PowerShell:  $env:CONFIRMAR_BANCO_REMOTO="sim"\n');
  process.exit(1);
}
