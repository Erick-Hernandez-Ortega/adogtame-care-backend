import type {
    WeightRecordAccess,
    WeightRecordRepository,
} from '../persistence/weight-record.repository';
import { PetNotFoundError } from '../record-pet-weight/record-pet-weight';
import { WeightRecordNotFoundError } from '../update-pet-weight-record/update-pet-weight-record';

export class DeletePetWeightRecord {
    constructor(private readonly repository: WeightRecordRepository) {}

    async execute(command: WeightRecordAccess): Promise<void> {
        const outcome = await this.repository.deleteIfPetWritable(command);

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome === 'WEIGHT_RECORD_NOT_FOUND') {
            throw new WeightRecordNotFoundError();
        }
    }
}
