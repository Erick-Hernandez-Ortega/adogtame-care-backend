import { normalizeRequiredText } from '../../../shared/domain/text';

export class RoutineTitle {
    private constructor(readonly value: string) {}

    static from(value: string): RoutineTitle {
        return new RoutineTitle(normalizeRequiredText(value, 'Routine title', 255));
    }
}
