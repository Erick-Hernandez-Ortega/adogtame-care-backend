import type { PetInvitation } from '../../domain/pet-invitation/pet-invitation';

export const PET_INVITATION_REPOSITORY: unique symbol = Symbol(
  'PET_INVITATION_REPOSITORY',
);

export const CreatePendingInvitationOutcome = {
  CREATED: 'CREATED',
  ALREADY_PENDING: 'ALREADY_PENDING',
} as const;

export type CreatePendingInvitationOutcome =
  (typeof CreatePendingInvitationOutcome)[keyof typeof CreatePendingInvitationOutcome];

export type AcceptInvitationPersistenceResult =
  | { outcome: 'NOT_FOUND' | 'EXPIRED' | 'NOT_PENDING' | 'NOT_ACCEPTABLE' }
  | { outcome: 'ACCEPTED'; id: string; petId: string };

export interface PetInvitationRepository {
  findPending(petId: string, email: string): Promise<PetInvitation | null>;
  createPending(
    invitation: PetInvitation,
    expiredInvitation: PetInvitation | null,
  ): Promise<CreatePendingInvitationOutcome>;
  accept(
    invitationId: string,
    invitedEmail: string,
    accountId: string,
  ): Promise<AcceptInvitationPersistenceResult>;
}
