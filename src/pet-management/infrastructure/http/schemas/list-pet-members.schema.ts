import { paginationQuerySchema } from '../../../../infrastructure/http/pagination';
import { petIdSchema } from './get-pet-detail.schema';

export const listPetMembersIdSchema = petIdSchema.refine(
    (value: string): boolean => value !== '00000000-0000-0000-0000-000000000000',
);
export const listPetMembersQuerySchema = paginationQuerySchema;
