import type { PetMedicationRepository } from '../persistence/pet-medication.repository';
import type { Clock } from '../time/clock';
import type { RecordedPetMedication } from '../record-pet-medication/record-pet-medication';
import {
    mapMedicationLifecycleError,
    projectMedicationOutcome,
    type CompletePetMedicationCommand,
} from '../complete-pet-medication/complete-pet-medication';

export interface DiscontinuePetMedicationCommand extends CompletePetMedicationCommand {
    discontinuationReason?: string | null;
}

export class DiscontinuePetMedication {
    constructor(
        private readonly repository: PetMedicationRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: DiscontinuePetMedicationCommand): Promise<RecordedPetMedication> {
        try {
            return projectMedicationOutcome(
                await this.repository.discontinueIfPetWritable({
                    ...command,
                    getToday: (): string => this.clock.now().toISOString().slice(0, 10),
                }),
            );
        } catch (error: unknown) {
            throw mapMedicationLifecycleError(error);
        }
    }
}
