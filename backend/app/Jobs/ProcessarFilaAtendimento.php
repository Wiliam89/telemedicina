<?php

namespace App\Jobs;

use App\Services\FilaAtendimentoService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class ProcessarFilaAtendimento implements ShouldQueue
{
    use Queueable;

    public function handle(): void
    {
        app(FilaAtendimentoService::class)->processar();
    }
}
