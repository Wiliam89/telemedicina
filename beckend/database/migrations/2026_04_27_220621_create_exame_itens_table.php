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
      Schema::create('exame_itens', function (Blueprint $table) {
        $table->id();

        $table->foreignId('exame_id')
              ->constrained('exames')
              ->cascadeOnDelete();

        $table->string('nome_exame');
        $table->text('descricao')->nullable();
        $table->text('observacoes')->nullable();

        $table->timestamps();
       });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('exame_itens');
    }
};
