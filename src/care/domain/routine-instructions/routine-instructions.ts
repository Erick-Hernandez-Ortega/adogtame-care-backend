import { normalizeRequiredText } from '../../../shared/domain/text';

export class RoutineInstructions {
    private constructor(readonly value: string) {}

    static from(value: string): RoutineInstructions {
        return new RoutineInstructions(normalizeRequiredText(value, 'Routine instructions', 2000));
    }
}
