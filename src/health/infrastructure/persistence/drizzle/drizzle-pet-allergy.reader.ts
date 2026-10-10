import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
        const rows = await this.databaseService.connection
            .select({
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
            .leftJoin(healthPetAllergies, eq(healthPetAllergies.petId, pets.id))
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(desc(healthPetAllergies.createdAt), desc(healthPetAllergies.id));

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): PetAllergyListItem[] => {
            if (row.allergy === null) {
                return [];
            }

            return [
                {
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
