import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
  PetRepository,
  RemovePetMemberPersistenceResult,
} from '../persistence/pet.repository';
import {
  RemovePetMember,
  PetMemberNotFoundError,
  SelfRemovalNotSupportedError,
  LastOwnerCannotBeRemovedError,
  type RemovePetMemberCommand,
} from './remove-pet-member';

const command: RemovePetMemberCommand = {
  petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
  requesterAccountId: '550e8400-e29b-41d4-a716-446655440000',
  targetMembershipId: '01890f47-6c2e-7c42-98c4-dc0c0c07398f',
};

describe('RemovePetMember', () => {
  function setup(
    outcome: RemovePetMemberPersistenceResult['outcome'] = 'REMOVED',
  ) {
    const removeMemberIfOwned = jest
      .fn<Promise<RemovePetMemberPersistenceResult>, [RemovePetMemberCommand]>()
      .mockResolvedValue({ outcome });
    const repository: PetRepository = {
      save: jest.fn() as PetRepository['save'],
      correctProfileIfOwned:
        jest.fn() as PetRepository['correctProfileIfOwned'],
      leave: jest.fn() as PetRepository['leave'],
      promoteCollaboratorIfOwned:
        jest.fn() as PetRepository['promoteCollaboratorIfOwned'],
      removeMemberIfOwned,
    };
    return {
      useCase: new RemovePetMember(repository),
      removeMemberIfOwned,
    };
  }
  it('succeeds and retries through the atomic boundary', async () => {
    const { useCase, removeMemberIfOwned } = setup();
    await expect(useCase.execute(command)).resolves.toBeUndefined();
    await expect(useCase.execute(command)).resolves.toBeUndefined();
    expect(removeMemberIfOwned).toHaveBeenCalledTimes(2);
    expect(removeMemberIfOwned).toHaveBeenNthCalledWith(1, command);
    expect(removeMemberIfOwned).toHaveBeenNthCalledWith(2, command);
  });
  it.each([
    ['PET_NOT_FOUND', PetNotFoundError],
    ['PET_MEMBER_NOT_FOUND', PetMemberNotFoundError],
    ['SELF_REMOVAL_NOT_SUPPORTED', SelfRemovalNotSupportedError],
    ['LAST_OWNER_CANNOT_BE_REMOVED', LastOwnerCannotBeRemovedError],
  ] as const)('maps %s', async (outcome, errorClass) => {
    await expect(setup(outcome).useCase.execute(command)).rejects.toThrow(
      errorClass,
    );
  });
  it('propagates self-target to the boundary and maps self-removal rejection', async () => {
    const { useCase, removeMemberIfOwned } = setup(
      'SELF_REMOVAL_NOT_SUPPORTED',
    );
    await expect(useCase.execute(command)).rejects.toThrow(
      SelfRemovalNotSupportedError,
    );
    expect(removeMemberIfOwned).toHaveBeenCalledWith(command);
  });
  it('propagates unexpected persistence failure', async () => {
    const { useCase, removeMemberIfOwned } = setup();
    const failure: Error = new Error('database failure');
    removeMemberIfOwned.mockRejectedValue(failure);
    await expect(useCase.execute(command)).rejects.toBe(failure);
  });
});
