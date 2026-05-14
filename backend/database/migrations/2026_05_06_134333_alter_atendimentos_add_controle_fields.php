<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('atendimentos', function (Blueprint $table) {

            // STATUS DO ATENDIMENTO
            $table->enum('status', [
                'em_andamento',
                'finalizado',
                'cancelado'
            ])->default('em_andamento')->after('medico_id');

            // CONTROLE TEMPORAL
            $table->timestamp('iniciado_em')->nullable()->after('status');
            $table->timestamp('finalizado_em')->nullable()->after('iniciado_em');

        });
    }

    public function down(): void
    {
        Schema::table('atendimentos', function (Blueprint $table) {

            $table->dropColumn([
                'status',
                'iniciado_em',
                'finalizado_em'
            ]);

        });
    }
};
