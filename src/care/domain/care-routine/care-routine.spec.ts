import { RoutineFrequency } from '../routine-frequency/routine-frequency';
import { RoutineInstructions } from '../routine-instructions/routine-instructions';
import { RoutineTimezone } from '../routine-timezone/routine-timezone';
import { RoutineTitle } from '../routine-title/routine-title';
import { CareRoutineType } from '../routine-type/routine-type';
import { CareRoutine, CareRoutineId, PetId, RecordedByAccountId } from './care-routine';

function input() {
    return {
        petId: PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12'),
        type: CareRoutineType.from('FEEDING'),
        title: RoutineTitle.from('Morning feeding'),
        frequency: RoutineFrequency.from({
            period: 'DAILY',
            timesPerPeriod: 2,
            suggestedTimes: ['08:00', '20:00'],
        }),
        timezone: RoutineTimezone.from('America/Mexico_City'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440000'),
    };
}

describe('CareRoutine', () => {
    it('creates independent identity and reconstitutes all routine data', () => {
        const routine: CareRoutine = CareRoutine.create({
            ...input(),
            instructions: RoutineInstructions.from(' Give with water '),
        });

        expect(CareRoutineId.from(routine.id.value)).toEqual(routine.id);
        expect(CareRoutine.create(input()).id).not.toEqual(routine.id);
        expect(routine).toMatchObject(input());
        expect(routine.instructions?.value).toBe('Give with water');
        expect(CareRoutine.reconstitute({ ...routine })).toEqual(routine);
    });

    it.each([undefined, null])(
        'represents absent instructions as null (%s)',
        (instructions: null | undefined) => {
            expect(CareRoutine.create({ ...input(), instructions }).instructions).toBeNull();
        },
    );

    it('changes timezone without converting wall-clock suggestions or changing identity and authorship', () => {
        const routine: CareRoutine = CareRoutine.create(input());
        const changed: CareRoutine = routine.changeTimezone(
            RoutineTimezone.from('America/New_York'),
        );

        expect(changed).not.toBe(routine);
        expect(changed).toMatchObject({
            ...routine,
            timezone: RoutineTimezone.from('America/New_York'),
        });
        expect(changed.frequency.suggestedTimes).toEqual(['08:00', '20:00']);
        expect(routine.timezone.value).toBe('America/Mexico_City');
        expect(changed.changeTimezone(RoutineTimezone.from('America/New_York'))).toBe(changed);
        expect(() => routine.changeTimezone('UTC' as unknown as RoutineTimezone)).toThrow(
            TypeError,
        );
    });

    it.each([
        'id',
        'petId',
        'type',
        'title',
        'frequency',
        'timezone',
        'recordedByAccountId',
        'instructions',
    ])('rejects invalid runtime %s during reconstitution', (field: string) => {
        const routine: CareRoutine = CareRoutine.create(input());

        expect(() => CareRoutine.reconstitute({ ...routine, [field]: 'invalid' })).toThrow(
            TypeError,
        );
    });

    it.each([CareRoutineId, PetId, RecordedByAccountId])(
        'validates and normalizes identities',
        (Identifier) => {
            const identifier: string = '550E8400-E29B-41D4-A716-446655440000';

            expect(Identifier.from(identifier).value).toBe(identifier.toLowerCase());

            for (const value of [
                'bad',
                '00000000-0000-0000-0000-000000000000',
                identifier + '\n',
            ]) {
                expect(() => Identifier.from(value)).toThrow(TypeError);
            }
        },
    );

    it('corrects supplied fields and preserves identity, author and omitted facts', () => {
        const routine: CareRoutine = CareRoutine.create({
            ...input(),
            instructions: RoutineInstructions.from('Original'),
        });
        const corrected: CareRoutine = routine.correct({
            type: 'WALK',
            title: '  Evening walk ',
            instructions: null,
            timezone: 'UTC',
        });

        expect(corrected).toMatchObject({
            ...routine,
            type: CareRoutineType.from('WALK'),
            title: RoutineTitle.from('Evening walk'),
            instructions: null,
            timezone: RoutineTimezone.from('UTC'),
        });
        expect(corrected.frequency).toBe(routine.frequency);
        expect(routine.instructions?.value).toBe('Original');
        expect(
            corrected.correct({ title: ' Evening walk ', timezone: 'Etc/UTC', instructions: null }),
        ).toBe(corrected);
    });

    it('replaces complete frequency, preserving order and duplicates for equality', () => {
        const routine: CareRoutine = CareRoutine.create(input());
        const frequency = {
            period: 'WEEKLY',
            timesPerPeriod: 3,
            suggestedTimes: ['20:00', '08:00', '08:00'],
            weekdays: ['SUNDAY', 'MONDAY'],
        };
        const corrected: CareRoutine = routine.correct({ frequency });

        expect(corrected.frequency).toEqual(RoutineFrequency.from(frequency));
        expect(corrected.correct({ frequency })).toBe(corrected);
        expect(
            corrected.correct({
                frequency: { ...frequency, suggestedTimes: ['08:00', '20:00', '08:00'] },
            }),
        ).not.toBe(corrected);
        expect(
            corrected.correct({ frequency: { period: 'DAILY', timesPerPeriod: 1 } }).frequency
                .suggestedTimes,
        ).toEqual([]);
    });

    it.each([
        {},
        { type: 'MEDICATION' },
        { title: ' ' },
        { title: '🐕'.repeat(256) },
        { instructions: '' },
        { instructions: '🐕'.repeat(2001) },
        { frequency: { period: 'DAILY', timesPerPeriod: 0 } },
        { frequency: { period: 'DAILY', timesPerPeriod: 1, weekdays: ['MONDAY'] } },
        { frequency: { period: 'WEEKLY', timesPerPeriod: 1, suggestedTimes: ['24:00'] } },
        { timezone: '+01:00' },
    ])('rejects invalid corrections without modifying the original (%j)', (correction) => {
        const routine: CareRoutine = CareRoutine.create(input());

        expect(() => routine.correct(correction)).toThrow(TypeError);
        expect(routine).toMatchObject(input());
    });

    it('accepts Unicode boundaries and canonical equivalent frequency', () => {
        const routine: CareRoutine = CareRoutine.create(input());
        const corrected: CareRoutine = routine.correct({
            title: '🐕'.repeat(255),
            instructions: '🐕'.repeat(2000),
        });

        expect(corrected.title.value).toBe('🐕'.repeat(255));
        expect(routine.correct({ frequency: { ...routine.frequency } })).toBe(routine);
    });
});
