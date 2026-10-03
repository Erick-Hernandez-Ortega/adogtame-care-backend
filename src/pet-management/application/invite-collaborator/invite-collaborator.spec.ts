import type { AccountLookup } from '../identity/account-lookup';
import {
  CreatePendingInvitationOutcome,
  type PetInvitationRepository,
} from '../persistence/pet-invitation.repository';
import type {
  AccessiblePetSummary,
  PetDetail,
  PetQueryRepository,
} from '../persistence/pet-query.repository';
import type { Clock } from '../time/clock';
import { AccountId } from '../../domain/pet-membership/pet-membership';
import {
  InvitationId,
  InvitedEmail,
  PetInvitation,
  PetInvitationStatus,
} from '../../domain/pet-invitation/pet-invitation';
import { PetId } from '../../domain/pet/pet';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import {
  AlreadyPetMemberError,
  InvalidInvitedEmailError,
  InvitationAlreadyPendingError,
  InviteCollaborator,
} from './invite-collaborator';
import type { InviteCollaboratorCommand } from './invite-collaborator.types';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const OWNER_ID: string = '550e8400-e29b-41d4-a716-446655440000';
const INVITED_ACCOUNT_ID: string = 'fd997d55-31ac-45f2-b7fa-17113f6ef5e5';
const NOW: Date = new Date('2026-09-26T12:30:00.000Z');

class FakePetQueryRepository implements PetQueryRepository {
  findAccessibleMembers(): Promise<null> {
    return Promise.resolve(null);
  }
  ownerAccess = true;
  targetMembership: {
    role: 'OWNER' | 'COLLABORATOR';
    status: 'ACTIVE' | 'INACTIVE';
  } | null = null;
  readonly ownerRequests: { petId: string; accountId: string }[] = [];
  readonly membershipRequests: { petId: string; accountId: string }[] = [];

  findAccessibleByAccountId(
    accountId: string,
  ): Promise<AccessiblePetSummary[]> {
    void accountId;
    return Promise.resolve([]);
  }

  findAccessibleDetailById(
    petId: string,
    accountId: string,
  ): Promise<PetDetail | null> {
    void petId;
    void accountId;
    return Promise.resolve(null);
  }

  hasActiveOwnerAccess(petId: string, accountId: string): Promise<boolean> {
    this.ownerRequests.push({ petId, accountId });
    return Promise.resolve(this.ownerAccess);
  }

  hasActiveMembership(petId: string, accountId: string): Promise<boolean> {
    this.membershipRequests.push({ petId, accountId });
    return Promise.resolve(this.targetMembership?.status === 'ACTIVE');
  }
}

class FakeAccountLookup implements AccountLookup {
  findEmailsByAccountIds(): Promise<[]> {
    return Promise.resolve([]);
  }
  accountId: string | null = null;
  readonly emails: string[] = [];

  findAccountIdByEmail(email: string): Promise<string | null> {
    this.emails.push(email);
    return Promise.resolve(this.accountId);
  }

  findEmailByAccountId(accountId: string): Promise<string | null> {
    void accountId;
    return Promise.resolve(null);
  }
}

class FakePetInvitationRepository implements PetInvitationRepository {
  pending: PetInvitation | null = null;
  outcome: CreatePendingInvitationOutcome =
    CreatePendingInvitationOutcome.CREATED;
  error: Error | null = null;
  readonly pendingRequests: { petId: string; email: string }[] = [];
  readonly creations: {
    invitation: PetInvitation;
    expiredInvitation: PetInvitation | null;
  }[] = [];

  accept(): Promise<{ outcome: 'NOT_FOUND' }> {
    return Promise.resolve({ outcome: 'NOT_FOUND' });
  }

  reject(): Promise<{ outcome: 'NOT_FOUND' }> {
    return Promise.resolve({ outcome: 'NOT_FOUND' });
  }

  cancel(): Promise<{ outcome: 'NOT_FOUND' }> {
    return Promise.resolve({ outcome: 'NOT_FOUND' });
  }

  findPending(petId: string, email: string): Promise<PetInvitation | null> {
    this.pendingRequests.push({ petId, email });
    return Promise.resolve(this.pending);
  }

  createPending(
    invitation: PetInvitation,
    expiredInvitation: PetInvitation | null,
  ): Promise<CreatePendingInvitationOutcome> {
    this.creations.push({ invitation, expiredInvitation });

    if (this.error !== null) {
      return Promise.reject(this.error);
    }

    return Promise.resolve(this.outcome);
  }
}

interface TestContext {
  petQueries: FakePetQueryRepository;
  accounts: FakeAccountLookup;
  invitations: FakePetInvitationRepository;
  useCase: InviteCollaborator;
}

function createContext(): TestContext {
  const petQueries = new FakePetQueryRepository();
  const accounts = new FakeAccountLookup();
  const invitations = new FakePetInvitationRepository();
  const clock: Clock = { now: (): Date => new Date(NOW) };

  return {
    petQueries,
    accounts,
    invitations,
    useCase: new InviteCollaborator(petQueries, accounts, invitations, clock),
  };
}

function command(
  email: string = '  Ana@Example.COM  ',
): InviteCollaboratorCommand {
  return { petId: PET_ID, invitedByAccountId: OWNER_ID, email };
}

