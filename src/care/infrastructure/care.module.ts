import { UpdateCareRoutine } from '../application/update-care-routine/update-care-routine';
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
import { ListCareRoutines } from '../application/list-care-routines/list-care-routines';
import {
    CARE_ROUTINE_READER,
    type CareRoutineReader,
} from '../application/persistence/care-routine.reader';
import { DrizzleCareRoutineReader } from './persistence/drizzle/drizzle-care-routine.reader';

@Module({
    imports: [DatabaseModule, IdentityModule],
    controllers: [CareRoutinesController],
    providers: [
        {
            provide: UpdateCareRoutine,
            inject: [CARE_ROUTINE_REPOSITORY],
            useFactory: (repository: CareRoutineRepository): UpdateCareRoutine =>
                new UpdateCareRoutine(repository),
        },
        DrizzleCareRoutineReader,
        { provide: CARE_ROUTINE_READER, useExisting: DrizzleCareRoutineReader },
        {
            provide: ListCareRoutines,
            inject: [CARE_ROUTINE_READER],
            useFactory: (reader: CareRoutineReader): ListCareRoutines =>
                new ListCareRoutines(reader),
        },
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
