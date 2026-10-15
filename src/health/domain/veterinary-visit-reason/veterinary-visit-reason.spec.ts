import { VeterinaryVisitReason } from './veterinary-visit-reason';

describe('VeterinaryVisitReason', () => {
    it('trims whitespace and preserves casing', () => {
        expect(VeterinaryVisitReason.from('  Chronic kidney disease  ').value).toBe(
            'Chronic kidney disease',
        );
    });
    it('counts Unicode code points at the limit', () => {
        expect(VeterinaryVisitReason.from('🐕'.repeat(255)).value).toBe('🐕'.repeat(255));
        expect(() => VeterinaryVisitReason.from('🐕'.repeat(256))).toThrow(RangeError);
    });
    it.each(['', ' ', '\t\n', 'x'.repeat(256)])('rejects invalid reason %s', (value: string) => {
        expect(() => VeterinaryVisitReason.from(value)).toThrow();
    });
    it.each([null, undefined, 1, {}, []])(
        'rejects non-string runtime input %s',
        (value: unknown) => {
            expect(() => VeterinaryVisitReason.from(value as string)).toThrow(TypeError);
        },
    );
});
