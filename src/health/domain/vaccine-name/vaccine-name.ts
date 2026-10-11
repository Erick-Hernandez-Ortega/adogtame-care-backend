import { normalizeRequiredText } from '../../../shared/domain/text';

export class VaccineName {
    private constructor(readonly value: string) {}

    static from(value: string): VaccineName {
        return new VaccineName(normalizeRequiredText(value, 'Vaccine name', 255));
    }
}
