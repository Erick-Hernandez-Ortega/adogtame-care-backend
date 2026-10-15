import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

export function configureSecurityHeaders(application: INestApplication): void {
    application.use(helmet());
}
