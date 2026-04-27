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
       Schema::create('atendimentos', function (Blueprint $table) {
        $table->id();

        $table->foreignId('consulta_id')
              ->constrained('consultas')
              ->cascadeOnDelete();

        $table->foreignId('medico_id')
              ->constrained('medicos');

        $table->text('anamnese')->nullable();
        $table->text('exame_fisico')->nullable();
        $table->text('diagnostico')->nullable();
        $table->text('conduta')->nullable();

        $table->text('observacoes')->nullable();

        $table->timestamps();
       });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('atendimentos');
    }
};
