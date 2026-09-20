import { BirthInformation } from '../birth-information/birth-information';
import { Breed } from '../breed/breed';
import { PetMembershipRole } from '../pet-membership/pet-membership';
import { Pet, PetSex, PetSpecies, PetStatus } from './pet';
import type {
  PetSex as PetSexType,
  PetSpecies as PetSpeciesType,
  RegisterPetInput,
} from './pet.types';

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER_ACCOUNT_ID_V1: string = '550e8400-e29b-11d4-a716-446655440000';

function validPetInput(
  overrides: Partial<RegisterPetInput> = {},
): RegisterPetInput {
  return {
    name: 'Luna',
    species: PetSpecies.DOG,
    breed: Breed.known('Labrador Retriever'),
    sex: PetSex.FEMALE,
    birthInformation: BirthInformation.exact('2021-06-14'),
    ownerAccountId: OWNER_ACCOUNT_ID_V1,
    ...overrides,
  };
}

describe('Pet', () => {
  it('registers a pet with its profile and a persistent identity', () => {
    const pet: Pet = Pet.register(
      validPetInput({
        name: ' Luna ',
        color: ' Golden ',
        distinctiveMarks: ' White spot on chest ',
        microchip: ' 981020000123456 ',
      }),
    );

    expect(pet.id.value).toMatch(UUID_PATTERN);
    expect(pet.name).toBe('Luna');
    expect(pet.species).toBe(PetSpecies.DOG);
    expect(pet.breed.name).toBe('Labrador Retriever');
    expect(pet.sex).toBe(PetSex.FEMALE);
    expect(pet.birthInformation.date).toBe('2021-06-14');
    expect(pet.color).toBe('Golden');
    expect(pet.distinctiveMarks).toBe('White spot on chest');
    expect(pet.microchip).toBe('981020000123456');
  });

  it('generates a different identity for each registered pet', () => {
    const firstPet: Pet = Pet.register(validPetInput());
    const secondPet: Pet = Pet.register(validPetInput());

    expect(firstPet.id.value).not.toBe(secondPet.id.value);
  });

  it('starts in the active status', () => {
    const pet: Pet = Pet.register(validPetInput());

    expect(pet.status).toBe(PetStatus.ACTIVE);
  });

  it('starts with exactly one owner membership', () => {
    const pet: Pet = Pet.register(validPetInput());

    expect(pet.memberships).toHaveLength(1);
    expect(pet.memberships[0]).toMatchObject({
      role: PetMembershipRole.OWNER,
      accountId: { value: OWNER_ACCOUNT_ID_V1 },
    });
    expect(pet.memberships[0].id.value).toMatch(UUID_PATTERN);
    expect(pet.memberships[0].id.value).not.toBe(pet.id.value);
  });

  it('protects its membership collection from external changes', () => {
    const pet: Pet = Pet.register(validPetInput());
    const memberships = [...pet.memberships];

    memberships.pop();

    expect(pet.memberships).toHaveLength(1);
  });

  it('rejects registering a pet without a valid owner account ID', () => {
    expect(() =>
      Pet.register(validPetInput({ ownerAccountId: 'not-a-uuid' })),
    ).toThrow('Account ID must be a valid non-nil UUID');
  });

  it('rejects an empty name', () => {
    expect(() => Pet.register(validPetInput({ name: '   ' }))).toThrow(
      'Pet name cannot be empty',
    );
  });

  it.each([
    ['color', { color: '  ' }],
    ['distinctive marks', { distinctiveMarks: '  ' }],
    ['microchip', { microchip: '  ' }],
  ])('rejects empty optional %s when provided', (_field: string, override) => {
    expect(() => Pet.register(validPetInput(override))).toThrow(
      'cannot be empty',
    );
  });

  it('rejects an unsupported species', () => {
    const unsupportedSpecies: PetSpeciesType = 'BIRD' as PetSpeciesType;

    expect(() =>
      Pet.register(validPetInput({ species: unsupportedSpecies })),
    ).toThrow('Pet species is not supported');
  });

  it('rejects an unsupported sex', () => {
    const unsupportedSex: PetSexType = 'UNSPECIFIED' as PetSexType;

    expect(() => Pet.register(validPetInput({ sex: unsupportedSex }))).toThrow(
      'Pet sex is not supported',
    );
  });
});
