import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { errorSchema } from './openapi-error.schema';

export function createOpenApiDocument(application: INestApplication): OpenAPIObject {
    const config = new DocumentBuilder()
        .setTitle('Adogtame Care API')
        .setDescription('REST API for pet profiles, accounts, invitations, health, and care.')
        .setVersion('1.0')
        .addBearerAuth()
        .build();

    const document: OpenAPIObject = SwaggerModule.createDocument(application, config);

    for (const [path, entry] of Object.entries(document.paths)) {
        if (path === '/health' || path === '/health/live') {
            continue;
        }

        for (const method of ['get', 'post', 'patch', 'delete'] as const) {
            const operation = entry?.[method];

            if (operation !== undefined) {
                operation.responses['429'] = {
                    description:
                        'Request limit exceeded (source, login account, or readiness budget); retry after the Retry-After interval',
                    headers: {
                        'Retry-After': {
                            description: 'Seconds until requests may be retried',
                            schema: { type: 'integer', minimum: 1 },
                        },
                    },
                    content: {
                        'application/json': {
                            schema: errorSchema(['RATE_LIMIT_EXCEEDED'], 'Too many requests'),
                        },
                    },
                };
            }
        }
    }

    return document;
}

export function configureOpenApi(application: INestApplication): void {
    SwaggerModule.setup('docs', application, () => createOpenApiDocument(application));
}
