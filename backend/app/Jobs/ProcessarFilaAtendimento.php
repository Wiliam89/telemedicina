<?php

namespace App\Jobs;

use App\Services\FilaAtendimentoService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ProcessarFilaAtendimento implements ShouldQueue
   {
      use Dispatchable;
      use InteractsWithQueue;
      use Queueable;
      use SerializesModels;

      public function __construct()
      {
        
      }

       public function handle(FilaAtendimentoService $filaAtendimentoService): void
       {
         $filaAtendimentoService->processar();
       }
}
