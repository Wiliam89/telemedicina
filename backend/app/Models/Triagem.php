<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Triagem extends Model
{
    protected $table = 'triagens';

    protected $fillable = [
        'paciente_id',
        'temperatura',
        'peso',
        'altura',
        'esta_em_local_seguro',
        'esta_dirigindo',
        'descricao_sintomas',
        'respostas'
    ];

    protected $casts = [
        'esta_em_local_seguro' => 'boolean',
        'esta_dirigindo' => 'boolean',
        'respostas' => 'array',
    ];

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class, 'paciente_id');
    }

    public function consultas(): HasMany
    {
        return $this->hasMany(Consulta::class, 'triagem_id');
    }
}
