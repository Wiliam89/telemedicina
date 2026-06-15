<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Database\Eloquent\Relations\HasOne;

class User extends Authenticatable
{
    use Notifiable;

    protected $table = 'usuarios';

    protected $fillable = [
        'nome',
        'email',
        'password',
        'tipo',
        'telefone',
        'cpf',
        'data_nascimento'
    ];

    protected $hidden = [
        'password',
        'remember_token'
    ];

    protected $casts = [
        'data_nascimento' => 'date',
        'password' => 'hashed'
    ];

    public function paciente(): HasOne
    {
        return $this->hasOne(Paciente::class, 'usuario_id');
    }

    public function medico(): HasOne
    {
        return $this->hasOne(Medico::class, 'usuario_id');
    }
}
