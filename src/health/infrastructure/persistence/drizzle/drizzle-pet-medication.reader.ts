import { MedicationStatus } from '../../../domain/pet-medication/pet-medication';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    ListedPetMedication,
    PetMedicationReader,
    PetMedicationReadRequest,
} from '../../../application/persistence/pet-medication.reader';
import { healthPetMedications } from './health.schema';

@Injectable()
export class DrizzlePetMedicationReader implements PetMedicationReader {
    constructor(private readonly databaseService: DatabaseService) {}

    async listIfPetReadable(
        request: PetMedicationReadRequest,
    ): Promise<ListedPetMedication[] | null> {
        const rows = await this.databaseService.connection
            .select({
                medication: {
                    id: healthPetMedications.id,
                    name: healthPetMedications.name,
                    dosage: healthPetMedications.dosage,
                    frequency: healthPetMedications.frequency,
                    startDate: healthPetMedications.startDate,
                    plannedEndDate: healthPetMedications.plannedEndDate,
                    notes: healthPetMedications.notes,
                    status: healthPetMedications.status,
                    endedDate: healthPetMedications.endedDate,
                    discontinuationReason: healthPetMedications.discontinuationReason,
                    recordedByAccountId: healthPetMedications.recordedByAccountId,
                },
            })
            .from(pets)
            .innerJoin(
                petMemberships,
                and(
                    eq(petMemberships.petId, pets.id),
                    eq(petMemberships.accountId, request.authenticatedAccountId),
                    eq(petMemberships.status, 'ACTIVE'),
                    inArray(petMemberships.role, ['OWNER', 'COLLABORATOR']),
                ),
            )
            .leftJoin(healthPetMedications, eq(healthPetMedications.petId, pets.id))
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(desc(healthPetMedications.createdAt), desc(healthPetMedications.id));

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): ListedPetMedication[] => {
            if (row.medication === null) {
                return [];
            }

            const status: string = row.medication.status;

            if (
                status !== MedicationStatus.OPEN &&
                status !== MedicationStatus.COMPLETED &&
                status !== MedicationStatus.DISCONTINUED
            ) {
                throw new TypeError('Persisted medication status is invalid');
            }

            return [
                {
                    id: row.medication.id,
                    name: row.medication.name,
                    dosage: row.medication.dosage,
                    frequency: row.medication.frequency,
                    startDate: row.medication.startDate,
                    plannedEndDate: row.medication.plannedEndDate,
                    notes: row.medication.notes,
                    status,
                    endedDate: row.medication.endedDate,
                    discontinuationReason: row.medication.discontinuationReason,
                    recordedByAccountId: row.medication.recordedByAccountId,
                },
            ];
        });
    }
}
