import type {
  AccessiblePetSummary,
  PetDetail,
  PetQueryRepository,
} from '../persistence/pet-query.repository';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import { GetPetDetail } from './get-pet-detail';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';

class InMemoryPetQueryRepository implements PetQueryRepository {
  readonly requestedDetails: { petId: string; accountId: string }[] = [];
  readonly requestedAccountIds: string[] = [];
  error: Error | null = null;

  constructor(private readonly detail: PetDetail | null) {}

  findAccessibleByAccountId(
    accountId: string,
  ): Promise<AccessiblePetSummary[]> {
    this.requestedAccountIds.push(accountId);
    return Promise.resolve([]);
  }

  findAccessibleDetailById(
    petId: string,
    accountId: string,
  ): Promise<PetDetail | null> {
    this.requestedDetails.push({ petId, accountId });

    if (this.error !== null) {
      return Promise.reject(this.error);
    }

    return Promise.resolve(this.detail);
  }

  hasActiveOwnerAccess(petId: string, accountId: string): Promise<boolean> {
    this.requestedDetails.push({ petId, accountId });
    return Promise.resolve(false);
  }

  hasActiveMembership(petId: string, accountId: string): Promise<boolean> {
    this.requestedDetails.push({ petId, accountId });
    return Promise.resolve(false);
  }
}

describe('GetPetDetail', () => {
  it('returns the accessible detail requested for the pet and account', async () => {
    const detail: PetDetail = {
      id: PET_ID,
      name: 'Luna',
      species: 'DOG',
      breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
      sex: 'FEMALE',
      birthInformation: { date: '2021-06-14', accuracy: 'EXACT' },
      color: null,
      distinctiveMarks: null,
      microchip: null,
      status: 'ACTIVE',
      role: 'OWNER',
    };
    const repository = new InMemoryPetQueryRepository(detail);
    const getPetDetail = new GetPetDetail(repository);

    await expect(getPetDetail.execute(PET_ID, ACCOUNT_ID)).resolves.toBe(
      detail,
    );
    expect(repository.requestedDetails).toEqual([
      { petId: PET_ID, accountId: ACCOUNT_ID },
    ]);
  });

  it('rejects when no accessible detail exists', async () => {
    const repository = new InMemoryPetQueryRepository(null);
    const getPetDetail = new GetPetDetail(repository);

    await expect(getPetDetail.execute(PET_ID, ACCOUNT_ID)).rejects.toThrow(
      PetNotFoundError,
    );
    expect(repository.requestedDetails).toEqual([
      { petId: PET_ID, accountId: ACCOUNT_ID },
    ]);
  });

  it('propagates unexpected repository errors', async () => {
    const repository = new InMemoryPetQueryRepository(null);
    const persistenceError = new Error('Database unavailable');
    repository.error = persistenceError;
    const getPetDetail = new GetPetDetail(repository);

    await expect(getPetDetail.execute(PET_ID, ACCOUNT_ID)).rejects.toBe(
      persistenceError,
    );
  });
});
