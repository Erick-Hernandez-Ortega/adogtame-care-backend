import { z } from 'zod';
import { paginationQueryShape } from '../../../../infrastructure/http/pagination';
import { isValidCivilDate } from '../../../../shared/domain/civil-date';
import { careRoutineIdSchema } from './update-care-routine.schema';

const localDateSchema = z.string().refine(isValidCivilDate);

export const careSummaryQuerySchema = z
    .object({
        ...paginationQueryShape,
        from: localDateSchema,
        to: localDateSchema,
        routineId: careRoutineIdSchema.optional(),
    })
    .strict()
    .refine((query): boolean => {
        const difference: number =
            Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`);

        return difference >= 0 && difference < 31 * 86_400_000;
    });
