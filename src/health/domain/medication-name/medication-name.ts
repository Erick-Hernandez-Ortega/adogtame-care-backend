import { normalizeRequiredText } from '../../../shared/domain/text';

export class MedicationName {
    private constructor(readonly value: string) {}

    static from(value: string): MedicationName {
        return new MedicationName(normalizeRequiredText(value, 'Medication name', 255));
    }
}
