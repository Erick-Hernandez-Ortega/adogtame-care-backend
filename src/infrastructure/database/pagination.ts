import { sql, type SQL } from 'drizzle-orm';
import type { PageRequest } from '../../shared/application/pagination';

export function paginationKey(expressions: readonly SQL[]): SQL<string[]> {
    return sql<string[]>`ARRAY[${sql.join([...expressions], sql`, `)}]::text[]`;
}

export function afterPage(
    key: SQL<string[]>,
    page: PageRequest | undefined,
    direction: 'ASC' | 'DESC' = 'DESC',
): SQL | undefined {
    if (page?.after === null || page?.after === undefined) {
        return undefined;
    }

    const after: SQL = sql`ARRAY[${sql.join(
        page.after.map((value: string): SQL => sql`${value}`),
        sql`, `,
    )}]::text[]`;

    return direction === 'DESC' ? sql`${key} < ${after}` : sql`${key} > ${after}`;
}
