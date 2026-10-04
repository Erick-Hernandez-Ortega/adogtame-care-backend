import type {
  PetAllergyAccess,
  PetAllergyRepository,
  DeletePetAllergyOutcome,
} from '../persistence/pet-allergy.repository';
import { PetNotFoundError } from '../record-pet-allergy/record-pet-allergy';
import { PetAllergyNotFoundError } from '../update-pet-allergy/update-pet-allergy';

export class DeletePetAllergy {
  constructor(private readonly repository: PetAllergyRepository) {}

  async execute(command: PetAllergyAccess): Promise<void> {
    const outcome: DeletePetAllergyOutcome =
      await this.repository.deleteIfPetWritable(command);
    if (outcome === 'PET_NOT_FOUND') throw new PetNotFoundError();
    if (outcome === 'PET_ALLERGY_NOT_FOUND')
      throw new PetAllergyNotFoundError();
  }
}
