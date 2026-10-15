import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { Request, Response } from 'express';
import { AuthenticationGuard } from '../../identity/infrastructure/http/authentication/authentication.guard';

@Catch()
export class AuthenticatedJsonRequestExceptionFilter extends BaseExceptionFilter<unknown> {
    private readonly logger: Logger = new Logger(AuthenticatedJsonRequestExceptionFilter.name);

    constructor(
        adapterHost: HttpAdapterHost,
        private readonly authenticationGuard: AuthenticationGuard,
        private readonly throttlerGuard: ThrottlerGuard,
    ) {
        super(adapterHost.httpAdapter);
    }

    override catch(exception: unknown, host: ArgumentsHost): void {
        if (exception instanceof ThrottlerException) {
            const httpResponse: Response = host.switchToHttp().getResponse<Response>();
            const namedRetryAfter: string | undefined =
                httpResponse.get('Retry-After-auth') ??
                httpResponse.get('Retry-After-account') ??
                httpResponse.get('Retry-After-readiness');

            if (namedRetryAfter !== undefined) {
                httpResponse.set('Retry-After', namedRetryAfter);
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
            if (!(exception instanceof HttpException)) {
                if (isParserFailure) {
                    super.catch(
                        new HttpException(
                            {
                                statusCode: status,
                                message:
                                    status === 413 ? 'request entity too large' : 'Bad Request',
                            },
                            status === 413 ? 413 : 400,
                        ),
                        host,
                    );

                    return;
                }

                this.rejectUnexpectedException(host);

                return;
            }

            super.catch(exception, host);

            return;
        }

        void this.rejectParserFailure(host, status === 413);
    }

    private rejectUnexpectedException(host: ArgumentsHost): void {
        this.logger.error({ event: 'unexpected_request_failed', status: 500 });
        super.catch(
            new HttpException({ statusCode: 500, message: 'Internal server error' }, 500),
            host,
        );
    }

    private hasAuthenticationFirstParserContract(request: Request): boolean {
        const path: string = request.path;
        const method: string = request.method === 'HEAD' ? 'GET' : request.method;

        if (/^\/pets\/?$/i.test(path)) {
            return method === 'GET' || method === 'POST';
        }

        if (/^\/pets\/[^/]+\/?$/i.test(path)) {
            return method === 'GET' || method === 'PATCH';
        }

        if (/^\/pet-invitations\/[^/]+\/(accept|reject|cancel)\/?$/i.test(path)) {
            return method === 'POST';
        }

        if (
            /^\/pets\/[^/]+\/(archive|restore|leave|invitations|members\/[^/]+\/promote|care\/routines\/[^/]+\/activities|health\/medications\/[^/]+\/(complete|discontinue|reopen)|health\/medical-conditions\/[^/]+\/(resolve|reopen))\/?$/i.test(
                path,
            )
        ) {
            return method === 'POST';
        }

        if (/^\/pets\/[^/]+\/(members|care\/(activities|summary))\/?$/i.test(path)) {
            return method === 'GET';
        }

        if (/^\/pets\/[^/]+\/members\/[^/]+\/?$/i.test(path)) {
            return method === 'DELETE';
        }

        if (
            /^\/pets\/[^/]+\/(care\/routines|health\/(weight-records|vaccination-records|allergies|medical-conditions|medications|veterinary-visits))\/?$/i.test(
                path,
            )
        ) {
            return method === 'GET' || method === 'POST';
        }

        if (
            /^\/pets\/[^/]+\/(care\/routines|health\/(weight-records|vaccination-records|allergies|medical-conditions|medications|veterinary-visits))\/[^/]+\/?$/i.test(
                path,
            )
        ) {
            return method === 'PATCH' || (method === 'DELETE' && !path.includes('/care/'));
        }

        return false;
    }

    private async rejectParserFailure(host: ArgumentsHost, isTooLarge: boolean): Promise<void> {
        // JSON parser failures precede route guards; these routes require authentication first.
        try {
            const context: ExecutionContextHost = new ExecutionContextHost(
                host.getArgs<unknown[]>(),
                AuthenticatedJsonRequestExceptionFilter,
                // eslint-disable-next-line @typescript-eslint/unbound-method -- Metadata only; the context never invokes this handler.
                this.rejectParserFailure,
            );

            await this.throttlerGuard.canActivate(context);
            await this.authenticationGuard.canActivate(
                new ExecutionContextHost(host.getArgs<unknown[]>()),
            );
        } catch (error: unknown) {
            if (error instanceof ThrottlerException) {
                this.catch(error, host);
            } else if (error instanceof HttpException) {
                super.catch(error, host);
            } else {
                this.rejectUnexpectedException(host);
            }

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
