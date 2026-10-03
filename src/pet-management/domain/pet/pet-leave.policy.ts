import {
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from '../pet-membership/pet-membership';
import { preservesActiveOwnerOnDeactivation } from './pet-owner-invariant';

export interface PetLeaveDecision {
  outcome: 'LEFT' | 'ALREADY_LEFT' | 'LAST_OWNER_CANNOT_LEAVE';
  membershipToSave: PetMembership | null;
}

export class PetLeavePolicy {
  static decide(
    membership: PetMembership,
    hasAnotherActiveOwner: boolean,
  ): PetLeaveDecision {
    if (membership.status === PetMembershipStatus.INACTIVE) {
      return { outcome: 'ALREADY_LEFT', membershipToSave: null };
    }
    if (membership.role === PetMembershipRole.OWNER) {
      if (
        !preservesActiveOwnerOnDeactivation(membership, hasAnotherActiveOwner)
      ) {
        return { outcome: 'LAST_OWNER_CANNOT_LEAVE', membershipToSave: null };
      }
      return { outcome: 'LEFT', membershipToSave: membership.leaveAsOwner() };
    }
    return {
      outcome: 'LEFT',
      membershipToSave: membership.leaveAsCollaborator(),
    };
  }
}
