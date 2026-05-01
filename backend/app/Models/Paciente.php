<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Paciente extends Model
{
    protected $table = 'pacientes';

    protected $fillable = [
        'user_id',
        'telefone',
        'data_nascimento'
    ];

    public function consultas(): HasMany
    {
        return $this->hasMany(Consulta::class);
    }
}
