import type { BreedKind } from '../../domain/breed/breed.types';
import type { PetMembershipRole } from '../../domain/pet-membership/pet-membership.types';
import type { PetSex, PetSpecies } from '../../domain/pet/pet.types';

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

export interface PetQueryRepository {
  findAccessibleByAccountId(accountId: string): Promise<AccessiblePetSummary[]>;
}
