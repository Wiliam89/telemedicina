<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class FilaAtendimentoService
{
   public function processar(): void
  {
     DB::transaction(function () {

        // LOOP CONTROLADO → processa múltiplas consultas por execução
        while (true) {

            // 2. Lock próxima consulta elegível
            $consulta = DB::table('consultas')
                ->where('status', 'fila')
                ->where('data_inicio', '<=', now())
                ->orderByDesc('prioridade')
                ->orderBy('created_at')
                ->lockForUpdate()
                ->first();

            if (!$consulta) {
                break;
            }


            // 1. Lock médico disponível
            $medico = DB::table('medicos')
            ->join('medico_especialidade', 'medicos.id', '=', 'medico_especialidade.medico_id')
            ->where('medicos.status', 'online')
            ->where('medicos.em_atendimento', false)
            ->where('medico_especialidade.especialidade_id', $consulta->especialidade_id)
            ->select('medicos.*')
            ->lockForUpdate()
            ->first();

            if (!$medico) {
                break;
            }

            // 3. Atualizar consulta
            DB::table('consultas')
                ->where('id', $consulta->id)
                ->update([
                    'medico_id' => $medico->id,
                    'status' => 'em_atendimento',
                    'updated_at' => now()
                ]);

            // 4. Atualizar médico
            DB::table('medicos')
                ->where('id', $medico->id)
                ->update([
                    'em_atendimento' => true,
                    'updated_at' => now()
                ]);

           $agora = now()->toDateTimeString();
           // 5. Criar atendimento (ALINHADO COM SCHEMA)
            DB::table('atendimentos')->insert([
             'consulta_id' => $consulta->id,
             'medico_id' => $medico->id,

            // CONTROLE DE ESTADO
              'status' => 'em_andamento',

            // CONTROLE TEMPORAL
              'iniciado_em' => $agora,

           // CAMPOS CLÍNICOS INICIAIS (vazios por padrão)
               'anamnese' => null,
               'exame_fisico' => null,
               'diagnostico' => null,
               'conduta' => null,
               'observacoes' => null,

               'created_at' => $agora,
               'updated_at' => $agora,
            ]);
        }

     });
  }
}
