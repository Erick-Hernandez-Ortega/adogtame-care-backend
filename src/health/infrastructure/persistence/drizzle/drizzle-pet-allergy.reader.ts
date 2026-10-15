import { afterPage, paginationKey } from '../../../../infrastructure/database/pagination';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    PetAllergyListItem,
    PetAllergyReader,
    PetAllergyReadRequest,
} from '../../../application/persistence/pet-allergy.reader';
import type { AllergyCategory, AllergySeverity } from '../../../domain/pet-allergy/pet-allergy';
import { healthPetAllergies } from './health.schema';

@Injectable()
export class DrizzlePetAllergyReader implements PetAllergyReader {
    constructor(private readonly databaseService: DatabaseService) {}

    async findAccessibleByPet(
        request: PetAllergyReadRequest,
    ): Promise<PetAllergyListItem[] | null> {
        const key = paginationKey([
            sql`to_char(${healthPetAllergies.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            sql`${healthPetAllergies.id}::text`,
        ]);
        const rows = await this.databaseService.connection
            .select({
                paginationKey: key,
                allergy: {
                    id: healthPetAllergies.id,
                    allergen: healthPetAllergies.allergen,
                    category: healthPetAllergies.category,
                    severity: healthPetAllergies.severity,
                    notes: healthPetAllergies.notes,
                    recordedByAccountId: healthPetAllergies.recordedByAccountId,
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
                healthPetAllergies,
                and(eq(healthPetAllergies.petId, pets.id), afterPage(key, request.page)),
            )
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(desc(healthPetAllergies.createdAt), desc(healthPetAllergies.id))
            .limit(request.page?.limit ?? 2147483647);

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): PetAllergyListItem[] => {
            if (row.allergy === null) {
                return [];
            }

            return [
                {
                    ...(request.page === undefined ? {} : { paginationKey: row.paginationKey }),
                    id: row.allergy.id,
                    allergen: row.allergy.allergen,
                    category: row.allergy.category as AllergyCategory,
                    severity: row.allergy.severity as AllergySeverity,
                    notes: row.allergy.notes,
                    recordedByAccountId: row.allergy.recordedByAccountId,
                },
            ];
        });
    }
}
