import {
  AccountId,
  MembershipId,
  PetMembership,
} from '../../domain/pet-membership/pet-membership';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
  PetRepository,
  RemoveCollaboratorPersistenceResult,
} from '../persistence/pet.repository';
import {
  decideCollaboratorRemoval,
  RemoveCollaborator,
  PetMemberNotFoundError,
  OwnerRemovalNotSupportedError,
  type RemoveCollaboratorCommand,
} from './remove-collaborator';

const command: RemoveCollaboratorCommand = {
  petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
  requesterAccountId: '550e8400-e29b-41d4-a716-446655440000',
  targetMembershipId: '01890f47-6c2e-7c42-98c4-dc0c0c07398f',
};

function membership(
  role: 'OWNER' | 'COLLABORATOR',
  status: 'ACTIVE' | 'INACTIVE',
): PetMembership {
  return PetMembership.reconstitute({
    id: MembershipId.from(command.targetMembershipId),
    accountId: AccountId.from(command.requesterAccountId),
    role,
    status,
  });
}

describe('decideCollaboratorRemoval', () => {
  it('removes an active collaborator', () => {
    const decision = decideCollaboratorRemoval(
      membership('COLLABORATOR', 'ACTIVE'),
    );
    expect(decision).toMatchObject({
      outcome: 'REMOVED',
      membershipToSave: { status: 'INACTIVE' },
    });
  });
  it('retries without a new transition', () => {
    expect(
      decideCollaboratorRemoval(membership('COLLABORATOR', 'INACTIVE')),
    ).toEqual({ outcome: 'REMOVED', membershipToSave: null });
  });
  it.each(['ACTIVE', 'INACTIVE'] as const)(
    'rejects a %s owner including self-target',
    (status) => {
      expect(decideCollaboratorRemoval(membership('OWNER', status))).toEqual({
        outcome: 'OWNER_REMOVAL_NOT_SUPPORTED',
        membershipToSave: null,
      });
    },
  );
});

describe('RemoveCollaborator', () => {
  function setup(
    outcome: RemoveCollaboratorPersistenceResult['outcome'] = 'REMOVED',
  ) {
    const removeCollaboratorIfOwned = jest
      .fn<
        Promise<RemoveCollaboratorPersistenceResult>,
        [RemoveCollaboratorCommand]
      >()
      .mockResolvedValue({ outcome });
    const repository: PetRepository = {
      save: jest.fn() as PetRepository['save'],
      correctProfileIfOwned:
        jest.fn() as PetRepository['correctProfileIfOwned'],
      leaveAsCollaborator: jest.fn() as PetRepository['leaveAsCollaborator'],
      removeCollaboratorIfOwned,
    };
    return {
      useCase: new RemoveCollaborator(repository),
      removeCollaboratorIfOwned,
    };
  }
  it('succeeds and retries through the atomic boundary', async () => {
    const { useCase, removeCollaboratorIfOwned } = setup();
    await expect(useCase.execute(command)).resolves.toBeUndefined();
    await expect(useCase.execute(command)).resolves.toBeUndefined();
    expect(removeCollaboratorIfOwned).toHaveBeenCalledTimes(2);
    expect(removeCollaboratorIfOwned).toHaveBeenNthCalledWith(1, command);
    expect(removeCollaboratorIfOwned).toHaveBeenNthCalledWith(2, command);
  });
  it.each([
    ['PET_NOT_FOUND', PetNotFoundError],
    ['PET_MEMBER_NOT_FOUND', PetMemberNotFoundError],
    ['OWNER_REMOVAL_NOT_SUPPORTED', OwnerRemovalNotSupportedError],
  ] as const)('maps %s', async (outcome, errorClass) => {
    await expect(setup(outcome).useCase.execute(command)).rejects.toThrow(
      errorClass,
    );
  });
  it('propagates self-target to the boundary and maps owner rejection', async () => {
    const { useCase, removeCollaboratorIfOwned } = setup(
      'OWNER_REMOVAL_NOT_SUPPORTED',
    );
    await expect(useCase.execute(command)).rejects.toThrow(
      OwnerRemovalNotSupportedError,
    );
    expect(removeCollaboratorIfOwned).toHaveBeenCalledWith(command);
  });
  it('propagates unexpected persistence failure', async () => {
    const { useCase, removeCollaboratorIfOwned } = setup();
    const failure: Error = new Error('database failure');
    removeCollaboratorIfOwned.mockRejectedValue(failure);
    await expect(useCase.execute(command)).rejects.toBe(failure);
  });
});
