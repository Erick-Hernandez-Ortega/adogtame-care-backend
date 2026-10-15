import { applyDecorators, BadRequestException } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import {
    InvalidCursorError,
    pageRequest,
    type PageQuery,
} from '../../shared/application/pagination';

export const paginationQueryShape = {
    limit: z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .refine((value: string): boolean => Number(value) <= 100)
        .transform(Number)
        .optional(),
    cursor: z.string().min(1).max(2048).optional(),
};
export const paginationQuerySchema = z.object(paginationQueryShape).strict();

export function parsePage(query: unknown, scope: string): PageQuery {
    const parsed = paginationQuerySchema.safeParse(query);

    if (!parsed.success) {
        throw new BadRequestException({
            code: 'INVALID_REQUEST',
            message: 'Request query is invalid',
        });
    }

    validatePage(parsed.data, scope);

    return parsed.data;
}

export function validatePage(query: PageQuery, scope: string): void {
    try {
        pageRequest(query, scope);
    } catch (error: unknown) {
        if (error instanceof InvalidCursorError) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        throw error;
    }
}

export function ApiPagination(): MethodDecorator {
    return applyDecorators(
        ApiQuery({
            name: 'limit',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        }),
        ApiQuery({
            name: 'cursor',
            required: false,
            description: 'Opaque continuation cursor for the same list and filters',
            schema: { type: 'string', maxLength: 2048 },
        }),
    );
}
