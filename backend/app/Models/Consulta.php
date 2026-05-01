<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Consulta extends Model
{
    protected $table = 'consultas';

    protected $fillable = [
        'paciente_id',
        'medico_id',
        'especialidade_id',
        'triagem_id',
        'status',
        'iniciada_em',
        'finalizada_em',
    ];

    protected $casts = [
        'iniciada_em' => 'datetime',
        'finalizada_em' => 'datetime',
    ];

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function medico(): BelongsTo
    {
        return $this->belongsTo(Medico::class);
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class);
    }

    public function triagem(): BelongsTo
    {
        return $this->belongsTo(Triagem::class);
    }
}
