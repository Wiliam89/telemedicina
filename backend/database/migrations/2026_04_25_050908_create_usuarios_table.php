<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('usuarios', function (Blueprint $table) {
        $table->id(); // id único

        $table->string('nome'); // nome completo

        $table->string('email')->unique(); // email único

        $table->string('password'); // senha

        $table->enum('tipo', ['paciente', 'medico', 'admin']);
        // define o tipo de usuário

        $table->string('telefone')->nullable();
        // telefone pode ser vazio

        $table->string('cpf')->unique();
        // cpf único

        $table->date('data_nascimento')->nullable();

        $table->timestamps(); // created_at e updated_at
      });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('usuarios');
    }
};
