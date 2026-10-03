import {
  MembershipId,
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from '../pet-membership/pet-membership';
import { preservesActiveOwnerOnDeactivation } from './pet-owner-invariant';

export interface PetMemberRemovalDecision {
  outcome:
    'REMOVED' | 'SELF_REMOVAL_NOT_SUPPORTED' | 'LAST_OWNER_CANNOT_BE_REMOVED';
  membershipToSave: PetMembership | null;
}

export class PetMemberRemovalPolicy {
  static decide(
    requesterMembershipId: MembershipId,
    target: PetMembership,
    hasAnotherActiveOwner: boolean,
  ): PetMemberRemovalDecision {
    if (requesterMembershipId.value === target.id.value) {
      return { outcome: 'SELF_REMOVAL_NOT_SUPPORTED', membershipToSave: null };
    }
    if (target.status === PetMembershipStatus.INACTIVE) {
      return { outcome: 'REMOVED', membershipToSave: null };
    }
    if (!preservesActiveOwnerOnDeactivation(target, hasAnotherActiveOwner)) {
      return {
        outcome: 'LAST_OWNER_CANNOT_BE_REMOVED',
        membershipToSave: null,
      };
    }
    return {
      outcome: 'REMOVED',
      membershipToSave:
        target.role === PetMembershipRole.OWNER
          ? target.removeAsOwner()
          : target.removeAsCollaborator(),
    };
  }
}
