<?php

namespace App\Http\Middleware;

use App\Services\RunnerTokenService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateRunnerToken
{
    public function __construct(private RunnerTokenService $tokenService) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();

        if (! $token) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        try {
            $claims = $this->tokenService->validate($token);
        } catch (\Throwable) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $request->attributes->set('auth_type', 'service');
        $request->attributes->set('jwt_claims', $claims);

        return $next($request);
    }
}
