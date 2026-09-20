import type { BirthInformation } from '../birth-information/birth-information';
import type { Breed } from '../breed/breed';
import type { PetMembership } from '../pet-membership/pet-membership';
import type { PetId } from './pet';

export type PetSpecies = 'DOG' | 'CAT';

export type PetSex = 'MALE' | 'FEMALE' | 'UNKNOWN';

export type PetStatus = 'ACTIVE' | 'ARCHIVED';

export interface RegisterPetInput {
  name: string;
  species: PetSpecies;
  breed: Breed;
  sex: PetSex;
  birthInformation: BirthInformation;
  ownerId: string;
  color?: string;
  distinctiveMarks?: string;
  microchip?: string;
}

export interface PetProperties {
  readonly id: PetId;
  readonly name: string;
  readonly species: PetSpecies;
  readonly breed: Breed;
  readonly sex: PetSex;
  readonly birthInformation: BirthInformation;
  readonly color?: string;
  readonly distinctiveMarks?: string;
  readonly microchip?: string;
  readonly status: PetStatus;
  readonly memberships: readonly PetMembership[];
}
