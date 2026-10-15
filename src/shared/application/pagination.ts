export interface PageQuery {
    readonly limit?: number;
    readonly cursor?: string | null;
}

export interface PageRequest {
    readonly limit: number;
    readonly after: readonly string[] | null;
}

export interface PageRow {
    readonly paginationKey?: readonly string[];
}

export interface Page<T> {
    readonly items: T[];
    readonly nextCursor: string | null;
}

export class InvalidCursorError extends Error {
    constructor() {
        super('Cursor is invalid');
    }
}

export function pageRequest(query: PageQuery, scope: string): PageRequest {
    const limit: number = query.limit ?? 20;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new InvalidCursorError();
    }

    if (query.cursor === undefined || query.cursor === null) {
        return { limit: limit + 1, after: null };
    }

    const token: string = query.cursor;

    if (token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) {
        throw new InvalidCursorError();
    }

    const bytes: Buffer = Buffer.from(token, 'base64url');
    let decoded: unknown;

    try {
        decoded = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
        throw new InvalidCursorError();
    }

    if (bytes.toString('base64url') !== token || typeof decoded !== 'object' || decoded === null) {
        throw new InvalidCursorError();
    }

    const fields: Record<string, unknown> = decoded as Record<string, unknown>;

    if (
        Object.keys(fields).length !== 3 ||
        fields.v !== 1 ||
        fields.scope !== scope ||
        !Array.isArray(fields.after) ||
        fields.after.length < 1 ||
        fields.after.length > 4 ||
        !fields.after.every(
            (key: unknown): key is string =>
                typeof key === 'string' &&
                key.length <= 1024 &&
                !key.includes('\u0000') &&
                !/[\uD800-\uDFFF]/u.test(key),
        )
    ) {
        throw new InvalidCursorError();
    }

    return { limit: limit + 1, after: fields.after };
}

export function pageResult<T extends PageRow>(
    rows: T[],
    query: PageQuery,
    scope: string,
): Page<Omit<T, 'paginationKey'>> {
    const limit: number = query.limit ?? 20;
    const selected: T[] = rows.slice(0, limit);
    const last: T | undefined = selected.at(-1);

    return {
        items: selected.map(({ paginationKey, ...item }: T): Omit<T, 'paginationKey'> => item),
        nextCursor:
            rows.length > limit && last?.paginationKey !== undefined
                ? Buffer.from(JSON.stringify({ v: 1, scope, after: last.paginationKey })).toString(
                      'base64url',
                  )
                : null,
    };
}
