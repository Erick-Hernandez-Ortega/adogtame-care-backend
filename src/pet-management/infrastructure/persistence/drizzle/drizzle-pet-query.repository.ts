import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import type {
    AccessiblePetSummary,
    PetDetail,
    PetMemberSummary,
    PetQueryRepository,
} from '../../../application/persistence/pet-query.repository';
import type { BirthDateAccuracy } from '../../../domain/birth-information/birth-information.types';
import type { BreedKind } from '../../../domain/breed/breed.types';
import type { PetMembershipRole } from '../../../domain/pet-membership/pet-membership.types';
import {
    PetMembershipRole as PetMembershipRoleValue,
    PetMembershipStatus,
} from '../../../domain/pet-membership/pet-membership';
import { PetStatus } from '../../../domain/pet/pet';
import type { PetSex, PetSpecies, PetStatus as PetStatusType } from '../../../domain/pet/pet.types';
import { petMemberships, pets } from './pet-management.schema';

@Injectable()
export class DrizzlePetQueryRepository implements PetQueryRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async findAccessibleMembers(
        petId: string,
        accountId: string,
    ): Promise<PetMemberSummary[] | null> {
        const requesterMemberships = alias(petMemberships, 'requester_memberships');
        const rows = await this.databaseService.connection
            .select({
                membershipId: petMemberships.id,
                accountId: petMemberships.accountId,
                role: petMemberships.role,
            })
            .from(pets)
            .innerJoin(
                requesterMemberships,
                and(
                    eq(requesterMemberships.petId, pets.id),
                    eq(requesterMemberships.accountId, accountId),
                    eq(requesterMemberships.status, PetMembershipStatus.ACTIVE),
                    inArray(requesterMemberships.role, [
                        PetMembershipRoleValue.OWNER,
                        PetMembershipRoleValue.COLLABORATOR,
                    ]),
                ),
            )
            .innerJoin(
                petMemberships,
                and(
                    eq(petMemberships.petId, pets.id),
                    eq(petMemberships.status, PetMembershipStatus.ACTIVE),
                ),
            )
            .where(
                and(
                    eq(pets.id, petId),
                    inArray(pets.status, [PetStatus.ACTIVE, PetStatus.ARCHIVED]),
                ),
            )
            .orderBy(
                asc(sql`case when ${petMemberships.role} = 'OWNER' then 0 else 1 end`),
                asc(petMemberships.createdAt),
                asc(petMemberships.id),
            );

        if (rows.length === 0) {
            return null;
        }

        return rows.map((row): PetMemberSummary => ({
            membershipId: row.membershipId,
            accountId: row.accountId,
            role: row.role as PetMembershipRole,
        }));
    }

    async findAccessibleByAccountId(accountId: string): Promise<AccessiblePetSummary[]> {
        const rows = await this.databaseService.connection
            .select({
                id: pets.id,
                name: pets.name,
                species: pets.species,
                breedName: pets.breedName,
                breedKind: pets.breedKind,
                sex: pets.sex,
                status: pets.status,
                role: petMemberships.role,
            })
            .from(petMemberships)
            .innerJoin(pets, eq(petMemberships.petId, pets.id))
            .where(
                and(
                    eq(petMemberships.accountId, accountId),
                    eq(petMemberships.status, PetMembershipStatus.ACTIVE),
                    inArray(pets.status, [PetStatus.ACTIVE, PetStatus.ARCHIVED]),
                ),
            )
            .orderBy(asc(pets.name), asc(pets.id));

        return rows.map((row): AccessiblePetSummary => ({
            id: row.id,
            name: row.name,
            species: row.species as PetSpecies,
            breed: {
                name: row.breedName,
                kind: row.breedKind as BreedKind,
            },
            sex: row.sex as PetSex,
            status: row.status as PetStatusType,
            role: row.role as PetMembershipRole,
        }));
    }

    async findAccessibleDetailById(petId: string, accountId: string): Promise<PetDetail | null> {
        const rows = await this.databaseService.connection
            .select({
                id: pets.id,
                name: pets.name,
                species: pets.species,
                breedName: pets.breedName,
                breedKind: pets.breedKind,
                sex: pets.sex,
                birthDate: pets.birthDate,
                birthDateAccuracy: pets.birthDateAccuracy,
                color: pets.color,
                distinctiveMarks: pets.distinctiveMarks,
                microchip: pets.microchip,
                status: pets.status,
                role: petMemberships.role,
            })
            .from(pets)
            .innerJoin(petMemberships, eq(petMemberships.petId, pets.id))
            .where(
                and(
                    eq(pets.id, petId),
                    eq(petMemberships.accountId, accountId),
                    eq(petMemberships.status, PetMembershipStatus.ACTIVE),
                    inArray(pets.status, [PetStatus.ACTIVE, PetStatus.ARCHIVED]),
                ),
            )
            .limit(1);
        const row = rows[0];

        if (row === undefined) {
            return null;
        }

        return {
            id: row.id,
            name: row.name,
            species: row.species as PetSpecies,
            breed: {
                name: row.breedName,
                kind: row.breedKind as BreedKind,
            },
            sex: row.sex as PetSex,
            birthInformation: {
                date: row.birthDate,
                accuracy: row.birthDateAccuracy as BirthDateAccuracy,
            },
            color: row.color,
            distinctiveMarks: row.distinctiveMarks,
            microchip: row.microchip,
            status: row.status as PetStatusType,
            role: row.role as PetMembershipRole,
        };
    }

    async hasActiveOwnerAccess(petId: string, accountId: string): Promise<boolean> {
        const rows = await this.databaseService.connection
            .select({ id: pets.id })
            .from(pets)
            .innerJoin(petMemberships, eq(petMemberships.petId, pets.id))
            .where(
                and(
                    eq(pets.id, petId),
                    eq(pets.status, PetStatus.ACTIVE),
                    eq(petMemberships.accountId, accountId),
                    eq(petMemberships.status, PetMembershipStatus.ACTIVE),
                    eq(petMemberships.role, PetMembershipRoleValue.OWNER),
                ),
            )
            .limit(1);

        return rows.length > 0;
    }

    async hasActiveMembership(petId: string, accountId: string): Promise<boolean> {
        const rows = await this.databaseService.connection
            .select({ id: petMemberships.id })
            .from(petMemberships)
            .where(
                and(
                    eq(petMemberships.petId, petId),
                    eq(petMemberships.accountId, accountId),
                    eq(petMemberships.status, PetMembershipStatus.ACTIVE),
                ),
            )
            .limit(1);

        return rows.length > 0;
    }
}
