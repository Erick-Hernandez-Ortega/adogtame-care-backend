import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CreatePetVeterinaryVisitOutcome,
    PetVeterinaryVisitRepository,
} from '../../../application/persistence/pet-veterinary-visit.repository';
import type { PetVeterinaryVisit } from '../../../domain/pet-veterinary-visit/pet-veterinary-visit';
import { healthPetVeterinaryVisits } from './health.schema';

@Injectable()
export class DrizzlePetVeterinaryVisitRepository implements PetVeterinaryVisitRepository {
    constructor(private readonly databaseService: DatabaseService) {}

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
}
