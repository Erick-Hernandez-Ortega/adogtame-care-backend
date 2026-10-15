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
});
