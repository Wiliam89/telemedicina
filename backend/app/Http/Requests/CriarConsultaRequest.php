<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CriarConsultaRequest extends FormRequest
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

            'especialidade_id' => [
                'required',
                'exists:especialidades,id'
            ],

            'triagem_id' => [
                'nullable',
                'exists:triagens,id'
            ],

            'tipo' => [
                'required',
                'in:imediata,agendada'
            ],

            'motivo' => [
                'nullable',
                'string',
                'max:5000'
            ],

            'data_agendada' => [
                'nullable',
                'date'
            ]
        ];
    }
}
