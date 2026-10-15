import { InvalidCursorError, pageRequest, pageResult } from './pagination';

describe('Pagination', () => {
    it('defaults to twenty and reads one extra to detect continuation', () => {
        expect(pageRequest({}, 'scope')).toEqual({ limit: 21, after: null });
        expect(pageRequest({ limit: 100 }, 'scope')).toEqual({ limit: 101, after: null });
    });

    it.each([0, -1, 101, 1.5, Infinity, NaN])('rejects invalid limit %s', (limit: number) => {
        expect(() => pageRequest({ limit }, 'scope')).toThrow(InvalidCursorError);
    });

    it('preserves ordering keys without exposing them and allows a changed limit', () => {
        const page = pageResult(
            [
                { id: 'first', paginationKey: ['2026-10-01T00:00:00.123456Z', 'first'] },
                { id: 'second', paginationKey: ['2026-10-01T00:00:00.123455Z', 'second'] },
            ],
            { limit: 1 },
            'scope',
        );

        expect(page.items).toEqual([{ id: 'first' }]);
        expect(pageRequest({ limit: 100, cursor: page.nextCursor }, 'scope')).toEqual({
            limit: 101,
            after: ['2026-10-01T00:00:00.123456Z', 'first'],
        });
        expect(() => pageRequest({ cursor: page.nextCursor }, 'another scope')).toThrow(
            InvalidCursorError,
        );
        expect(pageResult([], {}, 'scope')).toEqual({ items: [], nextCursor: null });
    });

    it.each(['\u0000', 'prefix\u0000suffix', '\uD800', '\uDC00', 'prefix\uD800suffix'])(
        'rejects cursor keys PostgreSQL text cannot represent: %j',
        (key: string) => {
            const cursor: string = Buffer.from(
                JSON.stringify({ v: 1, scope: 'scope', after: [key] }),
            ).toString('base64url');

            expect(() => pageRequest({ cursor }, 'scope')).toThrow(InvalidCursorError);
        },
    );

    it('preserves valid Unicode including surrogate pairs in cursor keys', () => {
        const after: string[] = ['Luna 🐕', 'line\nbreak', '\u0001'];
        const cursor: string = Buffer.from(
            JSON.stringify({ v: 1, scope: 'scope', after }),
        ).toString('base64url');

        expect(pageRequest({ cursor }, 'scope').after).toEqual(after);
    });

    it.each([
        '',
        '!',
        'a'.repeat(2049),
        Buffer.from('{}').toString('base64url'),
        Buffer.from('null').toString('base64url'),
    ])('rejects malformed cursor %s', (cursor: string) => {
        expect(() => pageRequest({ cursor }, 'scope')).toThrow(InvalidCursorError);
    });
});
