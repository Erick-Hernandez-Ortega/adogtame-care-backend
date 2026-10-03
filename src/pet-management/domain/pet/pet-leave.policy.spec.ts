import {
  AccountId,
  MembershipId,
  PetMembership,
} from '../pet-membership/pet-membership';
import type {
  PetMembershipRole,
  PetMembershipStatus,
} from '../pet-membership/pet-membership.types';
import { PetLeavePolicy, type PetLeaveDecision } from './pet-leave.policy';

function membership(
  role: PetMembershipRole,
  status: PetMembershipStatus,
): PetMembership {
  return PetMembership.reconstitute({
    id: MembershipId.generate(),
    accountId: AccountId.from('550e8400-e29b-41d4-a716-446655440000'),
    role,
    status,
  });
}

describe('PetLeavePolicy', () => {
  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'allows an active %s to leave and preserves identity and role',
    (role) => {
      const original: PetMembership = membership(role, 'ACTIVE');
      const decision: PetLeaveDecision = PetLeavePolicy.decide(original, true);
      expect(decision.outcome).toBe('LEFT');
      expect(decision.membershipToSave).toMatchObject({
        id: original.id,
        accountId: original.accountId,
        role,
        status: 'INACTIVE',
      });
      expect(original.status).toBe('ACTIVE');
    },
  );

  it('rejects the last active owner without a transition', () => {
    const original: PetMembership = membership('OWNER', 'ACTIVE');
    expect(PetLeavePolicy.decide(original, false)).toEqual({
      outcome: 'LAST_OWNER_CANNOT_LEAVE',
      membershipToSave: null,
    });
    expect(original.status).toBe('ACTIVE');
  });

  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'does not reevaluate ownership for an inactive %s',
    (role) => {
      expect(
        PetLeavePolicy.decide(membership(role, 'INACTIVE'), false),
      ).toEqual({ outcome: 'ALREADY_LEFT', membershipToSave: null });
    },
  );

  it('allows collaborator leave independently of other owners', () => {
    expect(
      PetLeavePolicy.decide(membership('COLLABORATOR', 'ACTIVE'), false)
        .outcome,
    ).toBe('LEFT');
  });
});
