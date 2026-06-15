<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Especialidade extends Model
{
    protected $table = 'especialidades';

    protected $fillable = [
        'nome'
    ];

    public function medicos(): BelongsToMany
    {
        return $this->belongsToMany(
            Medico::class,
            'medico_especialidade',
            'especialidade_id',
            'medico_id'
        );
    }

    public function consultas(): HasMany
    {
        return $this->hasMany(Consulta::class, 'especialidade_id');
    }
}
