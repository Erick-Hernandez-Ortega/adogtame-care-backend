import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { LeavePetPersistenceResult, PetRepository } from '../persistence/pet.repository';
import { LeavePet, LastOwnerCannotLeaveError } from './leave-pet';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';

describe('LeavePet', () => {
    function setup(
        result: LeavePetPersistenceResult = {
            outcome: 'LEFT',
        },
    ) {
        const leave = jest
            .fn<Promise<LeavePetPersistenceResult>, [string, string]>()
            .mockResolvedValue(result);
        const repository: PetRepository = {
            restoreIfOwned: jest.fn(),
            archiveIfOwned: jest.fn() as PetRepository['archiveIfOwned'],
            promoteCollaboratorIfOwned: jest.fn() as PetRepository['promoteCollaboratorIfOwned'],
            removeMemberIfOwned: jest.fn() as PetRepository['removeMemberIfOwned'],
            save: jest.fn() as PetRepository['save'],
            correctProfileIfOwned: jest.fn() as PetRepository['correctProfileIfOwned'],
            leave,
        };

        return {
            useCase: new LeavePet(repository),
            leave,
        };
    }

    it('passes only the pet and authenticated account IDs', async () => {
        const { useCase, leave } = setup();

        await expect(useCase.execute(PET_ID, ACCOUNT_ID)).resolves.toBeUndefined();
        expect(leave).toHaveBeenCalledWith(PET_ID, ACCOUNT_ID);
    });

    it.each(['LEFT', 'ALREADY_LEFT'] as const)(
        'succeeds for %s regardless of role',
        async (outcome) => {
            await expect(
                setup({ outcome }).useCase.execute(PET_ID, ACCOUNT_ID),
            ).resolves.toBeUndefined();
        },
    );

    it.each([
        [{ outcome: 'PET_NOT_FOUND' } as const, PetNotFoundError],
        [{ outcome: 'LAST_OWNER_CANNOT_LEAVE' } as const, LastOwnerCannotLeaveError],
    ])('maps %s to its application error', async (result, errorClass) => {
        await expect(setup(result).useCase.execute(PET_ID, ACCOUNT_ID)).rejects.toThrow(errorClass);
    });

    it('propagates unexpected repository errors', async () => {
        const { useCase, leave } = setup();

        leave.mockRejectedValue(new Error('database failure'));
        await expect(useCase.execute(PET_ID, ACCOUNT_ID)).rejects.toThrow('database failure');
    });
});
