import { randomUUID } from 'node:crypto';
import type { PetMembershipRole as PetMembershipRoleType } from './pet-membership.types';

export const PetMembershipRole = {
  OWNER: 'OWNER',
  COLLABORATOR: 'COLLABORATOR',
} as const satisfies Record<string, PetMembershipRoleType>;

const CANONICAL_UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID: string = '00000000-0000-0000-0000-000000000000';

export class MembershipId {
  private constructor(readonly value: string) {}

  static generate(): MembershipId {
    return new MembershipId(randomUUID());
  }
}

export class UserId {
  private constructor(readonly value: string) {}

  static from(value: string): UserId {
    const normalizedValue: string = value.toLowerCase();

    if (
      !CANONICAL_UUID_PATTERN.test(normalizedValue) ||
      normalizedValue === NIL_UUID
    ) {
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
