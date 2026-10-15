import { CareRoutineType, RoutineType } from './routine-type';

describe('CareRoutineType', () => {
    it.each(Object.values(RoutineType))('supports %s', (value: RoutineType) => {
        expect(CareRoutineType.from(value).value).toBe(value);
    });

    it.each(['feeding', 'OTHER ', 'MEDICATION', '', null, undefined, 1])(
        'rejects unsupported types %s',
        (value: unknown) => {
            expect(() => CareRoutineType.from(value as string)).toThrow(TypeError);
        },
    );
});
