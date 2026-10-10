import type { AccountLookup } from '../identity/account-lookup';
import type { PetInvitationRepository } from '../persistence/pet-invitation.repository';
import {
    AccountId,
    PetMembership,
    PetMembershipStatus,
} from '../../domain/pet-membership/pet-membership';
import { PetInvitation, PetInvitationStatus } from '../../domain/pet-invitation/pet-invitation';
import { PetStatus } from '../../domain/pet/pet';
import type { PetStatus as PetStatusType } from '../../domain/pet/pet.types';

export type AcceptanceDecision =
    | { outcome: 'EXPIRED'; invitationToSave: PetInvitation | null }
    | { outcome: 'NOT_PENDING' | 'NOT_ACCEPTABLE'; invitationToSave: null }
    | {
          outcome: 'ACCEPTED';
          invitationToSave: PetInvitation | null;
          membershipChange: {
              kind: 'CREATE' | 'REACTIVATE';
              membership: PetMembership;
          } | null;
      };

export interface AcceptedPetInvitation {
    id: string;
    petId: string;
    status: 'ACCEPTED';
}

export class InvitationNotFoundError extends Error {
    constructor() {
        super('Invitation was not found');
    }
}

export class InvitationExpiredError extends Error {
    constructor() {
        super('Invitation has expired');
    }
}

export class InvitationNotPendingError extends Error {
    constructor() {
        super('Invitation is not pending');
    }
}

export class InvitationNotAcceptableError extends Error {
    constructor() {
        super('Invitation can no longer be accepted');
    }
}

export function decideAcceptance(
    invitation: PetInvitation,
    petStatus: PetStatusType,
    membership: PetMembership | null,
    accountId: string,
    now: Date,
): AcceptanceDecision {
    if (invitation.status === PetInvitationStatus.ACCEPTED) {
        return {
            outcome: 'ACCEPTED',
            invitationToSave: null,
            membershipChange: null,
        };
    }

    if (invitation.status === PetInvitationStatus.EXPIRED) {
        return { outcome: 'EXPIRED', invitationToSave: null };
    }

    if (invitation.status !== PetInvitationStatus.PENDING) {
        return { outcome: 'NOT_PENDING', invitationToSave: null };
    }

    if (invitation.expireIfDue(now)) {
        return { outcome: 'EXPIRED', invitationToSave: invitation };
    }

    if (petStatus !== PetStatus.ACTIVE) {
        return { outcome: 'NOT_ACCEPTABLE', invitationToSave: null };
    }

    let membershipChange: Extract<AcceptanceDecision, { outcome: 'ACCEPTED' }>['membershipChange'] =
        null;

    if (membership === null) {
        membershipChange = {
            kind: 'CREATE',
            membership: PetMembership.createCollaborator(AccountId.from(accountId)),
        };
    } else if (membership.status === PetMembershipStatus.INACTIVE) {
        membershipChange = {
            kind: 'REACTIVATE',
            membership: membership.reactivateAsCollaborator(),
        };
    }

    invitation.accept(now);

    return {
        outcome: 'ACCEPTED',
        invitationToSave: invitation,
        membershipChange,
    };
}

export class AcceptInvitation {
    constructor(
        private readonly accountLookup: AccountLookup,
        private readonly invitationRepository: PetInvitationRepository,
    ) {}

    async execute(
        invitationId: string,
        authenticatedAccountId: string,
    ): Promise<AcceptedPetInvitation> {
        const email: string | null =
            await this.accountLookup.findEmailByAccountId(authenticatedAccountId);

        if (email === null) {
            throw new InvitationNotFoundError();
        }

        const result = await this.invitationRepository.accept(
            invitationId,
            email,
            authenticatedAccountId,
        );

        switch (result.outcome) {
            case 'NOT_FOUND':
                throw new InvitationNotFoundError();
            case 'EXPIRED':
                throw new InvitationExpiredError();
            case 'NOT_PENDING':
                throw new InvitationNotPendingError();
            case 'NOT_ACCEPTABLE':
                throw new InvitationNotAcceptableError();
            case 'ACCEPTED':
                return { id: result.id, petId: result.petId, status: 'ACCEPTED' };
        }
    }
}
