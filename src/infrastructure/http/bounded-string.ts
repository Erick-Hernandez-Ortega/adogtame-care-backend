import { z } from 'zod';

export function boundedString(maximum: number): z.ZodString {
    return z
        .string()
        .max(maximum * 2)
        .describe(
            `At most ${maximum} Unicode code points after trimming; raw input is limited to ${maximum * 2} UTF-16 units`,
        )
        .refine((value: string): boolean => Array.from(value.trim()).length <= maximum);
}
