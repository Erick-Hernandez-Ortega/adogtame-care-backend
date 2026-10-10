import { AccountId, MembershipId, PetMembership } from '../pet-membership/pet-membership';
import { preservesActiveOwnerOnDeactivation } from './pet-owner-invariant';

describe('active owner preservation on deactivation', () => {
    it.each([
        ['OWNER', 'ACTIVE', false, false],
        ['OWNER', 'ACTIVE', true, true],
        ['OWNER', 'INACTIVE', false, true],
        ['COLLABORATOR', 'ACTIVE', false, true],
        ['COLLABORATOR', 'INACTIVE', false, true],
    ] as const)(
        '%s %s with another owner=%s preserves the owner set=%s',
        (role, status, hasAnotherActiveOwner, expected) => {
            const membership: PetMembership = PetMembership.reconstitute({
                id: MembershipId.generate(),
                accountId: AccountId.from('550e8400-e29b-41d4-a716-446655440000'),
                role,
                status,
            });

            expect(preservesActiveOwnerOnDeactivation(membership, hasAnotherActiveOwner)).toBe(
                expected,
            );
        },
    );
});
