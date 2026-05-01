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
     Schema::create('consultas', function (Blueprint $table) {
        $table->id();

        $table->foreignId('paciente_id')
              ->constrained('pacientes')
              ->cascadeOnDelete();

        $table->foreignId('medico_id')
              ->nullable()
              ->constrained('medicos')
              ->nullOnDelete();

        $table->foreignId('especialidade_id')
              ->constrained('especialidades');

        $table->enum('tipo', ['imediata', 'agendada']);

        $table->enum('status', [
            'agendada',
            'fila',
            'em_atendimento',
            'finalizada',
            'cancelada'
        ]);

        $table->timestamp('data_agendada')->nullable();

        $table->timestamp('data_inicio')->nullable();
        $table->timestamp('data_fim')->nullable();

        $table->text('motivo')->nullable();

        $table->timestamps();
       });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('consultas');
    }
};
