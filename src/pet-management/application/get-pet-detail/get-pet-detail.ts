import type {
  PetDetail,
  PetQueryRepository,
} from '../persistence/pet-query.repository';

export class PetNotFoundError extends Error {
  constructor() {
    super('Pet was not found');
    this.name = 'PetNotFoundError';
  }
}

export class GetPetDetail {
  constructor(private readonly petQueryRepository: PetQueryRepository) {}

  async execute(petId: string, accountId: string): Promise<PetDetail> {
    const detail: PetDetail | null =
      await this.petQueryRepository.findAccessibleDetailById(petId, accountId);

    if (detail === null) {
      throw new PetNotFoundError();
    }

    return detail;
  }
}
