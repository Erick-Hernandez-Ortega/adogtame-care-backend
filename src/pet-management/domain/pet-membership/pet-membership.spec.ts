import { AccountId, PetMembership, PetMembershipRole } from './pet-membership';

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT_ID_V1: string = '550e8400-e29b-11d4-a716-446655440000';
const ACCOUNT_ID_V7: string = '01890f47-6c2e-7c42-98c4-dc0c0c07398f';

describe('PetMembership', () => {
  it('creates the initial owner membership with its own identity', () => {
    const accountId: AccountId = AccountId.from(ACCOUNT_ID_V1);

    const membership: PetMembership =
      PetMembership.createInitialOwner(accountId);

    expect(membership.id.value).toMatch(UUID_PATTERN);
    expect(membership.accountId).toBe(accountId);
    expect(membership.role).toBe(PetMembershipRole.OWNER);
  });
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
