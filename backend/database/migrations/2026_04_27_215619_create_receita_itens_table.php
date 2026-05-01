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
     Schema::create('receita_itens', function (Blueprint $table) {
        $table->id();

        $table->foreignId('receita_id')
              ->constrained('receitas')
              ->cascadeOnDelete();

        $table->string('medicamento');
        $table->string('dosagem')->nullable();
        $table->string('frequencia')->nullable();
        $table->string('duracao')->nullable();
        $table->string('via_administracao')->nullable();

        $table->text('observacoes')->nullable();

        $table->timestamps();
     });
    }
    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('receita_itens');
    }
};
