import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import type {
  CreateWeightRecordOutcome,
  DeleteWeightRecordOutcome,
  UpdateWeightRecordOutcome,
  WeightRecordAccess,
  WeightRecordCorrection,
  WeightRecordRepository,
} from '../../../application/persistence/weight-record.repository';
import {
  PetId,
  RecordedByAccountId,
  WeightRecord,
  WeightRecordId,
} from '../../../domain/weight-record/weight-record';
import { Weight } from '../../../domain/weight/weight';
import { MeasuredDate } from '../../../domain/measured-date/measured-date';
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

  async correctIfPetWritable(
    correction: WeightRecordCorrection,
  ): Promise<UpdateWeightRecordOutcome> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<UpdateWeightRecordOutcome> => {
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, correction.petId))
          .for('update');
        if (petRows[0]?.status !== 'ACTIVE') return { status: 'PET_NOT_FOUND' };

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
        )
          return { status: 'PET_NOT_FOUND' };

        const recordRows = await transaction
          .select()
          .from(healthWeightRecords)
          .where(
            and(
              eq(healthWeightRecords.id, correction.weightRecordId),
              eq(healthWeightRecords.petId, correction.petId),
            ),
          )
          .for('update');
        const row = recordRows[0];
        if (row === undefined) return { status: 'WEIGHT_RECORD_NOT_FOUND' };
        const record = WeightRecord.reconstitute({
          id: WeightRecordId.from(row.id),
          petId: PetId.from(row.petId),
          weight: Weight.fromKilograms(row.weightKg),
          measuredDate: MeasuredDate.from(row.measuredDate, row.measuredDate),
          recordedByAccountId: RecordedByAccountId.from(
            row.recordedByAccountId,
          ),
        });
        const corrected = record.correct({
          weight: correction.weight,
          measuredDate: correction.measuredDate,
        });
        if (corrected === record) return { status: 'UNCHANGED', record };
        await transaction
          .update(healthWeightRecords)
          .set({
            weightKg: corrected.weight.kilograms,
            measuredDate: corrected.measuredDate.value,
          })
          .where(
            and(
              eq(healthWeightRecords.id, correction.weightRecordId),
              eq(healthWeightRecords.petId, correction.petId),
            ),
          );
        return { status: 'UPDATED', record: corrected };
      },
      { isolationLevel: 'read committed' },
    );
  }

  async deleteIfPetWritable(
    access: WeightRecordAccess,
  ): Promise<DeleteWeightRecordOutcome> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<DeleteWeightRecordOutcome> => {
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, access.petId))
          .for('update');
        if (petRows[0]?.status !== 'ACTIVE') return 'PET_NOT_FOUND';

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
        )
          return 'PET_NOT_FOUND';

        const recordRows = await transaction
          .select({ id: healthWeightRecords.id })
          .from(healthWeightRecords)
          .where(
            and(
              eq(healthWeightRecords.id, access.weightRecordId),
              eq(healthWeightRecords.petId, access.petId),
            ),
          )
          .for('update');
        if (recordRows.length === 0) return 'WEIGHT_RECORD_NOT_FOUND';
        const deletedRows = await transaction
          .delete(healthWeightRecords)
          .where(
            and(
              eq(healthWeightRecords.id, access.weightRecordId),
              eq(healthWeightRecords.petId, access.petId),
            ),
          )
          .returning({ id: healthWeightRecords.id });
        return deletedRows.length === 0 ? 'WEIGHT_RECORD_NOT_FOUND' : 'DELETED';
      },
      { isolationLevel: 'read committed' },
    );
  }
}
