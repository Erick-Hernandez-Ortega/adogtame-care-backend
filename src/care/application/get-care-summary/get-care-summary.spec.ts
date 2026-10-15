import { GetCareSummary, PetNotFoundError, type GetCareSummaryQuery } from './get-care-summary';
import type { CareSummaryReader, CareSummaryRoutine } from '../persistence/care-summary.reader';
import { RoutineFrequency } from '../../domain/routine-frequency/routine-frequency';

const query: GetCareSummaryQuery = {
    petId: 'pet',
    authenticatedAccountId: 'account',
    from: '2026-03-01',
    to: '2026-03-02',
};
const routine: CareSummaryRoutine = {
    routineId: 'routine',
    timezone: 'UTC',
    createdLocalDay: '2026-03-02',
    frequency: RoutineFrequency.from({ period: 'DAILY', timesPerPeriod: 2 }),
    completedByDay: { '2026-03-02': 1 },
    paginationKey: ['created', 'routine'],
};

describe('GetCareSummary', () => {
    it('delegates filters and bounded pagination and returns exact pure summaries', async () => {
        const findAccessibleByPet = jest
            .fn<
                ReturnType<CareSummaryReader['findAccessibleByPet']>,
                Parameters<CareSummaryReader['findAccessibleByPet']>
            >()
            .mockResolvedValue([routine]);
        const result = await new GetCareSummary({ findAccessibleByPet }).execute({
            ...query,
            routineId: 'routine',
        });

        expect(findAccessibleByPet).toHaveBeenCalledWith({
            petId: 'pet',
            accountId: 'account',
            from: query.from,
            to: query.to,
            routineId: 'routine',
            page: { limit: 21, after: null },
        });
        expect(result).toEqual({
            nextCursor: null,
            items: [
                {
                    routineId: 'routine',
                    timezone: 'UTC',
                    weeks: [],
                    days: [{ localDay: '2026-03-02', expected: 2, completed: 1, missed: 1 }],
                },
            ],
        });
    });

    it('keeps empty access distinct from inaccessible pets', async () => {
        await expect(
            new GetCareSummary({ findAccessibleByPet: () => Promise.resolve([]) }).execute(query),
        ).resolves.toEqual({ items: [], nextCursor: null });
        await expect(
            new GetCareSummary({ findAccessibleByPet: () => Promise.resolve(null) }).execute(query),
        ).rejects.toThrow(PetNotFoundError);
    });

    it('propagates unexpected reader failures', async () => {
        const failure: Error = new Error('Reader failed');

        await expect(
            new GetCareSummary({ findAccessibleByPet: () => Promise.reject(failure) }).execute(
                query,
            ),
        ).rejects.toBe(failure);
    });

    it('paginates routines and scopes cursors to dates, account, pet and routine', async () => {
        const findAccessibleByPet = jest
            .fn<
                ReturnType<CareSummaryReader['findAccessibleByPet']>,
                Parameters<CareSummaryReader['findAccessibleByPet']>
            >()
            .mockResolvedValue([routine, routine]);
        const useCase: GetCareSummary = new GetCareSummary({ findAccessibleByPet });
        const first = await useCase.execute({ ...query, limit: 1 });

        expect(first.items).toHaveLength(1);
        expect(first.nextCursor).not.toBeNull();
        await useCase.execute({ ...query, cursor: first.nextCursor });
        expect(findAccessibleByPet.mock.calls[1][0].page.after).toEqual(['created', 'routine']);

        for (const changed of [
            { petId: 'other' },
            { authenticatedAccountId: 'other' },
            { from: '2026-02-28' },
            { to: '2026-03-03' },
            { routineId: 'other' },
        ]) {
            await expect(
                useCase.execute({ ...query, ...changed, cursor: first.nextCursor }),
            ).rejects.toThrow('Cursor is invalid');
        }
    });
});
