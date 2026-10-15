import { isValidCivilDate } from '../../../shared/domain/civil-date';

export class ActivityCompletedAt {
    private constructor(readonly value: string) {}

    static from(value: string, now: Date): ActivityCompletedAt {
        const completedAt: ActivityCompletedAt = ActivityCompletedAt.reconstitute(value);

        if (!Number.isFinite(now.getTime())) {
            throw new TypeError('Current instant must be valid');
        }

        if (Date.parse(completedAt.value) > now.getTime()) {
            throw new RangeError('Activity completedAt cannot be in the future');
        }

        return completedAt;
    }

    static reconstitute(value: string): ActivityCompletedAt {
        if (
            typeof value !== 'string' ||
            value !== value.trim() ||
            !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) ||
            !isValidCivilDate(value.slice(0, 10))
        ) {
            throw new TypeError('Activity completedAt must be a valid UTC instant ending in Z');
        }

        return new ActivityCompletedAt(new Date(value).toISOString());
    }
}
