import { ListCareActivities, PetNotFoundError } from './list-care-activities';
import type {
    CareActivityListItem,
    CareActivityReader,
    CareActivityReadRequest,
} from '../persistence/care-activity.reader';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';
const first: CareActivityListItem = {
    id: '80db31a0-aeb9-4768-b103-770110b39fd8',
    routineId: '7197fb48-3906-4da9-86d7-8323e04d7725',
    completedAt: '2026-10-10T02:00:00.000Z',
    completedBy: ACCOUNT_ID,
    timezone: 'America/Mexico_City',
    localDay: '2026-10-09',
    notes: 'Finished.',
};
const second: CareActivityListItem = {
    ...first,
    id: '7197fb48-3906-4da9-86d7-8323e04d7725',
    notes: null,
};

function setup(items: CareActivityListItem[] | null = [first, second]) {
    const findAccessibleByPet = jest
        .fn<Promise<CareActivityListItem[] | null>, [CareActivityReadRequest]>()
        .mockResolvedValue(items);
    const reader: CareActivityReader = { findAccessibleByPet };

    return { useCase: new ListCareActivities(reader), findAccessibleByPet };
}

describe('ListCareActivities', () => {
    it('returns all reader items in their original order with the exact contract', async () => {
        const { useCase, findAccessibleByPet } = setup();

        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).resolves.toEqual({ nextCursor: null, items: [first, second] });
        expect(findAccessibleByPet).toHaveBeenCalledTimes(1);
        expect(findAccessibleByPet).toHaveBeenCalledWith({
            page: { limit: 21, after: null },
            petId: PET_ID,
            accountId: ACCOUNT_ID,
            from: undefined,
            to: undefined,
            routineId: undefined,
        });
    });

    it('forwards both date bounds and the optional routine filter', async () => {
        const { useCase, findAccessibleByPet } = setup();

        await useCase.execute({
            petId: PET_ID,
            authenticatedAccountId: ACCOUNT_ID,
            from: '2026-10-01',
            to: '2026-10-10',
            routineId: first.routineId,
        });
        expect(findAccessibleByPet).toHaveBeenCalledWith({
            page: { limit: 21, after: null },
            petId: PET_ID,
            accountId: ACCOUNT_ID,
            from: '2026-10-01',
            to: '2026-10-10',
            routineId: first.routineId,
        });
    });

    it('returns an empty collection for an accessible pet', async () => {
        const { useCase } = setup([]);

        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).resolves.toEqual({ nextCursor: null, items: [] });
    });

    it('translates inaccessible pets to PetNotFoundError', async () => {
        const { useCase } = setup(null);

        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).rejects.toThrow(PetNotFoundError);
    });

    it('propagates the original unexpected reader failure', async () => {
        const { useCase, findAccessibleByPet } = setup();
        const failure: Error = new Error('Database failure');

        findAccessibleByPet.mockRejectedValue(failure);
        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).rejects.toBe(failure);
    });
});
