<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\CriarConsultaRequest;
use App\Services\ConsultaService;

class ConsultaController extends BaseApiController
{
    public function __construct(
        private ConsultaService $consultaService
    ) {
    }

    public function store(CriarConsultaRequest $request)
    {
        $consulta = $this->consultaService->criar(
            $request->validated()
        );

        return $this->success(
            $consulta,
            'Consulta criada com sucesso.',
            201
        );
    }
}
