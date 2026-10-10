import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureOpenApi(application: INestApplication): void {
    const config = new DocumentBuilder()
        .setTitle('Adogtame Care API')
        .setDescription('REST API for pet profiles, accounts, invitations, and health.')
        .setVersion('1.0')
        .addBearerAuth()
        .build();

    SwaggerModule.setup('docs', application, () =>
        SwaggerModule.createDocument(application, config),
    );
}
