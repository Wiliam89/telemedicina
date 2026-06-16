<?php

namespace App\Services;

use App\Jobs\ProcessarFilaAtendimento;
use App\Models\Consulta;
use Illuminate\Support\Facades\DB;

class ConsultaService
{
    public function criar(array $dados): Consulta
    {
        return DB::transaction(function () use ($dados) {

            if ($dados['tipo'] === 'imediata') {

                $dados['status'] = 'fila';
                $dados['data_inicio'] = now();

            } else {

                $dados['status'] = 'agendada';

            }

            $consulta = Consulta::create($dados);

            if ($consulta->tipo === 'imediata') {

                ProcessarFilaAtendimento::dispatch();

            }

            return $consulta;
        });
    }
}
