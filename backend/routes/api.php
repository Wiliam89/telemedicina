<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\V1\ConsultaController;
use App\Http\Controllers\Api\V1\TriagemController;

Route::prefix('v1')->group(function () {

    Route::get('/health', function () {
        return response()->json([
            'status' => 'ok'
        ]);
    });

        Route::post('/triagens', [TriagemController::class, 'store']);

        Route::post('/consultas', [ConsultaController::class, 'store']);

});
