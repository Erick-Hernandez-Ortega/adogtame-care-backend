import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    PetVeterinaryVisitAccess,
    DeletePetVeterinaryVisitOutcome,
    PetVeterinaryVisitCorrection,
    UpdatePetVeterinaryVisitOutcome,
    CreatePetVeterinaryVisitOutcome,
    PetVeterinaryVisitRepository,
} from '../../../application/persistence/pet-veterinary-visit.repository';
import {
    PetVeterinaryVisit,
    PetVeterinaryVisitId,
    PetId,
    RecordedByAccountId,
} from '../../../domain/pet-veterinary-visit/pet-veterinary-visit';
import { VisitDate } from '../../../domain/visit-date/visit-date';
import { VeterinaryVisitReason } from '../../../domain/veterinary-visit-reason/veterinary-visit-reason';
import { healthPetVeterinaryVisits } from './health.schema';

@Injectable()
export class DrizzlePetVeterinaryVisitRepository implements PetVeterinaryVisitRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async correctIfPetWritable(
        correction: PetVeterinaryVisitCorrection,
    ): Promise<UpdatePetVeterinaryVisitOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<UpdatePetVeterinaryVisitOutcome> => {
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

                const visitRows = await transaction
                    .select()
                    .from(healthPetVeterinaryVisits)
                    .where(
                        and(
                            eq(healthPetVeterinaryVisits.id, correction.visitId),
                            eq(healthPetVeterinaryVisits.petId, correction.petId),
                        ),
                    )
                    .for('update');
                const row = visitRows[0];

                if (row === undefined) {
                    return { status: 'PET_VETERINARY_VISIT_NOT_FOUND' };
                }

                const today: string = correction.getToday();
                const visit: PetVeterinaryVisit = PetVeterinaryVisit.reconstitute({
                    id: PetVeterinaryVisitId.from(row.id),
                    petId: PetId.from(row.petId),
                    reason: VeterinaryVisitReason.from(row.reason),
                    visitDate: VisitDate.reconstitute(row.visitDate),
                    diagnosis: row.diagnosis,
                    observations: row.observations,
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                });
                const corrected: PetVeterinaryVisit = visit.correct(correction, today);

                if (corrected === visit) {
                    return { status: 'UNCHANGED', visit };
                }

                await transaction
                    .update(healthPetVeterinaryVisits)
                    .set({
                        reason: corrected.reason.value,
                        visitDate: corrected.visitDate.value,
                        diagnosis: corrected.diagnosis,
                        observations: corrected.observations,
                    })
                    .where(
                        and(
                            eq(healthPetVeterinaryVisits.id, correction.visitId),
                            eq(healthPetVeterinaryVisits.petId, correction.petId),
                        ),
                    );

                return { status: 'UPDATED', visit: corrected };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async createIfPetWritable(
        visit: PetVeterinaryVisit,
        authenticatedAccountId: string,
    ): Promise<CreatePetVeterinaryVisitOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<CreatePetVeterinaryVisitOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, visit.petId.value))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return 'PET_NOT_FOUND';
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, visit.petId.value),
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

                await transaction.insert(healthPetVeterinaryVisits).values({
                    id: visit.id.value,
                    petId: visit.petId.value,
                    reason: visit.reason.value,
                    visitDate: visit.visitDate.value,
                    diagnosis: visit.diagnosis,
                    observations: visit.observations,
                    recordedByAccountId: visit.recordedByAccountId.value,
                });

                return 'CREATED';
            },
            { isolationLevel: 'read committed' },
        );
    }

    async deleteIfPetWritable(
        access: PetVeterinaryVisitAccess,
    ): Promise<DeletePetVeterinaryVisitOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<DeletePetVeterinaryVisitOutcome> => {
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

                const visitRows = await transaction
                    .select({ id: healthPetVeterinaryVisits.id })
                    .from(healthPetVeterinaryVisits)
                    .where(
                        and(
                            eq(healthPetVeterinaryVisits.id, access.visitId),
                            eq(healthPetVeterinaryVisits.petId, access.petId),
                        ),
                    )
                    .for('update');

                if (visitRows.length === 0) {
                    return 'PET_VETERINARY_VISIT_NOT_FOUND';
                }

                const deletedRows = await transaction
                    .delete(healthPetVeterinaryVisits)
                    .where(
                        and(
                            eq(healthPetVeterinaryVisits.id, access.visitId),
                            eq(healthPetVeterinaryVisits.petId, access.petId),
                        ),
                    )
                    .returning({ id: healthPetVeterinaryVisits.id });

                return deletedRows.length === 0 ? 'PET_VETERINARY_VISIT_NOT_FOUND' : 'DELETED';
            },
            { isolationLevel: 'read committed' },
        );
    }
}
