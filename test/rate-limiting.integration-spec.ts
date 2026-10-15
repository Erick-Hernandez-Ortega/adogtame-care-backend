import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ThrottlerException, ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';
import { AccountsController } from '../src/identity/infrastructure/http/controllers/accounts.controller';
import { AuthController } from '../src/identity/infrastructure/http/controllers/auth.controller';
import type { EnvironmentVariables } from '../src/infrastructure/config/environment.validation';
import { HealthCheckController } from '../src/infrastructure/http/health-check.controller';
import { rateLimitingOptions } from '../src/infrastructure/http/rate-limiting';

// Exercise real guard metadata and storage without requiring an HTTP listening socket.
describe('Rate limiting (integration)', () => {
    const originalDateNow: () => number = Date.now;
    let currentTime: number;
    let storage: ThrottlerStorageService;
    let guard: ThrottlerGuard;
    const configuration: ConfigService<EnvironmentVariables, true> = new ConfigService({
        THROTTLE_LIMIT: 100,
        AUTH_THROTTLE_LIMIT: 10,
        READINESS_THROTTLE_LIMIT: 10,
        LOGIN_ACCOUNT_THROTTLE_LIMIT: 10,
    });

    function loginContext(ip: string, email?: string): ExecutionContextHost {
        return new ExecutionContextHost(
            [{ ip, body: { email } }, { header: (): void => {} }],
            AuthController,
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflection requires the original handler; the context does not invoke it.
            AuthController.prototype.login,
        );
    }

    function registrationContext(ip: string): ExecutionContextHost {
        return new ExecutionContextHost(
            [{ ip }, { header: (): void => {} }],
            AccountsController,
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflection requires the original handler; the context does not invoke it.
            AccountsController.prototype.create,
        );
    }

    beforeEach(async (): Promise<void> => {
        currentTime = originalDateNow();
        Date.now = (): number => currentTime;
        storage = new ThrottlerStorageService();
        const reflector: Reflector = new Reflector();

        guard = new ThrottlerGuard(
            rateLimitingOptions(configuration, reflector),
            storage,
            reflector,
        );
        await guard.onModuleInit();
    });

    afterEach((): void => {
        storage.onApplicationShutdown();
        Date.now = originalDateNow;
    });

    it('limits each auth endpoint to ten requests per IP and permits retries after expiry', async (): Promise<void> => {
        for (let requestNumber: number = 0; requestNumber < 10; requestNumber += 1) {
            await expect(guard.canActivate(loginContext('192.0.2.1'))).resolves.toBe(true);
            await expect(guard.canActivate(registrationContext('192.0.2.1'))).resolves.toBe(true);
        }

        await expect(guard.canActivate(loginContext('192.0.2.1'))).rejects.toBeInstanceOf(
            ThrottlerException,
        );
        await expect(guard.canActivate(registrationContext('192.0.2.1'))).rejects.toBeInstanceOf(
            ThrottlerException,
        );
        await expect(guard.canActivate(loginContext('192.0.2.2'))).resolves.toBe(true);

        currentTime += 60_001;

        await expect(guard.canActivate(loginContext('192.0.2.1'))).resolves.toBe(true);
        await expect(guard.canActivate(registrationContext('192.0.2.1'))).resolves.toBe(true);
    });

    it('shares IPv6 /64 budgets while preserving other subnet and IPv4 isolation', async (): Promise<void> => {
        for (let requestNumber: number = 0; requestNumber < 10; requestNumber += 1) {
            await guard.canActivate(loginContext(`2001:db8:1:2::${requestNumber + 1}`));
        }

        await expect(
            guard.canActivate(loginContext('2001:db8:1:2:ffff::1')),
        ).rejects.toBeInstanceOf(ThrottlerException);
        await expect(guard.canActivate(loginContext('2001:db8:1:3::1'))).resolves.toBe(true);
        await expect(guard.canActivate(loginContext('192.0.2.1'))).resolves.toBe(true);
    });

    it('limits normalized login emails across sources and permits other accounts and expiry', async (): Promise<void> => {
        for (let requestNumber: number = 1; requestNumber <= 10; requestNumber += 1) {
            await guard.canActivate(loginContext(`192.0.2.${requestNumber}`, ' Alex@Example.COM '));
        }

        await expect(
            guard.canActivate(loginContext('192.0.2.20', 'alex@example.com')),
        ).rejects.toBeInstanceOf(ThrottlerException);
        await expect(
            guard.canActivate(loginContext('192.0.2.20', 'other@example.com')),
        ).resolves.toBe(true);
        currentTime += 60_001;
        await expect(
            guard.canActivate(loginContext('192.0.2.20', 'alex@example.com')),
        ).resolves.toBe(true);
    });

    it('applies a separate small readiness budget', async (): Promise<void> => {
        const context: ExecutionContextHost = new ExecutionContextHost(
            [{ ip: '192.0.2.1' }, { header: (): void => {} }],
            HealthCheckController,
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Metadata only.
            HealthCheckController.prototype.ready,
        );

        for (let requestNumber: number = 0; requestNumber < 10; requestNumber += 1) {
            await expect(guard.canActivate(context)).resolves.toBe(true);
        }

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ThrottlerException);
        await expect(guard.canActivate(loginContext('192.0.2.1'))).resolves.toBe(true);
    });

    it('shares the global budget across endpoints and always exempts health', async (): Promise<void> => {
        const options = rateLimitingOptions(configuration, new Reflector());

        if (Array.isArray(options)) {
            throw new Error('Expected named throttler options');
        }

        for (const throttler of options.throttlers) {
            if (throttler.name === 'auth') {
                throttler.limit = 1000;
            }
        }

        guard = new ThrottlerGuard(options, storage, new Reflector());
        await guard.onModuleInit();
        const healthContext: ExecutionContextHost = new ExecutionContextHost(
            [{ ip: '192.0.2.1' }, { header: (): void => {} }],
            HealthCheckController,
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflection requires the original handler; the context does not invoke it.
            HealthCheckController.prototype.check,
        );

        for (let requestNumber: number = 0; requestNumber < 50; requestNumber += 1) {
            await expect(guard.canActivate(loginContext('192.0.2.1'))).resolves.toBe(true);
            await expect(guard.canActivate(registrationContext('192.0.2.1'))).resolves.toBe(true);
            await expect(guard.canActivate(healthContext)).resolves.toBe(true);
        }

        await expect(guard.canActivate(loginContext('192.0.2.1'))).rejects.toBeInstanceOf(
            ThrottlerException,
        );
        await expect(guard.canActivate(registrationContext('192.0.2.1'))).rejects.toBeInstanceOf(
            ThrottlerException,
        );
        await expect(guard.canActivate(healthContext)).resolves.toBe(true);
    });
});
