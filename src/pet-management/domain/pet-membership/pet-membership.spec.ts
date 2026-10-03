import {
  AccountId,
  InactivePetMembershipError,
  MembershipId,
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from './pet-membership';

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT_ID_V1: string = '550e8400-e29b-11d4-a716-446655440000';
const ACCOUNT_ID_V7: string = '01890f47-6c2e-7c42-98c4-dc0c0c07398f';

describe('PetMembership', () => {
  it('promotes an active collaborator without changing membership identity or status', () => {
    const membership: PetMembership = PetMembership.createCollaborator(
      AccountId.from(ACCOUNT_ID_V1),
    );
    const promoted: PetMembership = membership.promoteToOwner();
    expect(promoted).not.toBe(membership);
    expect(promoted.id).toBe(membership.id);
    expect(promoted.accountId).toBe(membership.accountId);
    expect(promoted.role).toBe(PetMembershipRole.OWNER);
    expect(promoted.status).toBe(PetMembershipStatus.ACTIVE);
    expect(membership.role).toBe(PetMembershipRole.COLLABORATOR);
  });

  it('returns an active owner unchanged', () => {
    const membership: PetMembership = PetMembership.createInitialOwner(
      AccountId.from(ACCOUNT_ID_V1),
    );
    expect(membership.promoteToOwner()).toBe(membership);
  });

  it.each([PetMembershipRole.OWNER, PetMembershipRole.COLLABORATOR])(
    'does not promote or reactivate an inactive %s',
    (role) => {
      const membership: PetMembership = PetMembership.reconstitute({
        id: MembershipId.from(ACCOUNT_ID_V7),
        accountId: AccountId.from(ACCOUNT_ID_V1),
        role,
        status: PetMembershipStatus.INACTIVE,
      });
      expect(() => membership.promoteToOwner()).toThrow(
        InactivePetMembershipError,
      );
      expect(membership.role).toBe(role);
      expect(membership.status).toBe(PetMembershipStatus.INACTIVE);
    },
  );
  it('creates the initial owner membership with its own identity', () => {
    const accountId: AccountId = AccountId.from(ACCOUNT_ID_V1);

    const membership: PetMembership =
      PetMembership.createInitialOwner(accountId);

    expect(membership.id.value).toMatch(UUID_PATTERN);
    expect(membership.accountId).toBe(accountId);
    expect(membership.role).toBe(PetMembershipRole.OWNER);
    expect(membership.status).toBe(PetMembershipStatus.ACTIVE);
  });

  it('creates an active collaborator', () => {
    const membership = PetMembership.createCollaborator(
      AccountId.from(ACCOUNT_ID_V1),
    );
    expect(membership.id.value).toMatch(UUID_PATTERN);
    expect(membership.role).toBe(PetMembershipRole.COLLABORATOR);
    expect(membership.status).toBe(PetMembershipStatus.ACTIVE);
  });

  it.each([PetMembershipRole.OWNER, PetMembershipRole.COLLABORATOR])(
    'reactivates an inactive %s as collaborator without changing identity',
    (role) => {
      const membership = PetMembership.reconstitute({
        id: MembershipId.from(ACCOUNT_ID_V7),
        accountId: AccountId.from(ACCOUNT_ID_V1),
        role,
        status: PetMembershipStatus.INACTIVE,
      });
      const reactivated = membership.reactivateAsCollaborator();
      expect(reactivated.id).toBe(membership.id);
      expect(reactivated.accountId).toBe(membership.accountId);
      expect(reactivated.role).toBe(PetMembershipRole.COLLABORATOR);
      expect(reactivated.status).toBe(PetMembershipStatus.ACTIVE);
    },
  );

  it('does not reactivate or downgrade an active owner', () => {
    const membership = PetMembership.createInitialOwner(
      AccountId.from(ACCOUNT_ID_V1),
    );
    expect(() => membership.reactivateAsCollaborator()).toThrow(
      'Only an inactive membership can be reactivated',
    );
    expect(membership.role).toBe(PetMembershipRole.OWNER);
  });

  it('removes an active collaborator while preserving identity and role', () => {
    const membership: PetMembership = PetMembership.createCollaborator(
      AccountId.from(ACCOUNT_ID_V1),
    );
    const removed: PetMembership = membership.removeAsCollaborator();
    expect(removed.id).toBe(membership.id);
    expect(removed.accountId).toBe(membership.accountId);
    expect(removed.role).toBe(PetMembershipRole.COLLABORATOR);
    expect(removed.status).toBe(PetMembershipStatus.INACTIVE);
    expect(membership.status).toBe(PetMembershipStatus.ACTIVE);
    expect(() => removed.removeAsCollaborator()).toThrow(
      'Only an active collaborator can be removed',
    );
  });

  it.each([PetMembershipStatus.ACTIVE, PetMembershipStatus.INACTIVE])(
    'does not remove a %s owner as collaborator',
    (status) => {
      const membership: PetMembership = PetMembership.reconstitute({
        id: MembershipId.from(ACCOUNT_ID_V7),
        accountId: AccountId.from(ACCOUNT_ID_V1),
        role: PetMembershipRole.OWNER,
        status,
      });
      expect(() => membership.removeAsCollaborator()).toThrow(
        'Only an active collaborator can be removed',
      );
      expect(membership.status).toBe(status);
    },
  );

  it('leaves an active collaborator without changing identity or role', () => {
    const membership = PetMembership.createCollaborator(
      AccountId.from(ACCOUNT_ID_V1),
    );
    const left = membership.leaveAsCollaborator();
    expect(left.id).toBe(membership.id);
    expect(left.accountId).toBe(membership.accountId);
    expect(left.role).toBe(PetMembershipRole.COLLABORATOR);
    expect(left.status).toBe(PetMembershipStatus.INACTIVE);
    expect(membership.status).toBe(PetMembershipStatus.ACTIVE);
    expect(() => left.leaveAsCollaborator()).toThrow(
      'Only an active collaborator can leave a pet',
    );
  });

  it.each([PetMembershipStatus.ACTIVE, PetMembershipStatus.INACTIVE])(
    'does not let a %s owner leave as collaborator',
    (status) => {
      const membership = PetMembership.reconstitute({
        id: MembershipId.from(ACCOUNT_ID_V7),
        accountId: AccountId.from(ACCOUNT_ID_V1),
        role: PetMembershipRole.OWNER,
        status,
      });
      expect(() => membership.leaveAsCollaborator()).toThrow(
        'Only an active collaborator can leave a pet',
      );
      expect(membership.role).toBe(PetMembershipRole.OWNER);
      expect(membership.status).toBe(status);
    },
  );
});

describe('AccountId', () => {
  it.each([ACCOUNT_ID_V1, ACCOUNT_ID_V7])(
    'accepts a canonical non-nil UUID regardless of version: %s',
    (value: string) => {
      expect(AccountId.from(value).value).toBe(value);
    },
  );

  it('normalizes hexadecimal characters to lowercase', () => {
    expect(AccountId.from(ACCOUNT_ID_V1.toUpperCase()).value).toBe(
      ACCOUNT_ID_V1,
    );
  });

  it.each([
    '',
    ` ${ACCOUNT_ID_V1}`,
    'not-a-uuid',
    '550e8400-e29b-11d4-a716',
    '550e8400-e29b-01d4-a716-446655440000',
    '550e8400-e29b-11d4-c716-446655440000',
    '00000000-0000-0000-0000-000000000000',
  ])('rejects an invalid UUID: %s', (value: string) => {
    expect(() => AccountId.from(value)).toThrow(
      'Account ID must be a valid non-nil UUID',
    );
  });
});
