import { SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../config/environment.validation';

const authenticationEndpoint: string = 'security:authentication-endpoint';

export function AuthenticationRateLimit(): MethodDecorator {
    return SetMetadata(authenticationEndpoint, true);
}

export function rateLimitingOptions(
    configuration: ConfigService<EnvironmentVariables, true>,
    reflector: Reflector,
): ThrottlerModuleOptions {
    return {
        ipv6SubnetPrefix: 128,
        throttlers: [
            {
                name: 'default',
                ttl: 60_000,
                limit: configuration.getOrThrow('THROTTLE_LIMIT', { infer: true }),
                generateKey: (_context, tracker: string): string => `global:${tracker}`,
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
