import { generateUuid, isValidUuid } from '../shared/uuid';
import type {
  PetMembershipRole as PetMembershipRoleType,
  PetMembershipStatus as PetMembershipStatusType,
} from './pet-membership.types';

export const PetMembershipRole = {
  OWNER: 'OWNER',
  COLLABORATOR: 'COLLABORATOR',
} as const satisfies Record<string, PetMembershipRoleType>;

export const PetMembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const satisfies Record<string, PetMembershipStatusType>;

export class MembershipId {
  private constructor(readonly value: string) {}

  static generate(): MembershipId {
    return new MembershipId(generateUuid());
  }

  static from(value: string): MembershipId {
    if (!isValidUuid(value)) {
      throw new TypeError('Membership ID must be a valid non-nil UUID');
    }

    return new MembershipId(value.toLowerCase());
  }
}

export class AccountId {
  private constructor(readonly value: string) {}

  static from(value: string): AccountId {
    const normalizedValue: string = value.toLowerCase();

    if (!isValidUuid(normalizedValue)) {
      throw new TypeError('Account ID must be a valid non-nil UUID');
    }

    return new AccountId(normalizedValue);
  }
}

export class PetMembership {
  private constructor(
    readonly id: MembershipId,
    readonly accountId: AccountId,
    readonly role: PetMembershipRoleType,
    readonly status: PetMembershipStatusType,
  ) {}

  static createInitialOwner(accountId: AccountId): PetMembership {
    return new PetMembership(
      MembershipId.generate(),
      accountId,
      PetMembershipRole.OWNER,
      PetMembershipStatus.ACTIVE,
    );
  }

  static createCollaborator(accountId: AccountId): PetMembership {
    return new PetMembership(
      MembershipId.generate(),
      accountId,
      PetMembershipRole.COLLABORATOR,
      PetMembershipStatus.ACTIVE,
    );
  }

  static reconstitute(input: {
    id: MembershipId;
    accountId: AccountId;
    role: PetMembershipRoleType;
    status: PetMembershipStatusType;
  }): PetMembership {
    if (
      !(input.id instanceof MembershipId) ||
      !(input.accountId instanceof AccountId) ||
      !Object.values(PetMembershipRole).includes(input.role) ||
      !Object.values(PetMembershipStatus).includes(input.status)
    ) {
      throw new TypeError('Membership state is invalid');
    }

    return new PetMembership(
      input.id,
      input.accountId,
      input.role,
      input.status,
    );
  }

  reactivateAsCollaborator(): PetMembership {
    if (this.status !== PetMembershipStatus.INACTIVE) {
      throw new TypeError('Only an inactive membership can be reactivated');
    }

    return new PetMembership(
      this.id,
      this.accountId,
      PetMembershipRole.COLLABORATOR,
      PetMembershipStatus.ACTIVE,
    );
  }
}
