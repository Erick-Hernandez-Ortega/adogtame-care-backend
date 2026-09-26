import type {
  AccessiblePetSummary,
  PetQueryRepository,
} from '../persistence/pet-query.repository';
import { ListMyPets } from './list-my-pets';

const ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';

class InMemoryPetQueryRepository implements PetQueryRepository {
  readonly requestedAccountIds: string[] = [];

  constructor(private readonly summaries: AccessiblePetSummary[]) {}

  findAccessibleByAccountId(
    accountId: string,
  ): Promise<AccessiblePetSummary[]> {
    this.requestedAccountIds.push(accountId);

    return Promise.resolve(this.summaries);
  }
}

describe('ListMyPets', () => {
  it('returns the repository summaries for the provided account', async () => {
    const summaries: AccessiblePetSummary[] = [
      {
        id: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
        name: 'Luna',
        species: 'DOG',
        breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
        sex: 'FEMALE',
        role: 'OWNER',
      },
      {
        id: 'fd997d55-31ac-45f2-b7fa-17113f6ef5e5',
        name: 'Rocky',
        species: 'CAT',
        breed: { name: 'Mixed', kind: 'CUSTOM' },
        sex: 'MALE',
        role: 'COLLABORATOR',
      },
    ];
    const repository = new InMemoryPetQueryRepository(summaries);
    const listMyPets = new ListMyPets(repository);

    await expect(listMyPets.execute(ACCOUNT_ID)).resolves.toBe(summaries);
    expect(repository.requestedAccountIds).toEqual([ACCOUNT_ID]);
  });

  it('returns an empty list when the account has no accessible pets', async () => {
    const repository = new InMemoryPetQueryRepository([]);
    const listMyPets = new ListMyPets(repository);

    await expect(listMyPets.execute(ACCOUNT_ID)).resolves.toEqual([]);
    expect(repository.requestedAccountIds).toEqual([ACCOUNT_ID]);
  });

  it('propagates repository errors', async () => {
    const persistenceError = new Error('Database unavailable');
    const repository: PetQueryRepository = {
      findAccessibleByAccountId: jest
        .fn<Promise<AccessiblePetSummary[]>, [string]>()
        .mockRejectedValue(persistenceError),
    };
    const listMyPets = new ListMyPets(repository);

    await expect(listMyPets.execute(ACCOUNT_ID)).rejects.toBe(persistenceError);
  });
});