function pendingInvitation(expiresAt: Date): PetInvitation {
  return PetInvitation.reconstitute({
    id: InvitationId.generate(),
    petId: PetId.from(PET_ID),
    invitedEmail: InvitedEmail.from('ana@example.com'),
    invitedByAccountId: AccountId.from(OWNER_ID),
    status: PetInvitationStatus.PENDING,
    createdAt: new Date(expiresAt.getTime() - 604_800_000).toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

describe('InviteCollaborator', () => {
  it('creates a pending invitation for an email without an account', async () => {
    const context: TestContext = createContext();

    const result = await context.useCase.execute(command());

    expect(result).toEqual({
      id: expect.any(String) as string,
      petId: PET_ID,
      email: 'ana@example.com',
      status: 'PENDING',
      createdAt: '2026-09-26T12:30:00.000Z',
      expiresAt: '2026-10-03T12:30:00.000Z',
    });
    expect(context.petQueries.ownerRequests).toEqual([
      { petId: PET_ID, accountId: OWNER_ID },
    ]);
    expect(context.accounts.emails).toEqual(['ana@example.com']);
    expect(context.petQueries.membershipRequests).toEqual([]);
    expect(context.invitations.pendingRequests).toEqual([
      { petId: PET_ID, email: 'ana@example.com' },
    ]);
    expect(context.invitations.creations).toHaveLength(1);
    expect(context.invitations.creations[0].expiredInvitation).toBeNull();
  });

  it('invites an existing account with no active membership in this pet', async () => {
    const context: TestContext = createContext();
    context.accounts.accountId = INVITED_ACCOUNT_ID;

    await expect(context.useCase.execute(command())).resolves.toMatchObject({
      email: 'ana@example.com',
    });
    expect(context.petQueries.membershipRequests).toEqual([
      { petId: PET_ID, accountId: INVITED_ACCOUNT_ID },
    ]);
  });

  it.each(['OWNER', 'COLLABORATOR'])(
    'rejects an account with an active %s membership in this pet',
    async (role: 'OWNER' | 'COLLABORATOR') => {
      const context: TestContext = createContext();
      context.accounts.accountId = INVITED_ACCOUNT_ID;
      context.petQueries.targetMembership = { role, status: 'ACTIVE' };

      await expect(context.useCase.execute(command())).rejects.toThrow(
        AlreadyPetMemberError,
      );
      expect(context.invitations.creations).toHaveLength(0);
    },
  );

  it('allows an account whose membership in this pet is inactive', async () => {
    const context: TestContext = createContext();
    context.accounts.accountId = INVITED_ACCOUNT_ID;
    context.petQueries.targetMembership = {
      role: 'COLLABORATOR',
      status: 'INACTIVE',
    };

    await expect(context.useCase.execute(command())).resolves.toMatchObject({
      status: 'PENDING',
    });
    expect(context.invitations.creations).toHaveLength(1);
  });

  it('treats a self-invite as an already active member', async () => {
    const context: TestContext = createContext();
    context.accounts.accountId = OWNER_ID;
    context.petQueries.targetMembership = { role: 'OWNER', status: 'ACTIVE' };

    await expect(context.useCase.execute(command())).rejects.toThrow(
      AlreadyPetMemberError,
    );
  });

  it('rejects an equivalent pending invitation that has not expired', async () => {
    const context: TestContext = createContext();
    context.invitations.pending = pendingInvitation(
      new Date(NOW.getTime() + 1),
    );

    await expect(context.useCase.execute(command())).rejects.toThrow(
      InvitationAlreadyPendingError,
    );
    expect(context.invitations.pending.status).toBe(
      PetInvitationStatus.PENDING,
    );
    expect(context.invitations.creations).toHaveLength(0);
  });

  it('expires a pending invitation at the deadline and creates a new one', async () => {
    const context: TestContext = createContext();
    const previous: PetInvitation = pendingInvitation(NOW);
    context.invitations.pending = previous;

    await context.useCase.execute(command());

    expect(previous.status).toBe(PetInvitationStatus.EXPIRED);
    expect(context.invitations.creations).toHaveLength(1);
    expect(context.invitations.creations[0].expiredInvitation).toBe(previous);
    expect(context.invitations.creations[0].invitation.id.value).not.toBe(
      previous.id.value,
    );
  });

  it.each([
    'nonexistent pet',
    'archived pet',
    'requester without membership',
    'active collaborator requester',
    'inactive owner requester',
  ])('conceals a %s', async () => {
    const context: TestContext = createContext();
    context.petQueries.ownerAccess = false;

    await expect(context.useCase.execute(command())).rejects.toThrow(
      PetNotFoundError,
    );
    expect(context.accounts.emails).toEqual([]);
    expect(context.invitations.creations).toHaveLength(0);
  });

  it('rejects an invalid email for an authorized owner', async () => {
    const context: TestContext = createContext();

    await expect(context.useCase.execute(command('invalid'))).rejects.toThrow(
      InvalidInvitedEmailError,
    );
    expect(context.accounts.emails).toEqual([]);
  });

  it('maps a concurrent pending insertion outcome to the pending error', async () => {
    const context: TestContext = createContext();
    context.invitations.outcome =
      CreatePendingInvitationOutcome.ALREADY_PENDING;

    await expect(context.useCase.execute(command())).rejects.toThrow(
      InvitationAlreadyPendingError,
    );
  });

  it('maps revoked authorization at persistence to pet not found', async () => {
    const context: TestContext = createContext();
    context.invitations.outcome = CreatePendingInvitationOutcome.PET_NOT_FOUND;
    await expect(context.useCase.execute(command())).rejects.toThrow(
      PetNotFoundError,
    );
  });

  it('propagates unexpected persistence errors', async () => {
    const context: TestContext = createContext();
    const persistenceError = new Error('Database unavailable');
    context.invitations.error = persistenceError;

    await expect(context.useCase.execute(command())).rejects.toBe(
      persistenceError,
    );
  });
});
