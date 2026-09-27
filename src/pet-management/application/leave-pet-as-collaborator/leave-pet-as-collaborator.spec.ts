import {
  AccountId,
  MembershipId,
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from '../../domain/pet-membership/pet-membership';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
  LeavePetPersistenceResult,
  PetRepository,
} from '../persistence/pet.repository';
import {
  decideCollaboratorLeave,
  LeavePetAsCollaborator,
  OwnerLeaveNotSupportedError,
} from './leave-pet-as-collaborator';

const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const MEMBERSHIP_ID = '01890f47-6c2e-7c42-98c4-dc0c0c07398f';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';

function membership(
  role: 'OWNER' | 'COLLABORATOR',
  status: 'ACTIVE' | 'INACTIVE',
): PetMembership {
  return PetMembership.reconstitute({
    id: MembershipId.from(MEMBERSHIP_ID),
    accountId: AccountId.from(ACCOUNT_ID),
    role,
    status,
  });
}

describe('decideCollaboratorLeave', () => {
  it('transitions an active collaborator', () => {
    const decision = decideCollaboratorLeave(
      membership(PetMembershipRole.COLLABORATOR, PetMembershipStatus.ACTIVE),
    );
    expect(decision.outcome).toBe('LEFT');
    expect(decision.membershipToSave?.id.value).toBe(MEMBERSHIP_ID);
    expect(decision.membershipToSave?.status).toBe(
      PetMembershipStatus.INACTIVE,
    );
  });

  it('returns an inactive collaborator without a transition', () => {
    expect(
      decideCollaboratorLeave(
        membership(
          PetMembershipRole.COLLABORATOR,
          PetMembershipStatus.INACTIVE,
        ),
      ),
    ).toEqual({ outcome: 'LEFT', membershipToSave: null });
  });

  it.each([PetMembershipStatus.ACTIVE, PetMembershipStatus.INACTIVE])(
    'rejects a %s owner',
    (status) => {
      expect(
        decideCollaboratorLeave(membership(PetMembershipRole.OWNER, status)),
      ).toEqual({
        outcome: 'OWNER_LEAVE_NOT_SUPPORTED',
        membershipToSave: null,
      });
    },
  );
});

describe('LeavePetAsCollaborator', () => {
  function setup(
    result: LeavePetPersistenceResult = {
      outcome: 'LEFT',
      petId: PET_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'COLLABORATOR',
      status: 'INACTIVE',
    },
  ) {
    const leaveAsCollaborator = jest
      .fn<Promise<LeavePetPersistenceResult>, [string, string]>()
      .mockResolvedValue(result);
    const repository: PetRepository = {
      save: jest.fn() as PetRepository['save'],
      leaveAsCollaborator,
    };
    return {
      useCase: new LeavePetAsCollaborator(repository),
      leaveAsCollaborator,
    };
  }

  it('passes only the pet and authenticated account IDs', async () => {
    const { useCase, leaveAsCollaborator } = setup();
    await expect(useCase.execute(PET_ID, ACCOUNT_ID)).resolves.toEqual({
      petId: PET_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'COLLABORATOR',
      status: 'INACTIVE',
    });
    expect(leaveAsCollaborator).toHaveBeenCalledWith(PET_ID, ACCOUNT_ID);
  });

  it.each([
    [{ outcome: 'PET_NOT_FOUND' } as const, PetNotFoundError],
    [
      { outcome: 'OWNER_LEAVE_NOT_SUPPORTED' } as const,
      OwnerLeaveNotSupportedError,
    ],
  ])('maps %s to its application error', async (result, errorClass) => {
    await expect(
      setup(result).useCase.execute(PET_ID, ACCOUNT_ID),
    ).rejects.toThrow(errorClass);
  });

  it('propagates unexpected repository errors', async () => {
    const { useCase, leaveAsCollaborator } = setup();
    leaveAsCollaborator.mockRejectedValue(new Error('database failure'));
    await expect(useCase.execute(PET_ID, ACCOUNT_ID)).rejects.toThrow(
      'database failure',
    );
  });
});
