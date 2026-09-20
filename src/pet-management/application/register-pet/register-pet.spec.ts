import type { PetRepository } from '../persistence/pet.repository';
import type { Pet } from '../../domain/pet/pet';
import { InvalidPetRegistrationError, RegisterPet } from './register-pet';
import type { RegisteredPet, RegisterPetCommand } from './register-pet.types';

const OWNER_ID: string = '550e8400-e29b-41d4-a716-446655440000';

class InMemoryPetRepository implements PetRepository {
  readonly savedPets: Pet[] = [];

  save(pet: Pet): Promise<void> {
    this.savedPets.push(pet);

    return Promise.resolve();
  }
}

function validCommand(
  overrides: Partial<RegisterPetCommand> = {},
): RegisterPetCommand {
  return {
    name: 'Luna',
    species: 'DOG',
    breed: {
      name: 'Labrador Retriever',
      kind: 'KNOWN',
    },
    sex: 'FEMALE',
    birthInformation: {
      date: '2021-06-14',
      accuracy: 'EXACT',
    },
    ownerId: OWNER_ID,
    ...overrides,
  };
}

describe('RegisterPet', () => {
  it.each([
    [
      { name: 'Labrador Retriever', kind: 'KNOWN' as const },
      { date: '2021-06-14', accuracy: 'EXACT' as const },
    ],
    [
      { name: 'Local mixed breed', kind: 'CUSTOM' as const },
      { date: '2020-01-01', accuracy: 'APPROXIMATE' as const },
    ],
  ])(
    'creates and persists a pet for breed %# and birth information %#',
    async (breed, birthInformation) => {
      const repository = new InMemoryPetRepository();
      const registerPet = new RegisterPet(repository);

      const result: RegisteredPet = await registerPet.execute(
        validCommand({ breed, birthInformation }),
      );

      expect(repository.savedPets).toHaveLength(1);
      expect(repository.savedPets[0].id.value).toBe(result.id);
      expect(result).toEqual({
        id: expect.any(String) as string,
        name: 'Luna',
        species: 'DOG',
        breed,
        sex: 'FEMALE',
        birthInformation,
        color: null,
        distinctiveMarks: null,
        microchip: null,
        status: 'ACTIVE',
        memberships: [
          {
            id: expect.any(String) as string,
            userId: OWNER_ID,
            role: 'OWNER',
          },
        ],
      });
    },
  );

  it('returns normalized optional profile values', async () => {
    const registerPet = new RegisterPet(new InMemoryPetRepository());

    const result: RegisteredPet = await registerPet.execute(
      validCommand({
        name: ' Luna ',
        color: ' Golden ',
        distinctiveMarks: ' White spot ',
        microchip: ' 981020000123456 ',
      }),
    );

    expect(result).toMatchObject({
      name: 'Luna',
      color: 'Golden',
      distinctiveMarks: 'White spot',
      microchip: '981020000123456',
    });
  });

  it('does not persist when the domain rejects registration', async () => {
    const repository = new InMemoryPetRepository();
    const registerPet = new RegisterPet(repository);

    await expect(
      registerPet.execute(validCommand({ name: '   ' })),
    ).rejects.toThrow(InvalidPetRegistrationError);
    expect(repository.savedPets).toHaveLength(0);
  });

  it('propagates repository errors unchanged', async () => {
    const persistenceError = new Error('Database unavailable');
    const repository: PetRepository = {
      save: jest.fn<Promise<void>, [Pet]>().mockRejectedValue(persistenceError),
    };
    const registerPet = new RegisterPet(repository);

    await expect(registerPet.execute(validCommand())).rejects.toBe(
      persistenceError,
    );
  });
});
