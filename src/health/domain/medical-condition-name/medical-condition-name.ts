import { normalizeRequiredText } from '../../../shared/domain/text';

export class MedicalConditionName {
    private constructor(readonly value: string) {}

    static from(value: string): MedicalConditionName {
        return new MedicalConditionName(
            normalizeRequiredText(value, 'Medical condition name', 255),
        );
    }
}
