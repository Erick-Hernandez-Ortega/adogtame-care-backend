export class RoutineTimezone {
    private constructor(readonly value: string) {}

    static from(value: string): RoutineTimezone {
        if (
            typeof value !== 'string' ||
            value.length === 0 ||
            value !== value.trim() ||
            /^[+-]/.test(value)
        ) {
            throw new TypeError('Routine timezone must be an IANA timezone');
        }

        try {
            const timezone: string = new Intl.DateTimeFormat('en', {
                timeZone: value,
            }).resolvedOptions().timeZone;

            return new RoutineTimezone(timezone);
        } catch (error: unknown) {
            if (error instanceof RangeError) {
                throw new TypeError('Routine timezone must be an IANA timezone', { cause: error });
            }

            throw error;
        }
    }
}
