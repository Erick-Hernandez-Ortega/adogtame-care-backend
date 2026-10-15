import { RoutineTitle } from './routine-title';

describe('RoutineTitle', () => {
    it('trims text, preserves casing and counts Unicode code points', () => {
        expect(RoutineTitle.from('  Give Food  ').value).toBe('Give Food');
        expect(RoutineTitle.from('🐕'.repeat(255)).value).toBe('🐕'.repeat(255));
    });

    it.each(['', ' ', '\t\n', '🐕'.repeat(256), null, undefined, 42, {}])(
        'rejects invalid text %s',
        (value: unknown) => {
            expect(() => RoutineTitle.from(value as string)).toThrow();
        },
    );
});
