import {
    PetMembership,
    PetMembershipRole,
    PetMembershipStatus,
} from '../pet-membership/pet-membership';

export function preservesActiveOwnerOnDeactivation(
    membership: PetMembership,
    hasAnotherActiveOwner: boolean,
): boolean {
    return (
        membership.status === PetMembershipStatus.INACTIVE ||
        membership.role !== PetMembershipRole.OWNER ||
        hasAnotherActiveOwner
    );
}
