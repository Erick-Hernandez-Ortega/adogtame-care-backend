import { Weight } from './weight';

describe('Weight', () => {
    it.each([
        ['1', '1'],
        ['1.5', '1.5'],
        ['12.34', '12.34'],
        ['12.3456', '12.3456'],
        ['0.0001', '0.0001'],
        ['012.3400', '12.34'],
        ['0001.0000', '1'],
    ])('preserves the exact decimal value of %s as %s', (input, expected) => {
        expect(Weight.fromKilograms(input).kilograms).toBe(expected);
    });

    it.each(['0', '0.0000', '000.0000'])('rejects zero: %s', (value) => {
        expect(() => Weight.fromKilograms(value)).toThrow('Weight must be greater than zero');
    });

    it.each(['-1', '+1', '1e1', '1.', '.5', '1,5', 'NaN', ' Infinity ', ' 1'])(
        'rejects nondecimal input: %s',
        (value) => {
            expect(() => Weight.fromKilograms(value)).toThrow('Weight must be a decimal string');
        },
    );

    it('rejects more than four decimal places', () => {
        expect(() => Weight.fromKilograms('12.34567')).toThrow(
            'Weight must have at most four decimal places',
        );
    });
});
