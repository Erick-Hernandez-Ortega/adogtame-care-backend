import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { AccountLookup } from '../identity/account-lookup';
import {
  CreatePendingInvitationOutcome,
  type PetInvitationRepository,
} from '../persistence/pet-invitation.repository';
import type { PetQueryRepository } from '../persistence/pet-query.repository';
import type { Clock } from '../time/clock';
import { AccountId } from '../../domain/pet-membership/pet-membership';
import {
  InvitedEmail,
  PetInvitation,
  PetInvitationStatus,
} from '../../domain/pet-invitation/pet-invitation';
import { PetId } from '../../domain/pet/pet';
import type {
  CreatedPetInvitation,
  InviteCollaboratorCommand,
} from './invite-collaborator.types';

export class InvalidInvitedEmailError extends Error {
  constructor(cause: TypeError) {
    super(cause.message, { cause });
    this.name = 'InvalidInvitedEmailError';
  }
}

export class AlreadyPetMemberError extends Error {
  constructor() {
    super('Account is already a member of this pet');
    this.name = 'AlreadyPetMemberError';
  }
}

export class InvitationAlreadyPendingError extends Error {
  constructor() {
    super('An invitation is already pending for this email');
    this.name = 'InvitationAlreadyPendingError';
  }
}

export class InviteCollaborator {
  constructor(
    private readonly petQueryRepository: PetQueryRepository,
    private readonly accountLookup: AccountLookup,
    private readonly petInvitationRepository: PetInvitationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: InviteCollaboratorCommand,
  ): Promise<CreatedPetInvitation> {
    const hasOwnerAccess: boolean =
      await this.petQueryRepository.hasActiveOwnerAccess(
        command.petId,
        command.invitedByAccountId,
      );

    if (!hasOwnerAccess) {
      throw new PetNotFoundError();
    }

    let invitedEmail: InvitedEmail;

    try {
      invitedEmail = InvitedEmail.from(command.email);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        throw new InvalidInvitedEmailError(error);
      }

      throw error;
    }

    const invitedAccountId: string | null =
      await this.accountLookup.findAccountIdByEmail(invitedEmail.value);

    if (invitedAccountId !== null) {
      const hasActiveMembership: boolean =
        await this.petQueryRepository.hasActiveMembership(
          command.petId,
          invitedAccountId,
        );

      if (hasActiveMembership) {
        throw new AlreadyPetMemberError();
      }
    }

    const now: Date = this.clock.now();
    const pendingInvitation: PetInvitation | null =
      await this.petInvitationRepository.findPending(
        command.petId,
        invitedEmail.value,
      );

    if (pendingInvitation !== null && !pendingInvitation.expireIfDue(now)) {
      throw new InvitationAlreadyPendingError();
    }

    const invitation: PetInvitation = PetInvitation.create({
      petId: PetId.from(command.petId),
      invitedEmail,
      invitedByAccountId: AccountId.from(command.invitedByAccountId),
      createdAt: now,
    });
    const outcome: CreatePendingInvitationOutcome =
      await this.petInvitationRepository.createPending(
        invitation,
        pendingInvitation,
      );

    if (outcome === CreatePendingInvitationOutcome.PET_NOT_FOUND)
      throw new PetNotFoundError();

    if (outcome === CreatePendingInvitationOutcome.ALREADY_PENDING) {
      throw new InvitationAlreadyPendingError();
    }

    return {
      id: invitation.id.value,
      petId: invitation.petId.value,
      email: invitation.invitedEmail.value,
      status: PetInvitationStatus.PENDING,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    };
  }
}
