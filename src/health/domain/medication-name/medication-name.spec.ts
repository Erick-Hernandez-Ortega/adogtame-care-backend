import { MedicationName } from './medication-name';

describe('MedicationName', () => {
    it('trims whitespace and preserves casing', () => {
        expect(MedicationName.from('  Amoxicillin  ').value).toBe('Amoxicillin');
    });
    it('counts Unicode code points at the limit', () => {
        expect(MedicationName.from('🐕'.repeat(255)).value).toBe('🐕'.repeat(255));
        expect(() => MedicationName.from('🐕'.repeat(256))).toThrow(RangeError);
    });
    it.each(['', ' ', '\t\n', 'x'.repeat(256)])('rejects invalid name %s', (value: string) => {
        expect(() => MedicationName.from(value)).toThrow();
    });
    it.each([null, undefined, 1, {}, []])(
        'rejects non-string runtime input %s',
        (value: unknown) => {
            expect(() => MedicationName.from(value as string)).toThrow(TypeError);
        },
    );
});
