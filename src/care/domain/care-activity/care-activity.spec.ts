import { CareActivity, CareActivityId, CompletedByAccountId } from './care-activity';
import { CareRoutineId, PetId } from '../care-routine/care-routine';
import { ActivityCompletedAt } from '../activity-completed-at/activity-completed-at';
import { ActivityTimezone } from '../activity-timezone/activity-timezone';
import { ActivityNotes } from '../activity-notes/activity-notes';

const identifier: string = '10000000-0000-4000-8000-000000000001';

function input() {
    return {
        petId: PetId.from(identifier),
        routineId: CareRoutineId.from(identifier),
        completedBy: CompletedByAccountId.from(identifier),
        completedAt: ActivityCompletedAt.reconstitute('2026-10-15T01:00:00Z'),
        timezone: ActivityTimezone.from('America/Mexico_City'),
    };
}

describe('CareActivity', () => {
    it('creates independent identities and reconstitutes historical facts', () => {
        const first: CareActivity = CareActivity.create(input());
        const second: CareActivity = CareActivity.create(input());

        expect(first.id.value).not.toBe(second.id.value);
        expect(first.notes).toBeNull();
        expect(CareActivity.reconstitute({ ...first })).toEqual(first);
        expect(
            CareActivity.create({ ...input(), notes: ActivityNotes.from(' Done ') }).notes?.value,
        ).toBe('Done');
    });

    it.each([
        ['America/Mexico_City', '2026-10-14'],
        ['UTC', '2026-10-15'],
        ['Asia/Tokyo', '2026-10-15'],
    ])('computes local day in recorder timezone %s', (timezone: string, day: string) => {
        const activity: CareActivity = CareActivity.create({
            ...input(),
            timezone: ActivityTimezone.from(timezone),
        });

        expect(activity.localDay).toBe(day);
    });

    it('uses timezone rules across daylight saving transitions', () => {
        for (const completedAt of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) {
            expect(
                CareActivity.create({
                    ...input(),
                    completedAt: ActivityCompletedAt.reconstitute(completedAt),
                    timezone: ActivityTimezone.from('America/New_York'),
                }).localDay,
            ).toBe('2026-11-01');
        }
    });

    it('rejects invalid runtime value objects and identifiers', () => {
        for (const field of [
            'petId',
            'routineId',
            'completedBy',
            'completedAt',
            'timezone',
            'notes',
        ]) {
            expect(() => CareActivity.create({ ...input(), [field]: 'invalid' })).toThrow(
                TypeError,
            );
        }

        expect(() => CareActivityId.from('bad')).toThrow(TypeError);
        expect(() => CompletedByAccountId.from('00000000-0000-0000-0000-000000000000')).toThrow(
            TypeError,
        );
    });
});
