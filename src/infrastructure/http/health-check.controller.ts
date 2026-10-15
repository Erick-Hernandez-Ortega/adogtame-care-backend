import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseService } from '../database/database.service';
import { ReadinessRateLimit } from './rate-limiting';
import { errorSchema } from './openapi-error.schema';

interface HealthCheckResponse {
    status: 'ok';
}

@SkipThrottle({ default: true, auth: true })
@Controller('health')
@ApiTags('Application')
export class HealthCheckController {
    private readonly logger: Logger = new Logger(HealthCheckController.name);

    constructor(private readonly databaseService: DatabaseService) {}

    @Get(['', 'live'])
    @ApiOperation({ summary: 'Check application liveness without accessing the database' })
    @ApiOkResponse({
        description: 'Application is running',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', enum: ['ok'] } },
        },
    })
    check(): HealthCheckResponse {
        return { status: 'ok' };
    }

    @Get('ready')
    @ReadinessRateLimit()
    @ApiOperation({ summary: 'Check application and database connectivity' })
    @ApiOkResponse({
        description: 'Database connection is available',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', enum: ['ok'] } },
        },
    })
    @ApiResponse({
        status: 503,
        description: 'Database connection is unavailable',
        schema: errorSchema(['DATABASE_UNAVAILABLE'], 'Database is unavailable'),
    })
    async ready(): Promise<HealthCheckResponse> {
        try {
            await this.databaseService.checkReadiness();
        } catch {
            this.logger.error({ event: 'database_health_check_failed' });

            throw new ServiceUnavailableException({
                code: 'DATABASE_UNAVAILABLE',
                message: 'Database is unavailable',
            });
        }

        return { status: 'ok' };
    }
}
