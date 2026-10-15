import { DrizzleQueryError } from 'drizzle-orm';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthenticationGuard } from '../src/identity/infrastructure/http/authentication/authentication.guard';
import { validateEnvironment } from '../src/infrastructure/config/environment.validation';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { HealthCheckController } from '../src/infrastructure/http/health-check.controller';
import { AuthenticatedJsonRequestExceptionFilter } from '../src/infrastructure/http/authenticated-json-request-exception.filter';

// Real filter, adapter and throttle storage without binding an HTTP socket.
describe('Safe exception handling (integration)', () => {
    let application: INestApplication;
    let filter: AuthenticatedJsonRequestExceptionFilter;

    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore the original prototype method after capturing log arguments.
    const originalLogError = Logger.prototype.error;
    let logEntries: unknown[][];

    function responseHost(
        path: string = '/pets',
        method: string = 'POST',
    ): {
        host: ExecutionContextHost;
        response: { statusCode: number | null; body: unknown };
    } {
        const recorded: { statusCode: number | null; body: unknown } = {
            statusCode: null,
            body: undefined,
        };
        const response = {
            status: (statusCode: number): object => {
                recorded.statusCode = statusCode;

                return response;
            },
            json: (body: unknown): void => {
                recorded.body = body;
            },
            getHeader: (): undefined => undefined,
            header: (): void => {},
            get: (): undefined => undefined,
            set: (): void => {},
        };

        return {
            host: new ExecutionContextHost([
                { path, method, ip: '192.0.2.1', headers: {} },
                response,
            ]),
            response: recorded,
        };
    }

    beforeEach(async (): Promise<void> => {
        logEntries = [];
        Logger.prototype.error = (...parameters: unknown[]): void => {
            logEntries.push(parameters);
        };

        const fixture = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(ConfigService)
            .useValue(new ConfigService(validateEnvironment({ ...process.env, THROTTLE_LIMIT: 2 })))
            .compile();

        application = fixture.createNestApplication();
        application.useLogger(false);
        await application.init();
        filter = new AuthenticatedJsonRequestExceptionFilter(
            application.get(HttpAdapterHost),
            application.get(AuthenticationGuard),
            application.get(ThrottlerGuard),
        );
    });

    afterEach(async (): Promise<void> => {
        Logger.prototype.error = originalLogError;
        await application.close();
    });

    it('logs only fixed diagnostics for nested database errors and returns a generic 500', (): void => {
        const response = responseHost();
        const error = new DrizzleQueryError(
            'INSERT INTO private_records VALUES ($1, $2, $3)',
            ['private@example.com', '$argon2id$hash', 'clinical notes'],
            new Error('secret database URL and SQL'),
        );

        filter.catch(error, response.host);

        expect(response.response.statusCode).toBe(500);
        expect(response.response.body).toEqual({
            statusCode: 500,
            message: 'Internal server error',
        });
        expect(logEntries).toEqual([[{ event: 'unexpected_request_failed', status: 500 }]]);
    });

    it('exhausts the shared parser budget before invoking authentication again', async (): Promise<void> => {
        let authenticationCalls: number = 0;

        application.get(AuthenticationGuard).canActivate = (): Promise<boolean> => {
            authenticationCalls += 1;

            return Promise.resolve(true);
        };

        for (let requestNumber: number = 0; requestNumber < 3; requestNumber += 1) {
            const response = responseHost();

            filter.catch({ status: 400, message: 'sensitive malformed body' }, response.host);
            await new Promise<void>((resolve): void => {
                setImmediate(resolve);
            });

            expect(response.response.statusCode).toBe(requestNumber < 2 ? 400 : 429);

            if (requestNumber === 2) {
                expect(response.response.body).toEqual({
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: 'Too many requests',
                });
            }
        }

        expect(authenticationCalls).toBe(2);
    });

    it('authenticates parser failures on inherited protected HEAD routes', async (): Promise<void> => {
        const response = responseHost('/pets', 'HEAD');

        filter.catch({ status: 400 }, response.host);
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });

        expect(response.response.statusCode).toBe(401);
        expect(response.response.body).toEqual({
            code: 'UNAUTHENTICATED',
            message: 'Authentication is required',
        });
    });

    it('keeps liveness available and redacts readiness failures with a closed pool', async (): Promise<void> => {
        const controller: HealthCheckController = application.get(HealthCheckController);

        await application.get(DatabaseService).onApplicationShutdown();

        expect(controller.check()).toEqual({ status: 'ok' });
        await expect(controller.ready()).rejects.toMatchObject({
            response: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' },
            status: 503,
        });
        await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
        expect(logEntries).toEqual([
            [{ event: 'database_health_check_failed' }],
            [{ event: 'database_health_check_failed' }],
        ]);
    });

    it('redacts unexpected failures raised by parser authentication', async (): Promise<void> => {
        const response = responseHost();

        application.get(AuthenticationGuard).canActivate = (): Promise<boolean> =>
            Promise.reject(new Error('sensitive account SQL'));
        filter.catch({ status: 400 }, response.host);
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });

        expect(response.response.statusCode).toBe(500);
        expect(logEntries).toEqual([[{ event: 'unexpected_request_failed', status: 500 }]]);
    });
});
