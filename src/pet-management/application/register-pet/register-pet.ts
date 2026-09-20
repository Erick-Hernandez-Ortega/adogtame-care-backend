import { BirthInformation } from '../../domain/birth-information/birth-information';
import type { BirthDateAccuracy } from '../../domain/birth-information/birth-information.types';
import { Breed } from '../../domain/breed/breed';
import type { BreedKind } from '../../domain/breed/breed.types';
import { Pet } from '../../domain/pet/pet';
import type { PetRepository } from '../persistence/pet.repository';
import type { RegisteredPet, RegisterPetCommand } from './register-pet.types';

export class InvalidPetRegistrationError extends Error {
  constructor(cause: TypeError | RangeError) {
    super(cause.message, { cause });
    this.name = 'InvalidPetRegistrationError';
  }
}

export class RegisterPet {
  constructor(private readonly petRepository: PetRepository) {}

  async execute(command: RegisterPetCommand): Promise<RegisteredPet> {
    let pet: Pet;

    try {
      const breed: Breed = this.createBreed(command.breed);
      const birthInformation: BirthInformation = this.createBirthInformation(
        command.birthInformation,
      );

      pet = Pet.register({
        name: command.name,
        species: command.species,
        breed,
        sex: command.sex,
        birthInformation,
        ownerAccountId: command.ownerAccountId,
        color: command.color,
        distinctiveMarks: command.distinctiveMarks,
        microchip: command.microchip,
      });
    } catch (error: unknown) {
      if (error instanceof TypeError || error instanceof RangeError) {
        throw new InvalidPetRegistrationError(error);
      }

      throw error;
    }

    await this.petRepository.save(pet);

    return {
      id: pet.id.value,
      name: pet.name,
      species: pet.species,
      breed: {
        name: pet.breed.name,
        kind: pet.breed.kind,
      },
      sex: pet.sex,
      birthInformation: {
        date: pet.birthInformation.date,
        accuracy: pet.birthInformation.accuracy,
      },
      color: pet.color ?? null,
      distinctiveMarks: pet.distinctiveMarks ?? null,
      microchip: pet.microchip ?? null,
      status: pet.status,
      memberships: pet.memberships.map((membership) => ({
        id: membership.id.value,
        accountId: membership.accountId.value,
        role: membership.role,
      })),
    };
  }

  private createBreed(input: { name: string; kind: BreedKind }): Breed {
    if (input.kind === 'KNOWN') {
      return Breed.known(input.name);
    }

    return Breed.custom(input.name);
  }

  private createBirthInformation(input: {
    date: string;
    accuracy: BirthDateAccuracy;
  }): BirthInformation {
    if (input.accuracy === 'EXACT') {
      return BirthInformation.exact(input.date);
    }

    return BirthInformation.approximate(input.date);
  }
}
