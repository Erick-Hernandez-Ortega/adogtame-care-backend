import { AccountId } from '../pet-membership/pet-membership';
import { PetId } from '../pet/pet';
import { generateUuid, isValidUuid } from '../shared/uuid';
import type { PetInvitationStatus as PetInvitationStatusType } from './pet-invitation.types';

const EMAIL_FORMAT: RegExp = /^[^\s@]+@[^\s@]+$/;
const INVITATION_DURATION_MS: number = 7 * 24 * 60 * 60 * 1000;

export const PetInvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const satisfies Record<string, PetInvitationStatusType>;

export class InvitationId {
  private constructor(readonly value: string) {}

  static generate(): InvitationId {
    return new InvitationId(generateUuid());
  }

  static from(value: string): InvitationId {
    const normalizedValue: string = value.toLowerCase();

    if (!isValidUuid(normalizedValue)) {
      throw new TypeError('Invitation ID must be a valid non-nil UUID');
    }

    return new InvitationId(normalizedValue);
  }
}

export class InvitedEmail {
  private constructor(readonly value: string) {}

  static from(value: string): InvitedEmail {
    const normalizedValue: string = value.trim().toLowerCase();

    if (normalizedValue.length === 0) {
      throw new TypeError('Email cannot be empty');
    }

    if (!EMAIL_FORMAT.test(normalizedValue)) {
      throw new TypeError('Email format is invalid');
    }

    return new InvitedEmail(normalizedValue);
  }
}

interface CreatePetInvitationInput {
  petId: PetId;
  invitedEmail: InvitedEmail;
  invitedByAccountId: AccountId;
  createdAt: Date;
}

interface ReconstitutePetInvitationInput {
  id: InvitationId;
  petId: PetId;
  invitedEmail: InvitedEmail;
  invitedByAccountId: AccountId;
  status: PetInvitationStatusType;
  createdAt: string;
  expiresAt: string;
}

export class PetInvitation {
  private constructor(
    readonly id: InvitationId,
    readonly petId: PetId,
    readonly invitedEmail: InvitedEmail,
    readonly invitedByAccountId: AccountId,
    private statusValue: PetInvitationStatusType,
    readonly createdAt: string,
    readonly expiresAt: string,
  ) {}

  static create(input: CreatePetInvitationInput): PetInvitation {
    PetInvitation.assertIdentities(input);
    const createdAtMilliseconds: number = PetInvitation.validMilliseconds(
      input.createdAt,
    );
    const expiresAtMilliseconds: number =
      createdAtMilliseconds + INVITATION_DURATION_MS;
    PetInvitation.validMilliseconds(new Date(expiresAtMilliseconds));

    return new PetInvitation(
      InvitationId.generate(),
      input.petId,
      input.invitedEmail,
      input.invitedByAccountId,
      PetInvitationStatus.PENDING,
      new Date(createdAtMilliseconds).toISOString(),
      new Date(expiresAtMilliseconds).toISOString(),
    );
  }

  static reconstitute(input: ReconstitutePetInvitationInput): PetInvitation {
    PetInvitation.assertIdentities(input);
    const createdAtMilliseconds: number = PetInvitation.validMilliseconds(
      new Date(input.createdAt),
    );
    const expiresAtMilliseconds: number = PetInvitation.validMilliseconds(
      new Date(input.expiresAt),
    );

    if (
      !(input.id instanceof InvitationId) ||
      !Object.values(PetInvitationStatus).includes(input.status) ||
      new Date(createdAtMilliseconds).toISOString() !== input.createdAt ||
      new Date(expiresAtMilliseconds).toISOString() !== input.expiresAt ||
      expiresAtMilliseconds - createdAtMilliseconds !== INVITATION_DURATION_MS
    ) {
      throw new TypeError('Invitation state is invalid');
    }

    return new PetInvitation(
      input.id,
      input.petId,
      input.invitedEmail,
      input.invitedByAccountId,
      input.status,
      input.createdAt,
      input.expiresAt,
    );
  }

  get status(): PetInvitationStatusType {
    return this.statusValue;
  }

  expireIfDue(now: Date): boolean {
    if (this.statusValue !== PetInvitationStatus.PENDING) {
      throw new TypeError('Only a pending invitation can expire');
    }

    if (Date.parse(this.expiresAt) > PetInvitation.validMilliseconds(now)) {
      return false;
    }

    this.statusValue = PetInvitationStatus.EXPIRED;
    return true;
  }

  accept(now: Date): void {
    if (this.statusValue !== PetInvitationStatus.PENDING) {
      throw new TypeError('Only a pending invitation can be accepted');
    }

    if (this.expireIfDue(now)) {
      throw new TypeError('An expired invitation cannot be accepted');
    }

    this.statusValue = PetInvitationStatus.ACCEPTED;
  }

  private static assertIdentities(input: {
    petId: PetId;
    invitedEmail: InvitedEmail;
    invitedByAccountId: AccountId;
  }): void {
    if (
      !(input.petId instanceof PetId) ||
      !(input.invitedEmail instanceof InvitedEmail) ||
      !(input.invitedByAccountId instanceof AccountId)
    ) {
      throw new TypeError('Invitation identities are invalid');
    }
  }

  private static validMilliseconds(value: Date): number {
    const milliseconds: number = value.getTime();

    if (!Number.isFinite(milliseconds)) {
      throw new TypeError('Invitation date is invalid');
    }

    return milliseconds;
  }
}
