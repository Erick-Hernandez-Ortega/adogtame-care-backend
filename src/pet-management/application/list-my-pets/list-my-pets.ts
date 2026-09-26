import type {
  AccessiblePetSummary,
  PetQueryRepository,
} from '../persistence/pet-query.repository';

export class ListMyPets {
  constructor(private readonly petQueryRepository: PetQueryRepository) {}

  execute(accountId: string): Promise<AccessiblePetSummary[]> {
    return this.petQueryRepository.findAccessibleByAccountId(accountId);
  }
}
