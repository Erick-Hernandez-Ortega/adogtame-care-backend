import { afterPage, paginationKey } from '../../../../infrastructure/database/pagination';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    PetVeterinaryVisitListItem,
    PetVeterinaryVisitReader,
    PetVeterinaryVisitReadRequest,
} from '../../../application/persistence/pet-veterinary-visit.reader';
import { healthPetVeterinaryVisits } from './health.schema';

@Injectable()
export class DrizzlePetVeterinaryVisitReader implements PetVeterinaryVisitReader {
    constructor(private readonly databaseService: DatabaseService) {}

    async findAccessibleByPet(
        request: PetVeterinaryVisitReadRequest,
    ): Promise<PetVeterinaryVisitListItem[] | null> {
        const key = paginationKey([
            sql`coalesce(${healthPetVeterinaryVisits.visitDate}::text, '0000-00-00')`,
            sql`to_char(${healthPetVeterinaryVisits.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            sql`${healthPetVeterinaryVisits.id}::text`,
        ]);
        const rows = await this.databaseService.connection
            .select({
                paginationKey: key,
                visit: {
                    id: healthPetVeterinaryVisits.id,
                    visitDate: healthPetVeterinaryVisits.visitDate,
                    reason: healthPetVeterinaryVisits.reason,
                    diagnosis: healthPetVeterinaryVisits.diagnosis,
                    observations: healthPetVeterinaryVisits.observations,
                    recordedByAccountId: healthPetVeterinaryVisits.recordedByAccountId,
                },
            })
            .from(pets)
            .innerJoin(
                petMemberships,
                and(
                    eq(petMemberships.petId, pets.id),
                    eq(petMemberships.accountId, request.accountId),
                    eq(petMemberships.status, 'ACTIVE'),
                    inArray(petMemberships.role, ['OWNER', 'COLLABORATOR']),
                ),
            )
            .leftJoin(
                healthPetVeterinaryVisits,
                and(eq(healthPetVeterinaryVisits.petId, pets.id), afterPage(key, request.page)),
            )
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(
                desc(healthPetVeterinaryVisits.visitDate),
                desc(healthPetVeterinaryVisits.createdAt),
                desc(healthPetVeterinaryVisits.id),
            )
            .limit(request.page?.limit ?? 2147483647);

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): PetVeterinaryVisitListItem[] => {
            if (row.visit === null) {
                return [];
            }

            return [
                {
                    ...(request.page === undefined ? {} : { paginationKey: row.paginationKey }),
                    id: row.visit.id,
                    visitDate: row.visit.visitDate,
                    reason: row.visit.reason,
                    diagnosis: row.visit.diagnosis,
                    observations: row.visit.observations,
                    recordedByAccountId: row.visit.recordedByAccountId,
                },
            ];
        });
    }
}
