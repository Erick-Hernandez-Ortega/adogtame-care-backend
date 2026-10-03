import type { BirthDateAccuracy } from '../../domain/birth-information/birth-information.types';
import type { BreedKind } from '../../domain/breed/breed.types';
import type { PetMembershipRole } from '../../domain/pet-membership/pet-membership.types';
import type { PetSex, PetSpecies, PetStatus } from '../../domain/pet/pet.types';

export const PET_QUERY_REPOSITORY: unique symbol = Symbol(
  'PET_QUERY_REPOSITORY',
);

export interface AccessiblePetSummary {
  readonly id: string;
  readonly name: string;
  readonly species: PetSpecies;
  readonly breed: {
    readonly name: string;
    readonly kind: BreedKind;
  };
  readonly sex: PetSex;
  readonly role: PetMembershipRole;
}

export interface PetDetail {
  readonly id: string;
  readonly name: string;
  readonly species: PetSpecies;
  readonly breed: {
    readonly name: string;
    readonly kind: BreedKind;
  };
  readonly sex: PetSex;
  readonly birthInformation: {
    readonly date: string;
    readonly accuracy: BirthDateAccuracy;
  };
  readonly color: string | null;
  readonly distinctiveMarks: string | null;
  readonly microchip: string | null;
  readonly status: PetStatus;
  readonly role: PetMembershipRole;
}

export interface PetMemberSummary {
  readonly membershipId: string;
  readonly accountId: string;
  readonly role: PetMembershipRole;
}

export interface PetQueryRepository {
  findAccessibleMembers(
    petId: string,
    accountId: string,
  ): Promise<PetMemberSummary[] | null>;
  findAccessibleByAccountId(accountId: string): Promise<AccessiblePetSummary[]>;
  findAccessibleDetailById(
    petId: string,
    accountId: string,
  ): Promise<PetDetail | null>;
  hasActiveOwnerAccess(petId: string, accountId: string): Promise<boolean>;
  hasActiveMembership(petId: string, accountId: string): Promise<boolean>;
}
