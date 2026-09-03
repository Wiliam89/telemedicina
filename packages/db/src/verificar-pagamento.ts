/**
 * pnpm db:verificar-pagamento   (passo [13/13] do `pnpm verificar`)
 *
 * Confere a saude financeira do sistema. Divergencia de centavos ou
 * reserva presa sem pagamento sao os defeitos que custam dinheiro e
 * confianca - e os dois sao silenciosos se ninguem olhar.
 */
import postgres from "postgres";
import { explicarErroDeConexao, lerDatabaseUrl } from "./ambiente-db.js";

let falhas = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const aviso = (m: string, dica?: string) => {
  console.log(`  !    ${m}`);
  if (dica) console.log(`       -> ${dica}`);
};
const erro = (m: string, dica?: string) => {
  falhas++;
  console.log(`  ERRO ${m}`);
  if (dica) console.log(`       -> ${dica}`);
};

const sql = postgres(lerDatabaseUrl(), { prepare: false, connect_timeout: 10, max: 1 });

try {
  const [total] = await sql<{ n: number }[]>`select count(*)::int as n from pagamentos`;
  ok(`${total?.n ?? 0} pagamento(s) registrado(s)`);

  // A soma das partes tem de fechar. Se nao fechar, alguem recebe a menos.
  const [split] = await sql<{ n: number }[]>`
    select count(*)::int as n from pagamentos
    where valor_clinica_centavos + valor_plataforma_centavos > valor_centavos
  `;
  if ((split?.n ?? 0) === 0) ok("em todo pagamento, clinica + plataforma nunca passa do total");
  else erro(`${split!.n} pagamento(s) com split maior que o valor cobrado`, "Isso nao deveria passar pelo CHECK do banco. Investigue.");

  const [semProvedorId] = await sql<{ n: number }[]>`
    select count(*)::int as n from pagamentos where status in ('confirmado','autorizado') and provedor_id is null
  `;
  if ((semProvedorId?.n ?? 0) === 0) ok("todo pagamento confirmado tem id no provedor (conciliavel)");
  else erro(`${semProvedorId!.n} pagamento(s) confirmados sem id do provedor`, "Sem esse id nao da para conciliar com o extrato do gateway.");

  // Reserva vencida que ninguem liberou prende horario de graca.
  const [presas] = await sql<{ n: number }[]>`
    select count(*)::int as n from consultas
    where status = 'aguardando_pagamento' and expira_reserva_em < now() - interval '1 hour'
  `;
  if ((presas?.n ?? 0) === 0) ok("nenhuma reserva vencida prendendo horario");
  else aviso(`${presas!.n} reserva(s) vencida(s) ainda em aguardando_pagamento`, "Elas nao ocupam horario (a consulta de horarios livres as ignora), mas devem ser encerradas pela rotina de limpeza.");

  // Clinica cobrando sem conta para receber: o paciente marca e nao paga.
  const [semRecebimento] = await sql<{ n: number }[]>`
    select count(distinct p.clinica_id)::int as n from precos p
    join clinicas c on c.id = p.clinica_id
    where c.pagamento_provedor is null
  `;
  if ((semRecebimento?.n ?? 0) === 0) ok("toda clinica com preco tem conta de recebimento");
  else aviso(`${semRecebimento!.n} clinica(s) com preco definido mas sem conta de recebimento`, "Em desenvolvimento usa-se o gateway simulado; em producao a cobranca falharia.");

  // Token do vendedor vencendo: os repasses param sem aviso.
  const vencendo = await sql<{ slug: string; dias: number }[]>`
    select slug, ceil(extract(epoch from (pagamento_token_expira_em - now())) / 86400)::int as dias
    from clinicas
    where pagamento_token_expira_em is not null and pagamento_token_expira_em < now() + interval '15 days'
    order by dias
  `;
  if (vencendo.length === 0) ok("nenhuma autorizacao de recebimento perto de vencer");
  else
    for (const c of vencendo) {
      if (c.dias <= 0) erro(`a autorizacao de ${c.slug} no provedor VENCEU`, "A clinica precisa reconectar a conta: ate la nao e possivel cobrar.");
      else aviso(`a autorizacao de ${c.slug} vence em ${c.dias} dia(s)`, "Avise a clinica para reconectar antes que os repasses parem.");
    }

  await sql.end();
  process.exit(falhas === 0 ? 0 : 1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  erro(`nao foi possivel inspecionar os pagamentos: ${msg}`, explicarErroDeConexao(err) ?? "Rode: pnpm db:testar-conexao");
  await sql.end({ timeout: 1 });
  process.exit(1);
}
