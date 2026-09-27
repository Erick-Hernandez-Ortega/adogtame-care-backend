import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
  CreateVaccinationRecordOutcome,
  VaccinationRecordRepository,
} from '../../../application/persistence/vaccination-record.repository';
import type { VaccinationRecord } from '../../../domain/vaccination-record/vaccination-record';
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
        if (petRows[0]?.status !== 'ACTIVE') return 'PET_NOT_FOUND';

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
}
