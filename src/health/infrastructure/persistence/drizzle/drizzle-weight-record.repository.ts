import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import type {
  CreateWeightRecordOutcome,
  WeightRecordRepository,
} from '../../../application/persistence/weight-record.repository';
import type { WeightRecord } from '../../../domain/weight-record/weight-record';
import {
  petMemberships,
  pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import { healthWeightRecords } from './health.schema';

@Injectable()
export class DrizzleWeightRecordRepository implements WeightRecordRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async createIfPetWritable(
    weightRecord: WeightRecord,
  ): Promise<CreateWeightRecordOutcome> {
    return this.databaseService.connection.transaction(
      async (transaction) => {
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, weightRecord.petId.value))
          .for('update');
        if (petRows[0]?.status !== 'ACTIVE') {
          return 'PET_NOT_FOUND';
        }

        const membershipRows = await transaction
          .select({ role: petMemberships.role, status: petMemberships.status })
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, weightRecord.petId.value),
              eq(
                petMemberships.accountId,
                weightRecord.recordedByAccountId.value,
              ),
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

        await transaction.insert(healthWeightRecords).values({
          id: weightRecord.id.value,
          petId: weightRecord.petId.value,
          weightKg: weightRecord.weight.kilograms,
          measuredDate: weightRecord.measuredDate.value,
          recordedByAccountId: weightRecord.recordedByAccountId.value,
        });
        return 'CREATED';
      },
      { isolationLevel: 'read committed' },
    );
  }
}
