import { generateUuid, isValidUuid } from '../shared/uuid';
import type { PetMembershipRole as PetMembershipRoleType } from './pet-membership.types';

export const PetMembershipRole = {
  OWNER: 'OWNER',
  COLLABORATOR: 'COLLABORATOR',
} as const satisfies Record<string, PetMembershipRoleType>;

export class MembershipId {
  private constructor(readonly value: string) {}

  static generate(): MembershipId {
    return new MembershipId(generateUuid());
  }
}

export class UserId {
  private constructor(readonly value: string) {}

  static from(value: string): UserId {
    const normalizedValue: string = value.toLowerCase();

    if (!isValidUuid(normalizedValue)) {
      throw new TypeError('User ID must be a valid non-nil UUID');
    }

    return new UserId(normalizedValue);
  }
}

export class PetMembership {
  private constructor(
    readonly id: MembershipId,
    readonly userId: UserId,
    readonly role: PetMembershipRoleType,
  ) {}

  static createInitialOwner(userId: UserId): PetMembership {
    return new PetMembership(
      MembershipId.generate(),
      userId,
      PetMembershipRole.OWNER,
    );
  }
}
