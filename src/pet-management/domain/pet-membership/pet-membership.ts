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
}
