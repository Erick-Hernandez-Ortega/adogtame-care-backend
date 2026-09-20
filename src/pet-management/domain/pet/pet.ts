import { randomUUID } from 'node:crypto';
import { BirthInformation } from '../birth-information/birth-information';
import { Breed } from '../breed/breed';
import { PetMembership, UserId } from '../pet-membership/pet-membership';
import type {
  PetProperties,
  PetSex as PetSexType,
  PetSpecies as PetSpeciesType,
  PetStatus as PetStatusType,
  RegisterPetInput,
} from './pet.types';

export const PetSpecies = {
  DOG: 'DOG',
  CAT: 'CAT',
} as const satisfies Record<string, PetSpeciesType>;

export const PetSex = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  UNKNOWN: 'UNKNOWN',
} as const satisfies Record<string, PetSexType>;

export const PetStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const satisfies Record<string, PetStatusType>;

export class PetId {
  private constructor(readonly value: string) {}

  static generate(): PetId {
    return new PetId(randomUUID());
  }
}

const SUPPORTED_SPECIES: ReadonlySet<string> = new Set<string>(
  Object.values(PetSpecies),
);
const SUPPORTED_SEXES: ReadonlySet<string> = new Set<string>(
  Object.values(PetSex),
);

export class Pet {
  private constructor(private readonly properties: PetProperties) {}

  static register(input: RegisterPetInput): Pet {
    const name: string = Pet.requiredText(input.name, 'Pet name');

    if (!SUPPORTED_SPECIES.has(input.species)) {
      throw new TypeError('Pet species is not supported');
    }

    if (!SUPPORTED_SEXES.has(input.sex)) {
      throw new TypeError('Pet sex is not supported');
    }

    if (!(input.breed instanceof Breed)) {
      throw new TypeError('Pet breed must be a Breed');
    }

    if (!(input.birthInformation instanceof BirthInformation)) {
      throw new TypeError('Pet birth information must be a BirthInformation');
    }

    const ownerId: UserId = UserId.from(input.ownerId);
    const initialOwner: PetMembership =
      PetMembership.createInitialOwner(ownerId);

    return new Pet({
      id: PetId.generate(),
      name,
      species: input.species,
      breed: input.breed,
      sex: input.sex,
      birthInformation: input.birthInformation,
      color: Pet.optionalText(input.color, 'Pet color'),
      distinctiveMarks: Pet.optionalText(
        input.distinctiveMarks,
        'Pet distinctive marks',
      ),
      microchip: Pet.optionalText(input.microchip, 'Pet microchip'),
      status: PetStatus.ACTIVE,
      memberships: [initialOwner],
    });
  }

  get id(): PetId {
    return this.properties.id;
  }

  get name(): string {
    return this.properties.name;
  }

  get species(): PetSpeciesType {
    return this.properties.species;
  }

  get breed(): Breed {
    return this.properties.breed;
  }

  get sex(): PetSexType {
    return this.properties.sex;
  }

  get birthInformation(): BirthInformation {
    return this.properties.birthInformation;
  }

  get color(): string | undefined {
    return this.properties.color;
  }

  get distinctiveMarks(): string | undefined {
    return this.properties.distinctiveMarks;
  }

  get microchip(): string | undefined {
    return this.properties.microchip;
  }

  get status(): PetStatusType {
    return this.properties.status;
  }

  get memberships(): readonly PetMembership[] {
    return [...this.properties.memberships];
  }

  private static requiredText(value: string, fieldName: string): string {
    const normalizedValue: string = value.trim();

    if (normalizedValue.length === 0) {
      throw new TypeError(`${fieldName} cannot be empty`);
    }

    return normalizedValue;
  }

  private static optionalText(
    value: string | undefined,
    fieldName: string,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    return Pet.requiredText(value, fieldName);
  }
}
