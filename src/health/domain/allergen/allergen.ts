import { normalizeRequiredText } from '../../../shared/domain/text';

export class Allergen {
    private constructor(readonly value: string) {}

    static from(value: string): Allergen {
        return new Allergen(normalizeRequiredText(value, 'Allergen', 255));
    }
}
