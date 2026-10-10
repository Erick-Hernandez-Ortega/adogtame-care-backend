import { PetInvitation, PetInvitationStatus } from '../../domain/pet-invitation/pet-invitation';
import type { AccountLookup } from '../identity/account-lookup';
import type { PetInvitationRepository } from '../persistence/pet-invitation.repository';

export type RejectionDecision =
    | { outcome: 'REJECTED' | 'EXPIRED'; invitationToSave: PetInvitation | null }
    | { outcome: 'NOT_PENDING'; invitationToSave: null };

export interface RejectedPetInvitation {
    id: string;
    petId: string;
    status: 'REJECTED';
}

export class RejectInvitationNotFoundError extends Error {
    constructor() {
        super('Invitation was not found');
    }
}

export class RejectInvitationExpiredError extends Error {
    constructor() {
        super('Invitation has expired');
    }
}

export class RejectInvitationNotPendingError extends Error {
    constructor() {
        super('Invitation is not pending');
    }
}

export function decideRejection(invitation: PetInvitation, now: Date): RejectionDecision {
    if (invitation.status === PetInvitationStatus.REJECTED) {
        return { outcome: 'REJECTED', invitationToSave: null };
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

    invitation.reject(now);

    return { outcome: 'REJECTED', invitationToSave: invitation };
}

export class RejectInvitation {
    constructor(
        private readonly accountLookup: AccountLookup,
        private readonly invitationRepository: PetInvitationRepository,
    ) {}

    async execute(
        invitationId: string,
        authenticatedAccountId: string,
    ): Promise<RejectedPetInvitation> {
        const email: string | null =
            await this.accountLookup.findEmailByAccountId(authenticatedAccountId);

        if (email === null) {
            throw new RejectInvitationNotFoundError();
        }

        const result = await this.invitationRepository.reject(invitationId, email);

        switch (result.outcome) {
            case 'NOT_FOUND':
                throw new RejectInvitationNotFoundError();
            case 'EXPIRED':
                throw new RejectInvitationExpiredError();
            case 'NOT_PENDING':
                throw new RejectInvitationNotPendingError();
            case 'REJECTED':
                return { id: result.id, petId: result.petId, status: 'REJECTED' };
        }
    }
}
