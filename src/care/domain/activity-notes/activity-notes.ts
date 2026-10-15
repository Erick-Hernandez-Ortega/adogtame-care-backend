import { normalizeRequiredText } from '../../../shared/domain/text';

export class ActivityNotes {
    private constructor(readonly value: string) {}

    static from(value: string): ActivityNotes {
        return new ActivityNotes(normalizeRequiredText(value, 'Activity notes', 2000));
    }
}
