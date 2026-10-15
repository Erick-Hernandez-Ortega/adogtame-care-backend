import { normalizeRequiredText } from '../../../shared/domain/text';

export class VeterinaryVisitReason {
    private constructor(readonly value: string) {}

    static from(value: string): VeterinaryVisitReason {
        return new VeterinaryVisitReason(
            normalizeRequiredText(value, 'Veterinary visit reason', 255),
        );
    }
}
