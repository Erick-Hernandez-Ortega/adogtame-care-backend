import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    PetMedicationRepository,
    PetMedicationRecording,
    CreatePetMedicationOutcome,
} from '../../../application/persistence/pet-medication.repository';
import {
    PetMedication,
    PetId,
    RecordedByAccountId,
} from '../../../domain/pet-medication/pet-medication';
import { healthPetMedications } from './health.schema';

@Injectable()
export class DrizzlePetMedicationRepository implements PetMedicationRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async createIfPetWritable(
        recording: PetMedicationRecording,
    ): Promise<CreatePetMedicationOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<CreatePetMedicationOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, recording.petId))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return { status: 'PET_NOT_FOUND' };
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, recording.petId),
                            eq(petMemberships.accountId, recording.authenticatedAccountId),
                        ),
                    )
                    .for('update');
                const membership = membershipRows[0];

                if (
                    membership?.status !== 'ACTIVE' ||
                    (membership.role !== 'OWNER' && membership.role !== 'COLLABORATOR')
                ) {
                    return { status: 'PET_NOT_FOUND' };
                }

                const medication: PetMedication = PetMedication.create({
                    ...recording,
                    petId: PetId.from(recording.petId),
                    recordedByAccountId: RecordedByAccountId.from(recording.authenticatedAccountId),
                });

                await transaction.insert(healthPetMedications).values({
                    id: medication.id.value,
                    petId: medication.petId.value,
                    name: medication.name.value,
                    dosage: medication.dosage,
                    frequency: medication.frequency,
                    startDate: medication.startDate?.value ?? null,
                    plannedEndDate: medication.plannedEndDate?.value ?? null,
                    notes: medication.notes,
                    recordedByAccountId: medication.recordedByAccountId.value,
                });

                return { status: 'CREATED', medication };
            },
            { isolationLevel: 'read committed' },
        );
    }
}
