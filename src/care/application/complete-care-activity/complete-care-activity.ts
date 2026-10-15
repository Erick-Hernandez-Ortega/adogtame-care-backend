import { CareActivity, CompletedByAccountId } from '../../domain/care-activity/care-activity';
import { CareRoutineId, PetId } from '../../domain/care-routine/care-routine';
import { ActivityCompletedAt } from '../../domain/activity-completed-at/activity-completed-at';
import { ActivityTimezone } from '../../domain/activity-timezone/activity-timezone';
import { ActivityNotes } from '../../domain/activity-notes/activity-notes';
import type {
    CareActivityRepository,
    CreateCareActivityOutcome,
} from '../persistence/care-activity.repository';
import type { Clock } from '../time/clock';

export interface CompleteCareActivityCommand {
    petId: string;
    routineId: string;
    authenticatedAccountId: string;
    completedAt: string;
    timezone: string;
    notes?: string | null;
}

export interface CompletedCareActivity {
    id: string;
    petId: string;
    routineId: string;
    completedAt: string;
    completedBy: string;
    timezone: string;
    notes: string | null;
}

export class InvalidActivityCompletedAtError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}
export class InvalidActivityTimezoneError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}
export class InvalidActivityNotesError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}
export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}
export class CareRoutineNotFoundError extends Error {
    constructor() {
        super('Care routine was not found');
    }
}

export class CompleteCareActivity {
    constructor(
        private readonly repository: CareActivityRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: CompleteCareActivityCommand): Promise<CompletedCareActivity> {
        const now: Date = this.clock.now();
        let completedAt: ActivityCompletedAt;

        try {
            completedAt = ActivityCompletedAt.from(command.completedAt, now);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidActivityCompletedAtError(error);
            }

            throw error;
        }

        let timezone: ActivityTimezone;

        try {
            timezone = ActivityTimezone.from(command.timezone);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidActivityTimezoneError(error);
            }

            throw error;
        }

        let notes: ActivityNotes | null;

        try {
            notes = command.notes == null ? null : ActivityNotes.from(command.notes);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidActivityNotesError(error);
            }

            throw error;
        }

        let activity: CareActivity;

        try {
            activity = CareActivity.create({
                petId: PetId.from(command.petId),
                routineId: CareRoutineId.from(command.routineId),
                completedAt,
                timezone,
                notes,
                completedBy: CompletedByAccountId.from(command.authenticatedAccountId),
            });
        } catch (error: unknown) {
            if (error instanceof RangeError) {
                throw new InvalidActivityCompletedAtError(error);
            }

            throw error;
        }

        const outcome: CreateCareActivityOutcome = await this.repository.createIfPetWritable(
            activity,
            command.authenticatedAccountId,
        );

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome === 'CARE_ROUTINE_NOT_FOUND') {
            throw new CareRoutineNotFoundError();
        }

        return {
            id: activity.id.value,
            petId: activity.petId.value,
            routineId: activity.routineId.value,
            completedAt: activity.completedAt.value,
            completedBy: activity.completedBy.value,
            timezone: activity.timezone.value,
            notes: activity.notes?.value ?? null,
        };
    }
}
