import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { PetInvitationRepository } from '../persistence/pet-invitation.repository';
import {
  PetInvitation,
  PetInvitationStatus,
} from '../../domain/pet-invitation/pet-invitation';

export type CancellationDecision =
  | { outcome: 'CANCELLED' | 'EXPIRED'; invitationToSave: PetInvitation | null }
  | { outcome: 'NOT_PENDING'; invitationToSave: null };

export interface CancelledPetInvitation {
  id: string;
  petId: string;
  status: 'CANCELLED';
}

export class CancelInvitationNotFoundError extends Error {
  constructor() {
    super('Invitation was not found');
  }
}

export class CancelInvitationExpiredError extends Error {
  constructor() {
    super('Invitation has expired');
  }
}

export class CancelInvitationNotPendingError extends Error {
  constructor() {
    super('Invitation is not pending');
  }
}

export function decideCancellation(
  invitation: PetInvitation,
  now: Date,
): CancellationDecision {
  if (invitation.status === PetInvitationStatus.CANCELLED) {
    return { outcome: 'CANCELLED', invitationToSave: null };
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
  invitation.cancel(now);
  return { outcome: 'CANCELLED', invitationToSave: invitation };
}

export class CancelInvitation {
  constructor(private readonly invitationRepository: PetInvitationRepository) {}

  async execute(
    invitationId: string,
    authenticatedAccountId: string,
  ): Promise<CancelledPetInvitation> {
    const result = await this.invitationRepository.cancel(
      invitationId,
      authenticatedAccountId,
    );
    switch (result.outcome) {
      case 'NOT_FOUND':
        throw new CancelInvitationNotFoundError();
      case 'PET_NOT_FOUND':
        throw new PetNotFoundError();
      case 'EXPIRED':
        throw new CancelInvitationExpiredError();
      case 'NOT_PENDING':
        throw new CancelInvitationNotPendingError();
      case 'CANCELLED':
        return { id: result.id, petId: result.petId, status: 'CANCELLED' };
    }
  }
}
