<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CriarTriagemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'paciente_id' => [
                'required',
                'exists:pacientes,id'
            ],

            'temperatura' => [
                'nullable',
                'numeric',
                'between:30,45'
            ],

            'peso' => [
                'nullable',
                'numeric',
                'between:1,500'
            ],

            'altura' => [
                'nullable',
                'numeric',
                'between:0.30,3.00'
            ],

            'esta_em_local_seguro' => [
                'required',
                'boolean'
            ],

            'esta_dirigindo' => [
                'required',
                'boolean'
            ],

            'descricao_sintomas' => [
                'required',
                'string',
                'max:5000'
            ],

            'respostas' => [
                'nullable',
                'array'
            ]
        ];
    }
}
