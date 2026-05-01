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
    Schema::create('triagens', function (Blueprint $table) {
        $table->id();

        $table->foreignId('paciente_id')
              ->constrained('pacientes')
              ->cascadeOnDelete();

        $table->decimal('temperatura', 4, 1)->nullable();
        $table->decimal('peso', 5, 2)->nullable();
        $table->decimal('altura', 4, 2)->nullable();

        $table->boolean('esta_em_local_seguro')->default(true);
        $table->boolean('esta_dirigindo')->default(false);

        $table->text('descricao_sintomas')->nullable();

        $table->json('respostas')->nullable();

        $table->timestamps();
      });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('triagens');
    }
};
