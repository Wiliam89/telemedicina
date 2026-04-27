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
      Schema::create('medicos', function (Blueprint $table) {
        $table->id(); // id único

        $table->foreignId('usuario_id')->constrained('usuarios')->onDelete('cascade');
        // ligação com usuario

        $table->string('crm');
        // número do CRM

        $table->unique(['crm', 'uf_crm']);
        //garante que CRM e UF não possam repertir
        
        $table->string('uf_crm', 2);
        // estado do CRM (MG, SP...)

        $table->timestamps();
    });
   }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('medicos');
    }
};
