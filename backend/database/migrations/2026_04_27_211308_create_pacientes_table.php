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
      Schema::create('pacientes', function (Blueprint $table) {
        $table->id();

        $table->foreignId('usuario_id')
              ->constrained('usuarios')
              ->cascadeOnDelete();

        $table->decimal('peso', 5, 2)->nullable();
        $table->decimal('altura', 4, 2)->nullable();

        $table->string('tipo_sanguineo', 3)->nullable();

        $table->text('alergias')->nullable();
        $table->text('medicacoes_uso_continuo')->nullable();
        $table->text('doencas_cronicas')->nullable();

        $table->timestamps();
       });
     }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('pacientes');
    }
};
