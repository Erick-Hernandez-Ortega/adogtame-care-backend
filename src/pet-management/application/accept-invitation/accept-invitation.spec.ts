import {
  AccountId,
  MembershipId,
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from '../../domain/pet-membership/pet-membership';
import {
  InvitationId,
  InvitedEmail,
  PetInvitation,
  PetInvitationStatus,
} from '../../domain/pet-invitation/pet-invitation';
import { PetId, PetStatus } from '../../domain/pet/pet';
import type { AccountLookup } from '../identity/account-lookup';
import type {
  AcceptInvitationPersistenceResult,
  PetInvitationRepository,
} from '../persistence/pet-invitation.repository';
import {
  AcceptInvitation,
  decideAcceptance,
  InvitationExpiredError,
  InvitationNotAcceptableError,
  InvitationNotFoundError,
  InvitationNotPendingError,
} from './accept-invitation';

const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const MEMBERSHIP_ID = '01890f47-6c2e-7c42-98c4-dc0c0c07398f';
const NOW = new Date('2026-09-27T12:30:00.000Z');

function invitation(
  status:
    'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' = 'PENDING',
  createdAt = '2026-09-26T12:30:00.000Z',
): PetInvitation {
  return PetInvitation.reconstitute({
    id: InvitationId.from('6fe44a29-206e-4875-9f3e-72026868135e'),
    petId: PetId.from(PET_ID),
    invitedEmail: InvitedEmail.from('friend@example.com'),
    invitedByAccountId: AccountId.from(ACCOUNT_ID),
    status,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 604_800_000).toISOString(),
  });
}

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

describe('decideAcceptance', () => {
  it('creates a collaborator when no membership exists', () => {
    const decision = decideAcceptance(
      invitation(),
      PetStatus.ACTIVE,
      null,
      ACCOUNT_ID,
      NOW,
    );
    expect(decision.outcome).toBe('ACCEPTED');
    if (decision.outcome !== 'ACCEPTED') throw new Error('Expected acceptance');
    expect(decision.membershipChange?.kind).toBe('CREATE');
    expect(decision.membershipChange?.membership.role).toBe(
      PetMembershipRole.COLLABORATOR,
    );
    expect(decision.membershipChange?.membership.status).toBe(
      PetMembershipStatus.ACTIVE,
    );
    expect(decision.invitationToSave?.status).toBe(
      PetInvitationStatus.ACCEPTED,
    );
  });

  it.each([PetMembershipRole.OWNER, PetMembershipRole.COLLABORATOR])(
    'reactivates inactive %s with the same membership ID as collaborator',
    (role) => {
      const decision = decideAcceptance(
        invitation(),
        PetStatus.ACTIVE,
        membership(role, 'INACTIVE'),
        ACCOUNT_ID,
        NOW,
      );
      if (decision.outcome !== 'ACCEPTED')
        throw new Error('Expected acceptance');
      expect(decision.membershipChange?.kind).toBe('REACTIVATE');
      expect(decision.membershipChange?.membership.id.value).toBe(
        MEMBERSHIP_ID,
      );
      expect(decision.membershipChange?.membership.role).toBe(
        PetMembershipRole.COLLABORATOR,
      );
      expect(decision.membershipChange?.membership.status).toBe(
        PetMembershipStatus.ACTIVE,
      );
    },
  );

  it.each([PetMembershipRole.OWNER, PetMembershipRole.COLLABORATOR])(
    'leaves an active %s membership untouched',
    (role) => {
      const decision = decideAcceptance(
        invitation(),
        PetStatus.ACTIVE,
        membership(role, 'ACTIVE'),
        ACCOUNT_ID,
        NOW,
      );
      if (decision.outcome !== 'ACCEPTED')
        throw new Error('Expected acceptance');
      expect(decision.membershipChange).toBeNull();
      expect(decision.invitationToSave?.status).toBe(
        PetInvitationStatus.ACCEPTED,
      );
    },
  );

  it('materializes a pending invitation expired at now without membership', () => {
    const pending = invitation('PENDING', '2026-09-20T12:30:00.000Z');
    const decision = decideAcceptance(
      pending,
      PetStatus.ACTIVE,
      null,
      ACCOUNT_ID,
      NOW,
    );
    expect(decision).toEqual({ outcome: 'EXPIRED', invitationToSave: pending });
    expect(pending.status).toBe(PetInvitationStatus.EXPIRED);
  });

  it('does not mutate an already expired invitation', () => {
    expect(
      decideAcceptance(
        invitation('EXPIRED'),
        PetStatus.ACTIVE,
        null,
        ACCOUNT_ID,
        NOW,
      ),
    ).toEqual({ outcome: 'EXPIRED', invitationToSave: null });
  });

  it('returns success without mutations for an accepted retry, even when the pet is archived', () => {
    expect(
      decideAcceptance(
        invitation('ACCEPTED'),
        PetStatus.ARCHIVED,
        null,
        ACCOUNT_ID,
        NOW,
      ),
    ).toEqual({
      outcome: 'ACCEPTED',
      invitationToSave: null,
      membershipChange: null,
    });
  });

  it.each([PetInvitationStatus.REJECTED, PetInvitationStatus.CANCELLED])(
    'does not accept %s',
    (status) => {
      expect(
        decideAcceptance(
          invitation(status),
          PetStatus.ACTIVE,
          null,
          ACCOUNT_ID,
          NOW,
        ),
      ).toEqual({ outcome: 'NOT_PENDING', invitationToSave: null });
    },
  );

  it('does not accept a pending invitation when the pet is archived', () => {
    const pending = invitation();
    expect(
      decideAcceptance(pending, PetStatus.ARCHIVED, null, ACCOUNT_ID, NOW),
    ).toEqual({ outcome: 'NOT_ACCEPTABLE', invitationToSave: null });
    expect(pending.status).toBe(PetInvitationStatus.PENDING);
  });
});

