<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Triagem extends Model
{
    protected $table = 'triagens';

    protected $fillable = [
        'paciente_id',
        'peso',
        'altura',
        'sintomas',
        'pressao',
        'temperatura'
    ];

    public function consulta(): HasOne
    {
        return $this->hasOne(Consulta::class);
    }
}
