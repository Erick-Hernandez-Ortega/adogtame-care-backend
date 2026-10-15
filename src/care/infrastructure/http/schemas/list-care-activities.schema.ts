import { z } from 'zod';
import { isValidCivilDate } from '../../../../shared/domain/civil-date';
import { careRoutineIdSchema } from './update-care-routine.schema';

const localDateSchema = z.string().refine(isValidCivilDate);

export const listCareActivitiesQuerySchema = z
    .object({
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        routineId: careRoutineIdSchema.optional(),
    })
    .strict()
    .refine(
        (query): boolean =>
            query.from === undefined || query.to === undefined || query.from <= query.to,
    );
