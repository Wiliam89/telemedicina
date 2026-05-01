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

            // 1. Lock médico disponível
            $medico = DB::table('medicos')
                ->where('status', 'online')
                ->where('em_atendimento', false)
                ->lockForUpdate()
                ->first();

            if (!$medico) {
                break;
            }

            // 2. Lock próxima consulta elegível
            $consulta = DB::table('consultas')
                ->where('status', 'aguardando')
                ->where('data_inicio', '<=', now())
                ->orderByDesc('prioridade')
                ->orderBy('created_at')
                ->lockForUpdate()
                ->first();

            if (!$consulta) {
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

            // 5. Criar atendimento
            DB::table('atendimentos')->insert([
                'consulta_id' => $consulta->id,
                'medico_id' => $medico->id,
                'iniciado_em' => now(),
                'status' => 'em_andamento',
                'created_at' => now(),
                'updated_at' => now()
            ]);
        }

     });
  }
}
