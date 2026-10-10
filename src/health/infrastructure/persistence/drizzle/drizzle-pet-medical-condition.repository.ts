import { ResolvedDate } from '../../../domain/resolved-date/resolved-date';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    PetMedicalConditionReopening,
    ReopenPetMedicalConditionOutcome,
    PetMedicalConditionResolution,
    ResolvePetMedicalConditionOutcome,
    CreatePetMedicalConditionOutcome,
    PetMedicalConditionCorrection,
    UpdatePetMedicalConditionOutcome,
    PetMedicalConditionRepository,
} from '../../../application/persistence/pet-medical-condition.repository';
import {
    PetMedicalCondition,
    PetMedicalConditionId,
    PetId,
    RecordedByAccountId,
} from '../../../domain/pet-medical-condition/pet-medical-condition';
import { MedicalConditionName } from '../../../domain/medical-condition-name/medical-condition-name';
import { DiagnosedDate } from '../../../domain/diagnosed-date/diagnosed-date';
import { healthPetMedicalConditions } from './health.schema';

@Injectable()
export class DrizzlePetMedicalConditionRepository implements PetMedicalConditionRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async reopenIfPetWritable(
        reopening: PetMedicalConditionReopening,
    ): Promise<ReopenPetMedicalConditionOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<ReopenPetMedicalConditionOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, reopening.petId))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return { status: 'PET_NOT_FOUND' };
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, reopening.petId),
                            eq(petMemberships.accountId, reopening.authenticatedAccountId),
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

                const conditionRows = await transaction
                    .select()
                    .from(healthPetMedicalConditions)
                    .where(
                        and(
                            eq(healthPetMedicalConditions.id, reopening.conditionId),
                            eq(healthPetMedicalConditions.petId, reopening.petId),
                        ),
                    )
                    .for('update');
                const row = conditionRows[0];

                if (row === undefined) {
                    return { status: 'PET_MEDICAL_CONDITION_NOT_FOUND' };
                }

                const condition: PetMedicalCondition = PetMedicalCondition.reconstitute({
                    id: PetMedicalConditionId.from(row.id),
                    petId: PetId.from(row.petId),
                    name: MedicalConditionName.from(row.name),
                    diagnosedDate:
                        row.diagnosedDate === null
                            ? null
                            : DiagnosedDate.reconstitute(row.diagnosedDate),
                    resolvedDate:
                        row.resolvedDate === null
                            ? null
                            : ResolvedDate.reconstitute(row.resolvedDate),
                    notes: row.notes,
                    status: row.status,
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                });
                const reopened: PetMedicalCondition = condition.reopen();

                if (reopened === condition) {
                    return { status: 'UNCHANGED', condition };
                }

                await transaction
                    .update(healthPetMedicalConditions)
                    .set({
                        status: reopened.status,
                        resolvedDate: reopened.resolvedDate?.value ?? null,
                    })
                    .where(
                        and(
                            eq(healthPetMedicalConditions.id, reopening.conditionId),
                            eq(healthPetMedicalConditions.petId, reopening.petId),
                        ),
                    );

                return { status: 'REOPENED', condition: reopened };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async resolveIfPetWritable(
        resolution: PetMedicalConditionResolution,
    ): Promise<ResolvePetMedicalConditionOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<ResolvePetMedicalConditionOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, resolution.petId))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return { status: 'PET_NOT_FOUND' };
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, resolution.petId),
                            eq(petMemberships.accountId, resolution.authenticatedAccountId),
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

                const conditionRows = await transaction
                    .select()
                    .from(healthPetMedicalConditions)
                    .where(
                        and(
                            eq(healthPetMedicalConditions.id, resolution.conditionId),
                            eq(healthPetMedicalConditions.petId, resolution.petId),
                        ),
                    )
                    .for('update');
                const row = conditionRows[0];

                if (row === undefined) {
                    return { status: 'PET_MEDICAL_CONDITION_NOT_FOUND' };
                }

                const today: string = resolution.getToday();
                const condition: PetMedicalCondition = PetMedicalCondition.reconstitute({
                    id: PetMedicalConditionId.from(row.id),
                    petId: PetId.from(row.petId),
                    name: MedicalConditionName.from(row.name),
                    diagnosedDate:
                        row.diagnosedDate === null
                            ? null
                            : DiagnosedDate.reconstitute(row.diagnosedDate),
                    resolvedDate:
                        row.resolvedDate === null
                            ? null
                            : ResolvedDate.reconstitute(row.resolvedDate),
                    notes: row.notes,
                    status: row.status,
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                });
                const resolved: PetMedicalCondition = condition.resolve(resolution, today);

                if (resolved === condition) {
                    return { status: 'UNCHANGED', condition };
                }

                await transaction
                    .update(healthPetMedicalConditions)
                    .set({
                        status: resolved.status,
                        resolvedDate: resolved.resolvedDate?.value ?? null,
                    })
                    .where(
                        and(
                            eq(healthPetMedicalConditions.id, resolution.conditionId),
                            eq(healthPetMedicalConditions.petId, resolution.petId),
                        ),
                    );

                return { status: 'RESOLVED', condition: resolved };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async correctIfPetWritable(
        correction: PetMedicalConditionCorrection,
    ): Promise<UpdatePetMedicalConditionOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<UpdatePetMedicalConditionOutcome> => {
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

                const conditionRows = await transaction
                    .select()
                    .from(healthPetMedicalConditions)
                    .where(
                        and(
                            eq(healthPetMedicalConditions.id, correction.conditionId),
                            eq(healthPetMedicalConditions.petId, correction.petId),
                        ),
                    )
                    .for('update');
                const row = conditionRows[0];

                if (row === undefined) {
                    return { status: 'PET_MEDICAL_CONDITION_NOT_FOUND' };
                }

                const today: string = correction.getToday();
                const condition: PetMedicalCondition = PetMedicalCondition.reconstitute({
                    id: PetMedicalConditionId.from(row.id),
                    petId: PetId.from(row.petId),
                    name: MedicalConditionName.from(row.name),
                    diagnosedDate:
                        row.diagnosedDate === null
                            ? null
                            : DiagnosedDate.reconstitute(row.diagnosedDate),
                    resolvedDate:
                        row.resolvedDate === null
                            ? null
                            : ResolvedDate.reconstitute(row.resolvedDate),
                    notes: row.notes,
                    status: row.status,
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                });
                const corrected: PetMedicalCondition = condition.correct(correction, today);

                if (corrected === condition) {
                    return { status: 'UNCHANGED', condition };
                }

                await transaction
                    .update(healthPetMedicalConditions)
                    .set({
                        name: corrected.name.value,
                        diagnosedDate: corrected.diagnosedDate?.value ?? null,
                        notes: corrected.notes,
                    })
                    .where(
                        and(
                            eq(healthPetMedicalConditions.id, correction.conditionId),
                            eq(healthPetMedicalConditions.petId, correction.petId),
                        ),
                    );

                return { status: 'UPDATED', condition: corrected };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async createIfPetWritable(
        condition: PetMedicalCondition,
        authenticatedAccountId: string,
    ): Promise<CreatePetMedicalConditionOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<CreatePetMedicalConditionOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, condition.petId.value))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return 'PET_NOT_FOUND';
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, condition.petId.value),
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

                await transaction.insert(healthPetMedicalConditions).values({
                    id: condition.id.value,
                    petId: condition.petId.value,
                    name: condition.name.value,
                    status: condition.status,
                    resolvedDate: condition.resolvedDate?.value ?? null,
                    diagnosedDate: condition.diagnosedDate?.value ?? null,
                    notes: condition.notes,
                    recordedByAccountId: condition.recordedByAccountId.value,
                });

                return 'CREATED';
            },
            { isolationLevel: 'read committed' },
        );
    }
}
