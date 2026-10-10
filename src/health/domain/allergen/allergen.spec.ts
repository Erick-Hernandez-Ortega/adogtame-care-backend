import { Allergen } from './allergen';

describe('Allergen', () => {
    it('trims surrounding whitespace and preserves casing', () => {
        expect(Allergen.from('  Penicillin \n').value).toBe('Penicillin');
        expect(Allergen.from('chicken').value).toBe('chicken');
    });
    it('accepts the exact Unicode character limit', () => {
        expect(Allergen.from('🐕'.repeat(255)).value).toBe('🐕'.repeat(255));
    });
    it.each(['', ' \t\n', 'x'.repeat(256), '🐕'.repeat(256)])(
        'rejects invalid text %s',
        (value: string) => {
            expect(() => Allergen.from(value)).toThrow();
        },
    );
    it('rejects non-string runtime input', () => {
        expect(() => Allergen.from(null as unknown as string)).toThrow(TypeError);
    });
});
