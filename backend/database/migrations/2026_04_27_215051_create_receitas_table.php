<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
   public function up()
    {
      Schema::create('receitas', function (Blueprint $table) {
        $table->id();

        $table->foreignId('atendimento_id')
              ->constrained('atendimentos')
              ->cascadeOnDelete();

        $table->foreignId('medico_id')
              ->constrained('medicos');

        $table->enum('status', [
            'rascunho',
            'emitida',
            'assinada',
            'cancelada'
        ])->default('rascunho');

        $table->text('observacoes')->nullable();

        $table->timestamp('emitida_em')->nullable();
        $table->timestamp('assinada_em')->nullable();

        $table->timestamps();
       });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('receitas');
    }
};
