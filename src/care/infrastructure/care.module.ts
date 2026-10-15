import { ListCareActivities } from '../application/list-care-activities/list-care-activities';
import {
    CARE_ACTIVITY_READER,
    type CareActivityReader,
} from '../application/persistence/care-activity.reader';
import { DrizzleCareActivityReader } from './persistence/drizzle/drizzle-care-activity.reader';
import { CareActivityHistoryController } from './http/controllers/care-activity-history.controller';
import { CompleteCareActivity } from '../application/complete-care-activity/complete-care-activity';
import {
    CARE_ACTIVITY_REPOSITORY,
    type CareActivityRepository,
} from '../application/persistence/care-activity.repository';
import { CARE_CLOCK, type Clock } from '../application/time/clock';
import { DrizzleCareActivityRepository } from './persistence/drizzle/drizzle-care-activity.repository';
import { CareActivitiesController } from './http/controllers/care-activities.controller';
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
    controllers: [CareRoutinesController, CareActivitiesController, CareActivityHistoryController],
    providers: [
        DrizzleCareActivityReader,
        { provide: CARE_ACTIVITY_READER, useExisting: DrizzleCareActivityReader },
        {
            provide: ListCareActivities,
            inject: [CARE_ACTIVITY_READER],
            useFactory: (reader: CareActivityReader): ListCareActivities =>
                new ListCareActivities(reader),
        },
        DrizzleCareActivityRepository,
        { provide: CARE_ACTIVITY_REPOSITORY, useExisting: DrizzleCareActivityRepository },
        { provide: CARE_CLOCK, useValue: { now: (): Date => new Date() } satisfies Clock },
        {
            provide: CompleteCareActivity,
            inject: [CARE_ACTIVITY_REPOSITORY, CARE_CLOCK],
            useFactory: (repository: CareActivityRepository, clock: Clock): CompleteCareActivity =>
                new CompleteCareActivity(repository, clock),
        },
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
