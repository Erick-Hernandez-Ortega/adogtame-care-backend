import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CreateVaccinationRecordOutcome,
    DeleteVaccinationRecordOutcome,
    UpdateVaccinationRecordOutcome,
    VaccinationRecordAccess,
    VaccinationRecordCorrection,
    VaccinationRecordRepository,
} from '../../../application/persistence/vaccination-record.repository';
import { AppliedDate } from '../../../domain/applied-date/applied-date';
import { NextDueDate } from '../../../domain/next-due-date/next-due-date';
import {
    PetId,
    RecordedByAccountId,
    VaccinationRecord,
    VaccinationRecordId,
} from '../../../domain/vaccination-record/vaccination-record';
import { VaccineName } from '../../../domain/vaccine-name/vaccine-name';
import { healthVaccinationRecords } from './health.schema';

@Injectable()
export class DrizzleVaccinationRecordRepository implements VaccinationRecordRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async createIfPetWritable(
        record: VaccinationRecord,
        authenticatedAccountId: string,
    ): Promise<CreateVaccinationRecordOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<CreateVaccinationRecordOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, record.petId.value))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return 'PET_NOT_FOUND';
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, record.petId.value),
                            eq(petMemberships.accountId, authenticatedAccountId),
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

                await transaction.insert(healthVaccinationRecords).values({
                    id: record.id.value,
                    petId: record.petId.value,
                    vaccineName: record.vaccineName.value,
                    appliedDate: record.appliedDate.value,
                    nextDueDate: record.nextDueDate?.value ?? null,
                    recordedByAccountId: record.recordedByAccountId.value,
                });

                return 'CREATED';
            },
            { isolationLevel: 'read committed' },
        );
    }

    async correctIfPetWritable(
        correction: VaccinationRecordCorrection,
    ): Promise<UpdateVaccinationRecordOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<UpdateVaccinationRecordOutcome> => {
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

                const recordRows = await transaction
                    .select()
                    .from(healthVaccinationRecords)
                    .where(
                        and(
                            eq(healthVaccinationRecords.id, correction.vaccinationRecordId),
                            eq(healthVaccinationRecords.petId, correction.petId),
                        ),
                    )
                    .for('update');
                const row = recordRows[0];

                if (row === undefined) {
                    return { status: 'VACCINATION_RECORD_NOT_FOUND' };
                }

                const record = VaccinationRecord.reconstitute({
                    id: VaccinationRecordId.from(row.id),
                    petId: PetId.from(row.petId),
                    vaccineName: VaccineName.from(row.vaccineName),
                    appliedDate: AppliedDate.from(row.appliedDate, row.appliedDate),
                    nextDueDate:
                        row.nextDueDate === null ? null : NextDueDate.from(row.nextDueDate),
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                });
                const corrected = record.correct({
                    vaccineName: correction.vaccineName,
                    appliedDate: correction.appliedDate,
                    nextDueDate: correction.nextDueDate,
                });

                if (corrected === record) {
                    return { status: 'UNCHANGED', record };
                }

                await transaction
                    .update(healthVaccinationRecords)
                    .set({
                        vaccineName: corrected.vaccineName.value,
                        appliedDate: corrected.appliedDate.value,
                        nextDueDate: corrected.nextDueDate?.value ?? null,
                    })
                    .where(
                        and(
                            eq(healthVaccinationRecords.id, correction.vaccinationRecordId),
                            eq(healthVaccinationRecords.petId, correction.petId),
                        ),
                    );

                return { status: 'UPDATED', record: corrected };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async deleteIfPetWritable(
        access: VaccinationRecordAccess,
    ): Promise<DeleteVaccinationRecordOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<DeleteVaccinationRecordOutcome> => {
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

                const recordRows = await transaction
                    .select({ id: healthVaccinationRecords.id })
                    .from(healthVaccinationRecords)
                    .where(
                        and(
                            eq(healthVaccinationRecords.id, access.vaccinationRecordId),
                            eq(healthVaccinationRecords.petId, access.petId),
                        ),
                    )
                    .for('update');

                if (recordRows.length === 0) {
                    return 'VACCINATION_RECORD_NOT_FOUND';
                }

                const deletedRows = await transaction
                    .delete(healthVaccinationRecords)
                    .where(
                        and(
                            eq(healthVaccinationRecords.id, access.vaccinationRecordId),
                            eq(healthVaccinationRecords.petId, access.petId),
                        ),
                    )
                    .returning({ id: healthVaccinationRecords.id });

                return deletedRows.length === 0 ? 'VACCINATION_RECORD_NOT_FOUND' : 'DELETED';
            },
            { isolationLevel: 'read committed' },
        );
    }
}
