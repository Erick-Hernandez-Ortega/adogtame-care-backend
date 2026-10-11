import type {
    PetMedicationRepository,
    PetMedicationAccess,
} from '../persistence/pet-medication.repository';
import type { RecordedPetMedication } from '../record-pet-medication/record-pet-medication';
import { projectMedicationOutcome } from '../complete-pet-medication/complete-pet-medication';

export class ReopenPetMedication {
    constructor(private readonly repository: PetMedicationRepository) {}

    async execute(command: PetMedicationAccess): Promise<RecordedPetMedication> {
        return projectMedicationOutcome(await this.repository.reopenIfPetWritable({ ...command }));
    }
}
