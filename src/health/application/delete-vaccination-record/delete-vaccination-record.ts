import type {
    VaccinationRecordAccess,
    VaccinationRecordRepository,
} from '../persistence/vaccination-record.repository';
import { PetNotFoundError } from '../record-vaccination/record-vaccination';
import { VaccinationRecordNotFoundError } from '../update-vaccination-record/update-vaccination-record';

export class DeleteVaccinationRecord {
    constructor(private readonly repository: VaccinationRecordRepository) {}

    async execute(command: VaccinationRecordAccess): Promise<void> {
        const outcome = await this.repository.deleteIfPetWritable(command);

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome === 'VACCINATION_RECORD_NOT_FOUND') {
            throw new VaccinationRecordNotFoundError();
        }
    }
}
