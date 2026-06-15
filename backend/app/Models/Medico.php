<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Medico extends Model
{
    protected $table = 'medicos';

    protected $fillable = [
        'usuario_id',
        'crm',
        'uf_crm',
        'status',
        'em_atendimento'
    ];

    protected $casts = [
        'em_atendimento' => 'boolean'
    ];

    public function usuario(): BelongsTo
    {
        return $this->belongsTo(User::class, 'usuario_id');
    }

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
        return $this->hasMany(Consulta::class, 'medico_id');
    }

    public function atendimentos(): HasMany
    {
        return $this->hasMany(Atendimento::class, 'medico_id');
    }
}
