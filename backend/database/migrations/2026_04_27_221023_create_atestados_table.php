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
      Schema::create('atestados', function (Blueprint $table) {
        $table->id();

        $table->foreignId('atendimento_id')
              ->constrained('atendimentos')
              ->cascadeOnDelete();

        $table->foreignId('medico_id')
              ->constrained('medicos');

        $table->text('descricao');

        $table->date('data_inicio')->nullable();
        $table->date('data_fim')->nullable();
        $table->integer('dias_afastamento')->nullable();

        $table->enum('status', [
            'rascunho',
            'emitido',
            'assinado',
            'cancelado'
        ])->default('rascunho');

        $table->timestamp('emitido_em')->nullable();
        $table->timestamp('assinado_em')->nullable();

        $table->string('hash_documento')->nullable();

        $table->timestamps();
       });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('atestados');
    }
};
