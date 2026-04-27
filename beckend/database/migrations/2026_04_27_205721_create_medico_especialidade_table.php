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
      Schema::create('medico_especialidade', function (Blueprint $table) {
        $table->id();

        $table->foreignId('medico_id')
              ->constrained('medicos')
              ->cascadeOnDelete();

        $table->foreignId('especialidade_id')
              ->constrained('especialidades')
              ->cascadeOnDelete();

        $table->timestamps();

        $table->unique(['medico_id', 'especialidade_id']);
       });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('medico_especialidade');
    }
};
