import { normalizeRequiredText } from './text';

describe('Required text normalization', () => {
    it('trims surrounding whitespace and preserves casing and internal content', () => {
        expect(
            normalizeRequiredText(
                '  Amoxicillin  250 mg\nGive with food  ',
                'Medication notes',
                2000,
            ),
        ).toBe('Amoxicillin  250 mg\nGive with food');
    });

    it.each([255, 2000])(
        'counts Unicode code points after trimming at limit %s',
        (maxLength: number) => {
            const text: string = '🐕'.repeat(maxLength);

            expect(normalizeRequiredText(` ${text} `, 'Text', maxLength)).toBe(text);
            expect(() => normalizeRequiredText(`${text}🐕`, 'Text', maxLength)).toThrow(
                new RangeError(`Text must have at most ${maxLength} characters`),
            );
        },
    );

    it.each(['', ' ', '\t\n'])('rejects text empty after trimming %s', (value: string) => {
        expect(() => normalizeRequiredText(value, 'Medication name', 255)).toThrow(
            new TypeError('Medication name cannot be empty'),
        );
    });

    it.each([null, undefined, 1, {}, []])(
        'rejects nonstring values %s without treating them as absence',
        (value: unknown) => {
            expect(() => normalizeRequiredText(value as string, 'Medication dosage', 2000)).toThrow(
                new TypeError('Medication dosage must be a string'),
            );
        },
    );
});
