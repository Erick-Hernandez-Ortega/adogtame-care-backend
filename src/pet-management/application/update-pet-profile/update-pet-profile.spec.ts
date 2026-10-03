import { BirthInformation } from '../../domain/birth-information/birth-information';
import { Breed } from '../../domain/breed/breed';
import { Pet } from '../../domain/pet/pet';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { PetRepository } from '../persistence/pet.repository';
import {
  InvalidPetProfileError,
  UpdatePetProfile,
  type UpdatePetProfileCommand,
} from './update-pet-profile';

const OWNER_ID: string = '550e8400-e29b-41d4-a716-446655440000';

function pet(): Pet {
  return Pet.register({
    name: 'Luna',
    species: 'DOG',
    breed: Breed.known('Labrador Retriever'),
    sex: 'FEMALE',
    birthInformation: BirthInformation.exact('2021-06-14'),
    ownerAccountId: OWNER_ID,
    color: 'Golden',
    distinctiveMarks: 'White spot',
    microchip: '12345',
  });
}

function command(currentPet: Pet): UpdatePetProfileCommand {
  return {
    petId: currentPet.id.value,
    authenticatedAccountId: OWNER_ID,
    name: 'Nala',
  };
}

function setup(currentPet: Pet | null = pet()) {
  let storedPet: Pet | null = currentPet;
  let correctionCalls: number = 0;
  const correctProfileIfOwned: PetRepository['correctProfileIfOwned'] = (
    petId,
    authenticatedAccountId,
    correct,
  ) => {
    expect(authenticatedAccountId).toBe(OWNER_ID);
    if (storedPet === null) return Promise.resolve(null);
    expect(petId).toBe(currentPet?.id.value);
    correctionCalls += 1;
    storedPet = correct(storedPet);
    return Promise.resolve(storedPet);
  };
  const repository: PetRepository = {
    restoreIfOwned: jest.fn(),
    archiveIfOwned: jest.fn() as PetRepository['archiveIfOwned'],
    promoteCollaboratorIfOwned:
      jest.fn() as PetRepository['promoteCollaboratorIfOwned'],
    removeMemberIfOwned: jest.fn() as PetRepository['removeMemberIfOwned'],
    save: jest.fn() as PetRepository['save'],
    correctProfileIfOwned,
    leave: jest.fn() as PetRepository['leave'],
  };
  return {
    useCase: new UpdatePetProfile(repository),
    getStoredPet: (): Pet | null => storedPet,
    getCorrectionCalls: (): number => correctionCalls,
  };
}

describe('UpdatePetProfile', () => {
  it.each([
    [{ name: 'Nala' }, { name: 'Nala' }],
    [{ species: 'CAT' }, { species: 'CAT' }],
    [
      { breed: { name: 'Mixed', kind: 'CUSTOM' } },
      { breed: { name: 'Mixed', kind: 'CUSTOM' } },
    ],
    [{ sex: 'MALE' }, { sex: 'MALE' }],
    [
      { birthInformation: { date: '2020-03-04', accuracy: 'APPROXIMATE' } },
      { birthInformation: { date: '2020-03-04', accuracy: 'APPROXIMATE' } },
    ],
    [{ color: 'Black' }, { color: 'Black' }],
    [{ distinctiveMarks: 'White paws' }, { distinctiveMarks: 'White paws' }],
    [{ microchip: '98765' }, { microchip: '98765' }],
  ] as const)(
    'coordinates a single profile correction: %#',
    async (patch, expected) => {
      const currentPet: Pet = pet();
      const fixture = setup(currentPet);
      const result = await fixture.useCase.execute({
        ...command(currentPet),
        name: undefined,
        ...patch,
      });
      expect(result).toMatchObject(expected);
    },
  );

  it('corrects combined fields and returns the Get Pet Detail representation', async () => {
    const currentPet: Pet = pet();
    const fixture = setup(currentPet);
    const result = await fixture.useCase.execute({
      ...command(currentPet),
      species: 'CAT',
      breed: { name: ' Domestic shorthair ', kind: 'CUSTOM' },
      sex: 'UNKNOWN',
      birthInformation: { date: '2020-01-02', accuracy: 'APPROXIMATE' },
      color: null,
      distinctiveMarks: ' White paws ',
      microchip: null,
    });

    expect(result).toEqual({
      id: currentPet.id.value,
      name: 'Nala',
      species: 'CAT',
      breed: { name: 'Domestic shorthair', kind: 'CUSTOM' },
      sex: 'UNKNOWN',
      birthInformation: { date: '2020-01-02', accuracy: 'APPROXIMATE' },
      color: null,
      distinctiveMarks: 'White paws',
      microchip: null,
      status: 'ACTIVE',
      role: 'OWNER',
    });
    expect(fixture.getStoredPet()?.memberships).toEqual(currentPet.memberships);
  });

  it('distinguishes omitted optional fields from explicit null', async () => {
    const currentPet: Pet = pet();
    const fixture = setup(currentPet);

    const result = await fixture.useCase.execute({
      petId: currentPet.id.value,
      authenticatedAccountId: OWNER_ID,
      color: null,
    });
    expect(result.color).toBeNull();
    expect(result.distinctiveMarks).toBe('White spot');
    expect(result.microchip).toBe('12345');
  });

  it('returns a normalized no-op without replacing the pet', async () => {
    const currentPet: Pet = pet();
    const fixture = setup(currentPet);

    const result = await fixture.useCase.execute({
      petId: currentPet.id.value,
      authenticatedAccountId: OWNER_ID,
      name: '  Luna  ',
    });
    expect(result.name).toBe('Luna');
    expect(fixture.getStoredPet()).toBe(currentPet);
    expect(fixture.getCorrectionCalls()).toBe(1);
  });

  it('maps inaccessible pets to PetNotFoundError', async () => {
    const fixture = setup(null);
    await expect(
      fixture.useCase.execute({
        petId: '550e8400-e29b-41d4-a716-446655440001',
        authenticatedAccountId: OWNER_ID,
        name: 'Nala',
      }),
    ).rejects.toThrow(PetNotFoundError);
  });

  it.each([
    { name: '   ' },
    { color: ' ' },
    { distinctiveMarks: ' ' },
    { microchip: ' ' },
    { breed: { name: ' ', kind: 'KNOWN' as const } },
    { birthInformation: { date: '2021-02-30', accuracy: 'EXACT' as const } },
  ])(
    'maps domain rejection for %# to InvalidPetProfileError',
    async (patch) => {
      const currentPet: Pet = pet();
      const fixture = setup(currentPet);
      await expect(
        fixture.useCase.execute({ ...command(currentPet), ...patch }),
      ).rejects.toThrow(InvalidPetProfileError);
      expect(fixture.getStoredPet()).toBe(currentPet);
    },
  );

  it('propagates unexpected repository failures', async () => {
    const failure = new Error('Database unavailable');
    const repository: PetRepository = {
      restoreIfOwned: jest.fn(),
      archiveIfOwned: jest.fn() as PetRepository['archiveIfOwned'],
      promoteCollaboratorIfOwned:
        jest.fn() as PetRepository['promoteCollaboratorIfOwned'],
      removeMemberIfOwned: jest.fn() as PetRepository['removeMemberIfOwned'],
      save: jest.fn() as PetRepository['save'],
      correctProfileIfOwned: jest
        .fn()
        .mockRejectedValue(failure) as PetRepository['correctProfileIfOwned'],
      leave: jest.fn() as PetRepository['leave'],
    };
    await expect(
      new UpdatePetProfile(repository).execute(command(pet())),
    ).rejects.toBe(failure);
  });
});
