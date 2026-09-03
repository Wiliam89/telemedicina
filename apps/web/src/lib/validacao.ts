/**
 * Validacoes que rodam no navegador, antes de chamar a API.
 *
 * A API valida tudo de novo (Zod) - esta camada existe para a pessoa ver o
 * erro na hora, no campo certo, sem esperar a rede. Nunca confie so nela.
 */

/** Deixa so os digitos: "123.456.789-01" -> "12345678901". */
export function soDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * Confere os dois digitos verificadores do CPF (algoritmo oficial da
 * Receita). Sequencias repetidas ("11111111111") sao invalidas.
 */
export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** "12345678901" -> "123.456.789-01" (so para exibir). */
export function formatarCpf(cpf: string): string {
  const d = soDigitos(cpf);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}

/** Data de nascimento AAAA-MM-DD: precisa ser no passado e ha menos de 130 anos. */
export function dataNascimentoValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const data = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(data.getTime())) return false;
  const hoje = new Date();
  const limite = new Date(hoje.getFullYear() - 130, hoje.getMonth(), hoje.getDate());
  return data < hoje && data > limite;
}

/** Senha: minimo do Supabase e 6; pedimos 8 e ao menos uma letra e um numero. */
export function problemaDaSenha(senha: string): string | null {
  if (senha.length < 8) return "Use ao menos 8 caracteres.";
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return "Misture letras e numeros.";
  return null;
}

/**
 * Confere os digitos verificadores do CNPJ (mesmo algoritmo da Receita).
 * Sequencias repetidas ("11111111111111") sao invalidas.
 */
export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (tam: number) => {
    let soma = 0;
    let peso = tam - 7;
    for (let i = 0; i < tam; i++) {
      soma += Number(d[i]) * peso;
      peso = peso - 1 < 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** "Clinica Vida & Saude" -> "clinica-vida-saude". Usado no endereco da clinica. */
export function sugerirSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