describe('AcceptInvitation', () => {
  const acceptedResult: AcceptInvitationPersistenceResult = {
    outcome: 'ACCEPTED',
    id: '6fe44a29-206e-4875-9f3e-72026868135e',
    petId: PET_ID,
  };

  function setup(
    result: AcceptInvitationPersistenceResult = acceptedResult,
    email: string | null = 'friend@example.com',
  ) {
    const accept = jest
      .fn<
        Promise<AcceptInvitationPersistenceResult>,
        [string, string, string]
      >()
      .mockResolvedValue(result);
    const accountLookup: AccountLookup = {
      findEmailsByAccountIds: jest.fn().mockResolvedValue([]),
      findAccountIdByEmail: jest
        .fn()
        .mockResolvedValue(null) as AccountLookup['findAccountIdByEmail'],
      findEmailByAccountId: jest
        .fn()
        .mockResolvedValue(email) as AccountLookup['findEmailByAccountId'],
    };
    const repository: PetInvitationRepository = {
      findPending: jest
        .fn()
        .mockResolvedValue(null) as PetInvitationRepository['findPending'],
      createPending: jest
        .fn()
        .mockResolvedValue(
          'CREATED',
        ) as PetInvitationRepository['createPending'],
      accept,
      reject: jest.fn().mockResolvedValue({
        outcome: 'NOT_FOUND',
      }) as PetInvitationRepository['reject'],
      cancel: jest.fn().mockResolvedValue({
        outcome: 'NOT_FOUND',
      }) as PetInvitationRepository['cancel'],
    };
    return { useCase: new AcceptInvitation(accountLookup, repository), accept };
  }

  it('passes only the authenticated account ID and its lookup email to persistence', async () => {
    const { useCase, accept } = setup();
    await expect(
      useCase.execute(
        acceptedResult.outcome === 'ACCEPTED' ? acceptedResult.id : '',
        ACCOUNT_ID,
      ),
    ).resolves.toEqual({
      id: acceptedResult.outcome === 'ACCEPTED' ? acceptedResult.id : '',
      petId: PET_ID,
      status: 'ACCEPTED',
    });
    expect(accept).toHaveBeenCalledWith(
      acceptedResult.outcome === 'ACCEPTED' ? acceptedResult.id : '',
      'friend@example.com',
      ACCOUNT_ID,
    );
  });

  it('hides a missing account email or invitation behind the same error', async () => {
    await expect(
      setup(acceptedResult, null).useCase.execute('id', ACCOUNT_ID),
    ).rejects.toThrow(InvitationNotFoundError);
    await expect(
      setup({ outcome: 'NOT_FOUND' }).useCase.execute('id', ACCOUNT_ID),
    ).rejects.toThrow(InvitationNotFoundError);
  });

  it.each([
    [{ outcome: 'EXPIRED' } as const, InvitationExpiredError],
    [{ outcome: 'NOT_PENDING' } as const, InvitationNotPendingError],
    [{ outcome: 'NOT_ACCEPTABLE' } as const, InvitationNotAcceptableError],
  ])('maps %s to its application error', async (result, errorClass) => {
    await expect(
      setup(result).useCase.execute('id', ACCOUNT_ID),
    ).rejects.toThrow(errorClass);
  });

  it('propagates unexpected persistence failures', async () => {
    const { useCase, accept } = setup();
    accept.mockRejectedValue(new Error('database failure'));
    await expect(useCase.execute('id', ACCOUNT_ID)).rejects.toThrow(
      'database failure',
    );
  });
});
