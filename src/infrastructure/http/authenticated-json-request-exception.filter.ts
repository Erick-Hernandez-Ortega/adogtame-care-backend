import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { Request, Response } from 'express';
import { AuthenticationGuard } from '../../identity/infrastructure/http/authentication/authentication.guard';

@Catch()
export class AuthenticatedJsonRequestExceptionFilter extends BaseExceptionFilter<unknown> {
    constructor(
        adapterHost: HttpAdapterHost,
        private readonly authenticationGuard: AuthenticationGuard,
    ) {
        super(adapterHost.httpAdapter);
    }

    override catch(exception: unknown, host: ArgumentsHost): void {
        if (exception instanceof ThrottlerException) {
            const httpResponse: Response = host.switchToHttp().getResponse<Response>();
            const authRetryAfter: string | undefined = httpResponse.get('Retry-After-auth');

            if (authRetryAfter !== undefined) {
                httpResponse.set('Retry-After', authRetryAfter);
            }

            super.catch(
                new HttpException(
                    { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
                    429,
                ),
                host,
            );

            return;
        }

        const request: Request = host.switchToHttp().getRequest<Request>();
        const response: string | object | null =
            exception instanceof HttpException ? exception.getResponse() : null;
        const status: unknown =
            exception instanceof HttpException
                ? exception.getStatus()
                : typeof exception === 'object' && exception !== null && 'status' in exception
                  ? exception.status
                  : null;
        const isParserFailure: boolean =
            (status === 400 || status === 413) &&
            !(typeof response === 'object' && response !== null && 'code' in response);

        if (!isParserFailure || !this.hasAuthenticationFirstParserContract(request)) {
            super.catch(exception, host);

            return;
        }

        void this.rejectParserFailure(host, status === 413);
    }

    private hasAuthenticationFirstParserContract(request: Request): boolean {
        const path: string = request.path;

        if (/^\/pets\/?$/i.test(path)) {
            return request.method === 'GET' || request.method === 'POST';
        }

        if (/^\/pets\/[^/]+\/?$/i.test(path)) {
            return request.method === 'GET' || request.method === 'PATCH';
        }

        if (/^\/pet-invitations\/[^/]+\/(accept|reject|cancel)\/?$/i.test(path)) {
            return request.method === 'POST';
        }

        if (
            /^\/pets\/[^/]+\/(archive|restore|leave|invitations|members\/[^/]+\/promote|care\/routines\/[^/]+\/activities|health\/medications\/[^/]+\/(complete|discontinue|reopen)|health\/medical-conditions\/[^/]+\/(resolve|reopen))\/?$/i.test(
                path,
            )
        ) {
            return request.method === 'POST';
        }

        if (/^\/pets\/[^/]+\/(members|care\/(activities|summary))\/?$/i.test(path)) {
            return request.method === 'GET';
        }

        if (/^\/pets\/[^/]+\/members\/[^/]+\/?$/i.test(path)) {
            return request.method === 'DELETE';
        }

        if (
            /^\/pets\/[^/]+\/(care\/routines|health\/(weight-records|vaccination-records|allergies|medical-conditions|medications|veterinary-visits))\/?$/i.test(
                path,
            )
        ) {
            return request.method === 'GET' || request.method === 'POST';
        }

        if (
            /^\/pets\/[^/]+\/(care\/routines|health\/(weight-records|vaccination-records|allergies|medical-conditions|medications|veterinary-visits))\/[^/]+\/?$/i.test(
                path,
            )
        ) {
            return (
                request.method === 'PATCH' ||
                (request.method === 'DELETE' && !path.includes('/care/'))
            );
        }

        return false;
    }

    private async rejectParserFailure(host: ArgumentsHost, isTooLarge: boolean): Promise<void> {
        // JSON parser failures precede route guards; these routes require authentication first.
        try {
            await this.authenticationGuard.canActivate(
                new ExecutionContextHost(host.getArgs<unknown[]>()),
            );
        } catch (error: unknown) {
            super.catch(error, host);

            return;
        }

        super.catch(
            new HttpException(
                {
                    code: 'INVALID_REQUEST',
                    message: isTooLarge ? 'Request body is too large' : 'Request body is invalid',
                },
                isTooLarge ? 413 : 400,
            ),
            host,
        );
    }
}
