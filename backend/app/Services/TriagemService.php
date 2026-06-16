<?php

namespace App\Services;

use App\Models\Triagem;
use Illuminate\Support\Facades\DB;

class TriagemService
{
    public function criar(array $dados): Triagem
    {
        return DB::transaction(function () use ($dados) {

            return Triagem::create($dados);

        });
    }
}
