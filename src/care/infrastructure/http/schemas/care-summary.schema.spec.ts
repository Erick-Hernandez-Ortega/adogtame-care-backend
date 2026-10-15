import { careSummaryQuerySchema } from './care-summary.schema';

describe('care summary query', () => {
    it.each([
        {},
        { from: '2026-01-01' },
        { to: '2026-01-01' },
        { from: '2026-02-29', to: '2026-03-01' },
        { from: '0000-01-01', to: '0000-01-01' },
        { from: '2026-01-02', to: '2026-01-01' },
        { from: '2026-01-01', to: '2026-02-01' },
        { from: ['2026-01-01'], to: '2026-01-01' },
        { from: { nested: '2026-01-01' }, to: '2026-01-01' },
        { from: '2026-01-01', to: '2026-01-01', limit: '101' },
        { from: '2026-01-01', to: '2026-01-01', limit: '01' },
        { from: '2026-01-01', to: '2026-01-01', routineId: '00000000-0000-0000-0000-000000000000' },
        { from: '2026-01-01', to: '2026-01-01', unexpected: 'x' },
    ])('rejects invalid query %j', (query: unknown) => {
        expect(careSummaryQuerySchema.safeParse(query).success).toBe(false);
    });

    it.each([
        ['2026-01-01', '2026-01-31'],
        ['2024-02-01', '2024-03-02'],
        ['0001-01-01', '0001-01-01'],
        ['9999-12-01', '9999-12-31'],
    ])('accepts inclusive range %s to %s', (from: string, to: string) => {
        expect(careSummaryQuerySchema.safeParse({ from, to }).success).toBe(true);
    });
});
