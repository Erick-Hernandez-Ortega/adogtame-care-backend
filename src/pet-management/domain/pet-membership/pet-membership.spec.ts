import { PetMembership, PetMembershipRole, UserId } from './pet-membership';

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USER_ID_V1: string = '550e8400-e29b-11d4-a716-446655440000';
const USER_ID_V7: string = '01890f47-6c2e-7c42-98c4-dc0c0c07398f';

describe('PetMembership', () => {
  it('creates the initial owner membership with its own identity', () => {
    const userId: UserId = UserId.from(USER_ID_V1);

    const membership: PetMembership = PetMembership.createInitialOwner(userId);

    expect(membership.id.value).toMatch(UUID_PATTERN);
    expect(membership.userId).toBe(userId);
    expect(membership.role).toBe(PetMembershipRole.OWNER);
  });
});

describe('UserId', () => {
  it.each([USER_ID_V1, USER_ID_V7])(
    'accepts a canonical non-nil UUID regardless of version: %s',
    (value: string) => {
      expect(UserId.from(value).value).toBe(value);
    },
  );

  it('normalizes hexadecimal characters to lowercase', () => {
    expect(UserId.from(USER_ID_V1.toUpperCase()).value).toBe(USER_ID_V1);
  });

  it.each([
    '',
    ` ${USER_ID_V1}`,
    'not-a-uuid',
    '550e8400-e29b-11d4-a716',
    '550e8400-e29b-01d4-a716-446655440000',
    '550e8400-e29b-11d4-c716-446655440000',
    '00000000-0000-0000-0000-000000000000',
  ])('rejects an invalid UUID: %s', (value: string) => {
    expect(() => UserId.from(value)).toThrow(
      'User ID must be a valid non-nil UUID',
    );
  });
});
