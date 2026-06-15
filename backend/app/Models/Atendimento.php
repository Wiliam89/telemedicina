<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Atendimento extends Model
{
    protected $table = 'atendimentos';

    protected $fillable = [
        'consulta_id',
        'medico_id',
        'status',
        'iniciado_em',
        'finalizado_em',
        'anamnese',
        'exame_fisico',
        'diagnostico',
        'conduta',
        'observacoes'
    ];

    protected $casts = [
        'iniciado_em' => 'datetime',
        'finalizado_em' => 'datetime',
    ];

    public function consulta(): BelongsTo
    {
        return $this->belongsTo(Consulta::class, 'consulta_id');
    }

    public function medico(): BelongsTo
    {
        return $this->belongsTo(Medico::class, 'medico_id');
    }
}
