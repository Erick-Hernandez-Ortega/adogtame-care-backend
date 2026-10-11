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
    PetMedicationCorrection,
    UpdatePetMedicationOutcome,
    PetMedicationAccess,
    DeletePetMedicationOutcome,
    PetMedicationClosure,
} from '../../../application/persistence/pet-medication.repository';
import {
    PetMedication,
    PetMedicationId,
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

    async correctIfPetWritable(
        correction: PetMedicationCorrection,
    ): Promise<UpdatePetMedicationOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<UpdatePetMedicationOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, correction.petId))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return { status: 'PET_NOT_FOUND' };
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, correction.petId),
                            eq(petMemberships.accountId, correction.authenticatedAccountId),
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

                const medicationRows = await transaction
                    .select()
                    .from(healthPetMedications)
                    .where(
                        and(
                            eq(healthPetMedications.petId, correction.petId),
                            eq(healthPetMedications.id, correction.medicationId),
                        ),
                    )
                    .for('update');
                const row = medicationRows[0];

                if (row === undefined) {
                    return { status: 'PET_MEDICATION_NOT_FOUND' };
                }

                const medication: PetMedication = PetMedication.reconstitute({
                    id: PetMedicationId.from(row.id),
                    petId: PetId.from(row.petId),
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                    name: row.name,
                    dosage: row.dosage,
                    frequency: row.frequency,
                    startDate: row.startDate,
                    plannedEndDate: row.plannedEndDate,
                    notes: row.notes,
                    status: row.status,
                    endedDate: row.endedDate,
                    discontinuationReason: row.discontinuationReason,
                });
                const corrected: PetMedication = medication.correct(
                    correction,
                    correction.getToday,
                );

                if (corrected !== medication) {
                    await transaction
                        .update(healthPetMedications)
                        .set({
                            name: corrected.name.value,
                            dosage: corrected.dosage,
                            frequency: corrected.frequency,
                            startDate: corrected.startDate?.value ?? null,
                            plannedEndDate: corrected.plannedEndDate?.value ?? null,
                            notes: corrected.notes,
                            endedDate: corrected.endedDate?.value ?? null,
                            discontinuationReason: corrected.discontinuationReason,
                        })
                        .where(
                            and(
                                eq(healthPetMedications.petId, correction.petId),
                                eq(healthPetMedications.id, correction.medicationId),
                            ),
                        );
                }

                return { status: 'UPDATED', medication: corrected };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async completeIfPetWritable(
        closure: PetMedicationClosure,
    ): Promise<UpdatePetMedicationOutcome> {
        return this.transitionIfPetWritable(closure, (medication): PetMedication =>
            medication.complete(closure, closure.getToday),
        );
    }

    async discontinueIfPetWritable(
        closure: PetMedicationClosure,
    ): Promise<UpdatePetMedicationOutcome> {
        return this.transitionIfPetWritable(closure, (medication): PetMedication =>
            medication.discontinue(closure, closure.getToday),
        );
    }

    async reopenIfPetWritable(access: PetMedicationAccess): Promise<UpdatePetMedicationOutcome> {
        return this.transitionIfPetWritable(access, (medication): PetMedication =>
            medication.reopen(),
        );
    }

    private async transitionIfPetWritable(
        correction: PetMedicationAccess,
        transition: (medication: PetMedication) => PetMedication,
    ): Promise<UpdatePetMedicationOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<UpdatePetMedicationOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, correction.petId))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return { status: 'PET_NOT_FOUND' };
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, correction.petId),
                            eq(petMemberships.accountId, correction.authenticatedAccountId),
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

                const medicationRows = await transaction
                    .select()
                    .from(healthPetMedications)
                    .where(
                        and(
                            eq(healthPetMedications.petId, correction.petId),
                            eq(healthPetMedications.id, correction.medicationId),
                        ),
                    )
                    .for('update');
                const row = medicationRows[0];

                if (row === undefined) {
                    return { status: 'PET_MEDICATION_NOT_FOUND' };
                }

                const medication: PetMedication = PetMedication.reconstitute({
                    id: PetMedicationId.from(row.id),
                    petId: PetId.from(row.petId),
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                    name: row.name,
                    dosage: row.dosage,
                    frequency: row.frequency,
                    startDate: row.startDate,
                    plannedEndDate: row.plannedEndDate,
                    notes: row.notes,
                    status: row.status,
                    endedDate: row.endedDate,
                    discontinuationReason: row.discontinuationReason,
                });
                const corrected: PetMedication = transition(medication);

                if (corrected !== medication) {
                    await transaction
                        .update(healthPetMedications)
                        .set({
                            status: corrected.status,
                            endedDate: corrected.endedDate?.value ?? null,
                            discontinuationReason: corrected.discontinuationReason,
                        })
                        .where(
                            and(
                                eq(healthPetMedications.petId, correction.petId),
                                eq(healthPetMedications.id, correction.medicationId),
                            ),
                        );
                }

                return { status: 'UPDATED', medication: corrected };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async deleteIfPetWritable(access: PetMedicationAccess): Promise<DeletePetMedicationOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<DeletePetMedicationOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, access.petId))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return 'PET_NOT_FOUND';
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, access.petId),
                            eq(petMemberships.accountId, access.authenticatedAccountId),
                        ),
                    )
                    .for('update');
                const membership = membershipRows[0];

                if (
                    membership?.status !== 'ACTIVE' ||
                    (membership.role !== 'OWNER' && membership.role !== 'COLLABORATOR')
                ) {
                    return 'PET_NOT_FOUND';
                }

                const medicationRows = await transaction
                    .select({ id: healthPetMedications.id })
                    .from(healthPetMedications)
                    .where(
                        and(
                            eq(healthPetMedications.id, access.medicationId),
                            eq(healthPetMedications.petId, access.petId),
                        ),
                    )
                    .for('update');

                if (medicationRows.length === 0) {
                    return 'PET_MEDICATION_NOT_FOUND';
                }

                const deletedRows = await transaction
                    .delete(healthPetMedications)
                    .where(
                        and(
                            eq(healthPetMedications.id, access.medicationId),
                            eq(healthPetMedications.petId, access.petId),
                        ),
                    )
                    .returning({ id: healthPetMedications.id });

                return deletedRows.length === 0 ? 'PET_MEDICATION_NOT_FOUND' : 'DELETED';
            },
            { isolationLevel: 'read committed' },
        );
    }
}
