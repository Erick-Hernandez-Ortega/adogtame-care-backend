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

    it.each(['America/New_York', 'America/Mexico_City', 'Etc/GMT+1'])(
        'rejects a local date in the preceding era in %s on creation and reconstitution',
        (timezone: string) => {
            const facts = {
                ...input(),
                completedAt: ActivityCompletedAt.reconstitute('0001-01-01T00:00:00Z'),
                timezone: ActivityTimezone.from(timezone),
            };

            expect(() => CareActivity.create(facts)).toThrow(RangeError);
            expect(() =>
                CareActivity.reconstitute({ ...facts, id: CareActivityId.from(identifier) }),
            ).toThrow(RangeError);
        },
    );

    it.each([
        ['0001-01-01T00:00:00Z', 'UTC', '0001-01-01'],
        ['0001-01-01T00:00:00Z', 'Asia/Tokyo', '0001-01-01'],
        ['0001-01-01T00:59:59.999Z', 'Etc/GMT+1', null],
        ['0001-01-01T01:00:00Z', 'Etc/GMT+1', '0001-01-01'],
        ['0001-01-01T12:00:00Z', 'America/New_York', '0001-01-01'],
        ['9999-12-31T23:59:59.999Z', 'Asia/Tokyo', null],
        ['9999-12-31T23:59:59.999Z', 'UTC', '9999-12-31'],
    ])(
        'validates local civil boundaries for %s in %s',
        (instant: string, timezone: string, localDay: string | null) => {
            const create = (): CareActivity =>
                CareActivity.create({
                    ...input(),
                    completedAt: ActivityCompletedAt.reconstitute(instant),
                    timezone: ActivityTimezone.from(timezone),
                });

            if (localDay === null) {
                expect(create).toThrow(RangeError);
            } else {
                expect(create().localDay).toBe(localDay);
            }
        },
    );

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
