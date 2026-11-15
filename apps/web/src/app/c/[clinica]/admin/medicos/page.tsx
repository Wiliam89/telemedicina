import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Stethoscope } from "lucide-react";
import type { MedicoNaAdministracao } from "@tele/shared";
import { formatarPercentual } from "@tele/shared/admin";
import { Aviso } from "@/componentes/Aviso";
import { CabecalhoDaPagina, Cartao, Vazio } from "@/componentes/ui";
import { chamarApi } from "@/lib/api";
import { contextoDaClinica } from "@/lib/clinica";
import { temPapel } from "@/lib/papeis";
import { EditorDoMedico } from "./EditorDoMedico";

export const metadata: Metadata = { title: "Médicos" };

/** Os medicos da plataforma, com porcentagem, atendimento, ganhos e saldo (ADR-0026). */
export default async function PaginaMedicosDaAdministracao({ params }: { params: Promise<{ clinica: string }> }) {
  const { clinica: slug } = await params;
  const { token, clinica } = await contextoDaClinica(slug);
  if (!temPapel(clinica, "admin_clinica")) notFound();
  const [medicos, config] = await Promise.all([
    chamarApi<MedicoNaAdministracao[]>("/admin/medicos", { token, clinica: slug }),
    chamarApi<{ repassePadraoBps: number | null }>("/admin/configuracoes", { token, clinica: slug }),
  ]);
  const padrao = config.ok ? config.dados.repassePadraoBps : null;

  return (
    <div className="space-y-8">
      <CabecalhoDaPagina
        sobretitulo="Administração"
        titulo="Médicos"
        descricao={`Porcentagem padrão: ${formatarPercentual(padrao)} do valor de cada consulta fica com o médico. Aqui você define uma porcentagem própria e o que cada médico atende.`}
      />
      {padrao === null ? (
        <Aviso tipo="espera">
          A porcentagem padrão ainda não foi definida: sem ela, médico sem porcentagem própria não tem ganho calculado.{" "}
          <Link href={`/c/${slug}/admin/configuracoes`} className="font-medium underline underline-offset-4">Definir agora</Link>
        </Aviso>
      ) : null}
      {!medicos.ok ? (
        <Aviso tipo="erro">{medicos.erro.mensagem}</Aviso>
      ) : medicos.dados.length === 0 ? (
        <Vazio Icone={Stethoscope} titulo="Nenhum médico ainda">Os médicos entram pelo credenciamento. Os pedidos aparecem em Credenciamentos.</Vazio>
      ) : (
        <Cartao semPadding>
          <ul className="divide-y divide-linha">
            {medicos.dados.map((m) => (
              <EditorDoMedico key={`${m.id}:${m.percentualProprioBps}:${m.especialidades.join()}:${m.atendeProntoAtendimento}`} slug={slug} medico={m} padraoBps={padrao} />
            ))}
          </ul>
        </Cartao>
      )}
      <p className="text-sm text-tinta-suave">
        Para suspender o acesso de um médico, use <Link href={`/c/${slug}/equipe`} className="text-selo underline underline-offset-4">Equipe</Link>. O histórico e os prontuários continuam guardados.
      </p>
    </div>
  );
}
