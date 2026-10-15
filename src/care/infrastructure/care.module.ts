import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../../identity/infrastructure/identity.module';
import { CreateCareRoutine } from '../application/create-care-routine/create-care-routine';
import {
    CARE_ROUTINE_REPOSITORY,
    type CareRoutineRepository,
} from '../application/persistence/care-routine.repository';
import { DrizzleCareRoutineRepository } from './persistence/drizzle/drizzle-care-routine.repository';
import { CareRoutinesController } from './http/controllers/care-routines.controller';

@Module({
    imports: [DatabaseModule, IdentityModule],
    controllers: [CareRoutinesController],
    providers: [
        DrizzleCareRoutineRepository,
        { provide: CARE_ROUTINE_REPOSITORY, useExisting: DrizzleCareRoutineRepository },
        {
            provide: CreateCareRoutine,
            inject: [CARE_ROUTINE_REPOSITORY],
            useFactory: (repository: CareRoutineRepository): CreateCareRoutine =>
                new CreateCareRoutine(repository),
        },
    ],
})
export class CareModule {}
