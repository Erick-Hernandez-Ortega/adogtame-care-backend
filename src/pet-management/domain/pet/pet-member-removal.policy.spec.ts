import { AccountId, MembershipId, PetMembership } from '../pet-membership/pet-membership';
import type {
    PetMembershipRole,
    PetMembershipStatus,
} from '../pet-membership/pet-membership.types';
import { PetMemberRemovalPolicy } from './pet-member-removal.policy';

const requesterId: MembershipId = MembershipId.from('550e8400-e29b-41d4-a716-446655440000');

function membership(
    role: PetMembershipRole,
    status: PetMembershipStatus,
    id: MembershipId = MembershipId.generate(),
): PetMembership {
    return PetMembership.reconstitute({
        id,
        accountId: AccountId.from('01890f47-6c2e-7c42-98c4-dc0c0c07398f'),
        role,
        status,
    });
}

describe('PetMemberRemovalPolicy', () => {
    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'removes an active %s preserving identity and role',
        (role) => {
            const original: PetMembership = membership(role, 'ACTIVE');
            const decision = PetMemberRemovalPolicy.decide(requesterId, original, true);

            expect(decision.outcome).toBe('REMOVED');
            expect(decision.membershipToSave).toMatchObject({
                id: original.id,
                accountId: original.accountId,
                role,
                status: 'INACTIVE',
            });
            expect(original.status).toBe('ACTIVE');
        },
    );

    it('protects the last active owner without a transition', () => {
        const original: PetMembership = membership('OWNER', 'ACTIVE');

        expect(PetMemberRemovalPolicy.decide(requesterId, original, false)).toEqual({
            outcome: 'LAST_OWNER_CANNOT_BE_REMOVED',
            membershipToSave: null,
        });
        expect(original.status).toBe('ACTIVE');
    });

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'does not reevaluate owners for another inactive %s',
        (role) => {
            expect(
                PetMemberRemovalPolicy.decide(requesterId, membership(role, 'INACTIVE'), false),
            ).toEqual({ outcome: 'REMOVED', membershipToSave: null });
        },
    );

    it.each(['ACTIVE', 'INACTIVE'] as const)(
        'rejects %s self-target before idempotence and last-owner checks',
        (status) => {
            const original: PetMembership = membership('OWNER', status, requesterId);

            for (const hasAnotherActiveOwner of [true, false]) {
                expect(
                    PetMemberRemovalPolicy.decide(requesterId, original, hasAnotherActiveOwner),
                ).toEqual({
                    outcome: 'SELF_REMOVAL_NOT_SUPPORTED',
                    membershipToSave: null,
                });
            }

            expect(original.status).toBe(status);
        },
    );

    it('removes collaborators independently of the other-owner fact', () => {
        expect(
            PetMemberRemovalPolicy.decide(requesterId, membership('COLLABORATOR', 'ACTIVE'), false)
                .outcome,
        ).toBe('REMOVED');
    });
});
