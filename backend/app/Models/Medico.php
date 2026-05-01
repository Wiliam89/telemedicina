<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Medico extends Model
{
    protected $table = 'medicos';

    protected $fillable = [
        'user_id',
        'crm',
        'uf',
        'status'
    ];

    public function especialidades(): BelongsToMany
    {
        return $this->belongsToMany(
            Especialidade::class,
            'medico_especialidade',
            'medico_id',
            'especialidade_id'
        );
    }

    public function consultas(): HasMany
    {
        return $this->hasMany(Consulta::class);
    }

    public function consultasAtivas(): HasMany
    {
        return $this->hasMany(Consulta::class)
            ->where('status', 'em_atendimento');
    }
}
