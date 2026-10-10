import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
    PetRepository,
    PromoteCollaboratorCommand,
    PromoteCollaboratorPersistenceResult,
} from '../persistence/pet.repository';
import { PetMemberNotFoundError } from '../remove-pet-member/remove-pet-member';
import {
    PetMemberInactiveError,
    PromoteCollaboratorToOwner,
} from './promote-collaborator-to-owner';

const command: PromoteCollaboratorCommand = {
    petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
    requesterAccountId: '550e8400-e29b-41d4-a716-446655440000',
    targetMembershipId: '01890f47-6c2e-7c42-98c4-dc0c0c07398f',
};

describe('PromoteCollaboratorToOwner', () => {
    function setup(outcome: PromoteCollaboratorPersistenceResult['outcome'] = 'PROMOTED') {
        const promoteCollaboratorIfOwned = jest
            .fn<Promise<PromoteCollaboratorPersistenceResult>, [PromoteCollaboratorCommand]>()
            .mockResolvedValue({ outcome });
        const repository: PetRepository = {
            restoreIfOwned: jest.fn(),
            archiveIfOwned: jest.fn() as PetRepository['archiveIfOwned'],
            promoteCollaboratorIfOwned,
            removeMemberIfOwned: jest.fn() as PetRepository['removeMemberIfOwned'],
            leave: jest.fn() as PetRepository['leave'],
            correctProfileIfOwned: jest.fn() as PetRepository['correctProfileIfOwned'],
            save: jest.fn() as PetRepository['save'],
        };

        return {
            useCase: new PromoteCollaboratorToOwner(repository),
            promoteCollaboratorIfOwned,
        };
    }

    it.each(['PROMOTED', 'ALREADY_OWNER'] as const)(
        'succeeds for %s through the atomic boundary',
        async (outcome) => {
            const { useCase, promoteCollaboratorIfOwned } = setup(outcome);

            await expect(useCase.execute(command)).resolves.toBeUndefined();
            expect(promoteCollaboratorIfOwned).toHaveBeenCalledWith(command);
        },
    );

    it('passes self-target to the boundary for authorization and idempotence', async () => {
        const { useCase, promoteCollaboratorIfOwned } = setup('ALREADY_OWNER');
        const selfTarget: PromoteCollaboratorCommand = {
            ...command,
            targetMembershipId: command.requesterAccountId,
        };

        await expect(useCase.execute(selfTarget)).resolves.toBeUndefined();
        expect(promoteCollaboratorIfOwned).toHaveBeenCalledWith(selfTarget);
    });

    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['PET_MEMBER_NOT_FOUND', PetMemberNotFoundError],
        ['PET_MEMBER_INACTIVE', PetMemberInactiveError],
    ] as const)('maps %s', async (outcome, errorClass) => {
        await expect(setup(outcome).useCase.execute(command)).rejects.toThrow(errorClass);
    });

    it('propagates unexpected persistence failure', async () => {
        const { useCase, promoteCollaboratorIfOwned } = setup();
        const failure: Error = new Error('database failure');

        promoteCollaboratorIfOwned.mockRejectedValue(failure);
        await expect(useCase.execute(command)).rejects.toBe(failure);
    });
});
