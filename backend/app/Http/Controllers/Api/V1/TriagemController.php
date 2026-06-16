<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\CriarTriagemRequest;
use App\Services\TriagemService;

class TriagemController extends BaseApiController
{
    public function __construct(
        private TriagemService $triagemService
    ) {
    }

    public function store(CriarTriagemRequest $request)
    {
        $triagem = $this->triagemService->criar(
            $request->validated()
        );

        return $this->success(
            $triagem,
            'Triagem criada com sucesso.',
            201
        );
    }
}
