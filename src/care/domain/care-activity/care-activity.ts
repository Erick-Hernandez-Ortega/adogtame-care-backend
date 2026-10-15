import { generateUuid, normalizeUuid } from '../../../shared/domain/uuid';
import { CareRoutineId, PetId } from '../care-routine/care-routine';
import { ActivityCompletedAt } from '../activity-completed-at/activity-completed-at';
import { ActivityTimezone } from '../activity-timezone/activity-timezone';
import { ActivityNotes } from '../activity-notes/activity-notes';

export class CareActivityId {
    private constructor(readonly value: string) {}

    static from(value: string): CareActivityId {
        return new CareActivityId(normalizeUuid(value, 'Care activity ID'));
    }

    static generate(): CareActivityId {
        return new CareActivityId(generateUuid());
    }
}

export class CompletedByAccountId {
    private constructor(readonly value: string) {}

    static from(value: string): CompletedByAccountId {
        return new CompletedByAccountId(normalizeUuid(value, 'Account ID'));
    }
}

interface CreateCareActivityInput {
    petId: PetId;
    routineId: CareRoutineId;
    completedAt: ActivityCompletedAt;
    completedBy: CompletedByAccountId;
    timezone: ActivityTimezone;
    notes?: ActivityNotes | null;
}

interface ReconstituteCareActivityInput extends CreateCareActivityInput {
    id: CareActivityId;
}

export class CareActivity {
    private constructor(
        readonly id: CareActivityId,
        readonly petId: PetId,
        readonly routineId: CareRoutineId,
        readonly completedAt: ActivityCompletedAt,
        readonly completedBy: CompletedByAccountId,
        readonly timezone: ActivityTimezone,
        readonly notes: ActivityNotes | null,
    ) {}

    static create(input: CreateCareActivityInput): CareActivity {
        return CareActivity.reconstitute({ ...input, id: CareActivityId.generate() });
    }

    static reconstitute(input: ReconstituteCareActivityInput): CareActivity {
        if (
            !(input.id instanceof CareActivityId) ||
            !(input.petId instanceof PetId) ||
            !(input.routineId instanceof CareRoutineId) ||
            !(input.completedAt instanceof ActivityCompletedAt) ||
            !(input.completedBy instanceof CompletedByAccountId) ||
            !(input.timezone instanceof ActivityTimezone) ||
            (input.notes != null && !(input.notes instanceof ActivityNotes))
        ) {
            throw new TypeError('Care activity data is invalid');
        }

        return new CareActivity(
            input.id,
            input.petId,
            input.routineId,
            input.completedAt,
            input.completedBy,
            input.timezone,
            input.notes ?? null,
        );
    }

    get localDay(): string {
        const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('en', {
            timeZone: this.timezone.value,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date(this.completedAt.value));
        const part = (name: string): string =>
            parts.find((item): boolean => item.type === name)?.value ?? '';

        return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
    }
}
