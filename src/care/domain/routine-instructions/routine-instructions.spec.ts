import { RoutineInstructions } from './routine-instructions';

describe('RoutineInstructions', () => {
    it('trims text, preserves casing and counts Unicode code points', () => {
        expect(RoutineInstructions.from('  Give Food  ').value).toBe('Give Food');
        expect(RoutineInstructions.from('🐕'.repeat(2000)).value).toBe('🐕'.repeat(2000));
    });

    it.each(['', ' ', '\t\n', '🐕'.repeat(2001), null, undefined, 42, {}])(
        'rejects invalid text %s',
        (value: unknown) => {
            expect(() => RoutineInstructions.from(value as string)).toThrow();
        },
    );
});
