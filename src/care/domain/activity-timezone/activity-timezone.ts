export class ActivityTimezone {
    private constructor(readonly value: string) {}

    static from(value: string): ActivityTimezone {
        if (
            typeof value !== 'string' ||
            value.length === 0 ||
            value !== value.trim() ||
            /^[+-]/.test(value)
        ) {
            throw new TypeError('Activity timezone must be an IANA timezone');
        }

        try {
            const timezone: string = new Intl.DateTimeFormat('en', {
                timeZone: value,
            }).resolvedOptions().timeZone;

            return new ActivityTimezone(timezone);
        } catch (error: unknown) {
            if (error instanceof RangeError) {
                throw new TypeError('Activity timezone must be an IANA timezone', { cause: error });
            }

            throw error;
        }
    }
}
