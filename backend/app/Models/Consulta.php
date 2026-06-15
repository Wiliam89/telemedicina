<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Consulta extends Model
{
    protected $table = 'consultas';

    protected $fillable = [
        'paciente_id',
        'medico_id',
        'especialidade_id',
        'triagem_id',
        'tipo',
        'status',
        'prioridade',
        'data_agendada',
        'data_inicio',
        'data_fim',
        'motivo'
    ];

    protected $casts = [
        'data_agendada' => 'datetime',
        'data_inicio' => 'datetime',
        'data_fim' => 'datetime',
    ];

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class, 'paciente_id');
    }

    public function medico(): BelongsTo
    {
        return $this->belongsTo(Medico::class, 'medico_id');
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class, 'especialidade_id');
    }

    public function triagem(): BelongsTo
    {
        return $this->belongsTo(Triagem::class, 'triagem_id');
    }

    public function atendimento(): HasOne
    {
        return $this->hasOne(Atendimento::class, 'consulta_id');
    }
}
