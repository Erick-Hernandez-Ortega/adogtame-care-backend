import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { Email } from '../../identity/domain/email/email';
import { SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../config/environment.validation';

const loginEndpoint: string = 'security:login-endpoint';
const readinessEndpoint: string = 'security:readiness-endpoint';

export function LoginRateLimit(): MethodDecorator {
    return SetMetadata(loginEndpoint, true);
}

export function ReadinessRateLimit(): MethodDecorator {
    return SetMetadata(readinessEndpoint, true);
}

function loginEmail(request: Request): string | null {
    const body: unknown = request.body;

    if (
        typeof body !== 'object' ||
        body === null ||
        !('email' in body) ||
        typeof body.email !== 'string' ||
        body.email.length > 508
    ) {
        return null;
    }

    try {
        return Email.from(body.email).value;
    } catch {
        return null;
    }
}

const authenticationEndpoint: string = 'security:authentication-endpoint';

export function AuthenticationRateLimit(): MethodDecorator {
    return SetMetadata(authenticationEndpoint, true);
}

export function rateLimitingOptions(
    configuration: ConfigService<EnvironmentVariables, true>,
    reflector: Reflector,
): ThrottlerModuleOptions {
    return {
        ipv6SubnetPrefix: 64,
        throttlers: [
            {
                name: 'readiness',
                ttl: 60_000,
                limit: configuration.getOrThrow('READINESS_THROTTLE_LIMIT', { infer: true }),
                skipIf: (context): boolean =>
                    !reflector.get<boolean>(readinessEndpoint, context.getHandler()),
            },
            {
                name: 'default',
                ttl: 60_000,
                limit: configuration.getOrThrow('THROTTLE_LIMIT', { infer: true }),
                generateKey: (_context, tracker: string): string => `global:${tracker}`,
            },
            {
                name: 'account',
                ttl: 60_000,
                limit: configuration.getOrThrow('LOGIN_ACCOUNT_THROTTLE_LIMIT', { infer: true }),
                skipIf: (context): boolean =>
                    !reflector.get<boolean>(loginEndpoint, context.getHandler()) ||
                    loginEmail(context.switchToHttp().getRequest<Request>()) === null,
                getTracker: (request: Request): Promise<string> =>
                    Promise.resolve(
                        createHash('sha256')
                            .update(loginEmail(request) ?? '')
                            .digest('hex'),
                    ),
                generateKey: (_context, tracker: string): string => `login-account:${tracker}`,
            },
            {
                name: 'auth',
                ttl: 60_000,
                limit: configuration.getOrThrow('AUTH_THROTTLE_LIMIT', { infer: true }),
                skipIf: (context): boolean =>
                    !reflector.get<boolean>(authenticationEndpoint, context.getHandler()),
            },
        ],
    };
}
