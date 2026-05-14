<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
   public function up(): void
   {
      Schema::table('medicos', function (Blueprint $table) {

        if (!Schema::hasColumn('medicos', 'status')) {
            $table->string('status')
                ->default('offline')
                ->after('id');
        }

        if (!Schema::hasColumn('medicos', 'em_atendimento')) {
            $table->boolean('em_atendimento')
                ->default(false)
                ->after('status');
        }

      });
    }

   public function down(): void
   {
     Schema::table('medicos', function (Blueprint $table) {

        if (Schema::hasColumn('medicos', 'em_atendimento')) {
            $table->dropColumn('em_atendimento');
        }

        // NÃO remover status automaticamente (proteção de dados)
      });
    }
};
