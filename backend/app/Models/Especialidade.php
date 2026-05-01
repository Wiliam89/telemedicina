<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

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
}
