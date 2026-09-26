import type {
  PetDetail,
  PetQueryRepository,
} from '../persistence/pet-query.repository';
import { PetNotFoundError } from '../errors/pet-not-found.error';

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
