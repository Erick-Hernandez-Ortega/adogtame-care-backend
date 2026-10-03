import { BirthInformation } from '../birth-information/birth-information';
import { Breed } from '../breed/breed';
import { AccountId, PetMembership } from '../pet-membership/pet-membership';
import { generateUuid, isValidUuid } from '../shared/uuid';
import type {
  CorrectPetProfileInput,
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
    return new PetId(generateUuid());
  }

  static from(value: string): PetId {
    const normalizedValue: string = value.toLowerCase();

    if (!isValidUuid(normalizedValue)) {
      throw new TypeError('Pet ID must be a valid non-nil UUID');
    }

    return new PetId(normalizedValue);
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
    const profile = Pet.validateProfile(input);

    const ownerAccountId: AccountId = AccountId.from(input.ownerAccountId);
    const initialOwner: PetMembership =
      PetMembership.createInitialOwner(ownerAccountId);

    return new Pet({
      id: PetId.generate(),
      ...profile,
      status: PetStatus.ACTIVE,
      memberships: [initialOwner],
    });
  }

  static reconstitute(properties: PetProperties): Pet {
    if (
      !(properties.id instanceof PetId) ||
      !Object.values(PetStatus).includes(properties.status) ||
      !properties.memberships.every(
        (membership) => membership instanceof PetMembership,
      )
    ) {
      throw new TypeError('Pet state is invalid');
    }

    const profile = Pet.validateProfile(properties);
    return new Pet({
      id: properties.id,
      ...profile,
      status: properties.status,
      memberships: [...properties.memberships],
    });
  }

  archive(): Pet {
    if (this.status === PetStatus.ARCHIVED) return this;
    return new Pet({ ...this.properties, status: PetStatus.ARCHIVED });
  }

  correctProfile(input: CorrectPetProfileInput): Pet {
    const profile = Pet.validateProfile({
      name: input.name ?? this.name,
      species: input.species ?? this.species,
      breed: input.breed ?? this.breed,
      sex: input.sex ?? this.sex,
      birthInformation: input.birthInformation ?? this.birthInformation,
      color:
        input.color === undefined ? this.color : (input.color ?? undefined),
      distinctiveMarks:
        input.distinctiveMarks === undefined
          ? this.distinctiveMarks
          : (input.distinctiveMarks ?? undefined),
      microchip:
        input.microchip === undefined
          ? this.microchip
          : (input.microchip ?? undefined),
    });

    if (
      profile.name === this.name &&
      profile.species === this.species &&
      profile.breed.name === this.breed.name &&
      profile.breed.kind === this.breed.kind &&
      profile.sex === this.sex &&
      profile.birthInformation.date === this.birthInformation.date &&
      profile.birthInformation.accuracy === this.birthInformation.accuracy &&
      profile.color === this.color &&
      profile.distinctiveMarks === this.distinctiveMarks &&
      profile.microchip === this.microchip
    ) {
      return this;
    }

    return new Pet({
      ...this.properties,
      ...profile,
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

  private static validateProfile(
    input: Pick<
      PetProperties,
      | 'name'
      | 'species'
      | 'breed'
      | 'sex'
      | 'birthInformation'
      | 'color'
      | 'distinctiveMarks'
      | 'microchip'
    >,
  ): Pick<
    PetProperties,
    | 'name'
    | 'species'
    | 'breed'
    | 'sex'
    | 'birthInformation'
    | 'color'
    | 'distinctiveMarks'
    | 'microchip'
  > {
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
    return {
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
    };
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
