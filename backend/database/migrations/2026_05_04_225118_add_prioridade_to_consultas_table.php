<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('consultas', function (Blueprint $table) {

            if (!Schema::hasColumn('consultas', 'prioridade')) {
                $table->integer('prioridade')
                    ->default(0)
                    ->after('status');
            }

        });
    }

    public function down(): void
    {
        Schema::table('consultas', function (Blueprint $table) {

            if (Schema::hasColumn('consultas', 'prioridade')) {
                $table->dropColumn('prioridade');
            }

        });
    }
};
