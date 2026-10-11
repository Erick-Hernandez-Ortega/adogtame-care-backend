import { generateUuid, isValidUuid, normalizeUuid } from './uuid';

const uuid: string = '550e8400-e29b-41d4-a716-446655440000';

describe('UUID utilities', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
        'accepts UUID version %s and either hexadecimal casing',
        (version: number) => {
            const value: string = `550e8400-e29b-${version}1d4-a716-446655440000`;

            expect(isValidUuid(value)).toBe(true);
            expect(isValidUuid(value.toUpperCase())).toBe(true);
        },
    );

    it.each([
        '',
        '00000000-0000-0000-0000-000000000000',
        '550e8400-e29b-01d4-a716-446655440000',
        '550e8400-e29b-91d4-a716-446655440000',
        '550e8400-e29b-41d4-c716-446655440000',
        '550e8400e29b41d4a716446655440000',
        ` ${uuid}`,
        `${uuid} `,
        `${uuid}\n`,
        `${uuid}\r`,
        `${uuid}extra`,
        null,
        undefined,
        1,
        {},
    ])('rejects invalid UUID input %s', (value: unknown) => {
        expect(isValidUuid(value as string)).toBe(false);
        expect(() => normalizeUuid(value as string, 'Pet ID')).toThrow(
            new TypeError('Pet ID must be a valid non-nil UUID'),
        );
    });

    it('normalizes valid UUIDs without trimming or changing the input', () => {
        const value: string = uuid.toUpperCase();

        expect(normalizeUuid(value, 'Account ID')).toBe(uuid);
        expect(value).toBe(uuid.toUpperCase());
    });

    it('generates independent UUID v4 values', () => {
        const identifiers: string[] = [generateUuid(), generateUuid(), generateUuid()];

        expect(new Set(identifiers).size).toBe(3);

        for (const identifier of identifiers) {
            expect(identifier).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
        }
    });
});
