import type { BirthDateAccuracy } from '../../domain/birth-information/birth-information.types';
import type { BreedKind } from '../../domain/breed/breed.types';
import type { PetMembershipRole } from '../../domain/pet-membership/pet-membership.types';
import type { PetSex, PetSpecies, PetStatus } from '../../domain/pet/pet.types';

export interface RegisterPetCommand {
  name: string;
  species: PetSpecies;
  breed: {
    name: string;
    kind: BreedKind;
  };
  sex: PetSex;
  birthInformation: {
    date: string;
    accuracy: BirthDateAccuracy;
  };
  ownerId: string;
  color?: string;
  distinctiveMarks?: string;
  microchip?: string;
}

export interface RegisteredPetMembership {
  id: string;
  userId: string;
  role: PetMembershipRole;
}

export interface RegisteredPet {
  id: string;
  name: string;
  species: PetSpecies;
  breed: {
    name: string;
    kind: BreedKind;
  };
  sex: PetSex;
  birthInformation: {
    date: string;
    accuracy: BirthDateAccuracy;
  };
  color: string | null;
  distinctiveMarks: string | null;
  microchip: string | null;
  status: PetStatus;
  memberships: RegisteredPetMembership[];
}
