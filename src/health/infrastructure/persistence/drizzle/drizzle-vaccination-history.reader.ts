import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
  VaccinationHistoryReadRequest,
  VaccinationHistoryReader,
  VaccinationHistoryRow,
} from '../../../application/persistence/vaccination-history.reader';
import { healthVaccinationRecords } from './health.schema';

@Injectable()
export class DrizzleVaccinationHistoryReader implements VaccinationHistoryReader {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAccessiblePage(
    request: VaccinationHistoryReadRequest,
  ): Promise<VaccinationHistoryRow[] | null> {
    const after = request.after;
    const records = this.databaseService.connection
      .select({
        id: healthVaccinationRecords.id,
        vaccineName: healthVaccinationRecords.vaccineName,
        appliedDate: healthVaccinationRecords.appliedDate,
        nextDueDate: healthVaccinationRecords.nextDueDate,
        recordedByAccountId: healthVaccinationRecords.recordedByAccountId,
        createdAt:
          sql<string>`to_char(${healthVaccinationRecords.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
            'cursor_created_at',
          ),
      })
      .from(healthVaccinationRecords)
      .where(
        and(
          eq(healthVaccinationRecords.petId, request.petId),
          after === null
            ? undefined
            : sql`(${healthVaccinationRecords.appliedDate}, ${healthVaccinationRecords.createdAt}, ${healthVaccinationRecords.id}) < (${after.appliedDate}::date, ${after.createdAt}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(
        desc(healthVaccinationRecords.appliedDate),
        desc(healthVaccinationRecords.createdAt),
        desc(healthVaccinationRecords.id),
      )
      .limit(request.limit)
      .as('vaccination_history_page');

    const rows = await this.databaseService.connection
      .select({
        petId: pets.id,
        id: records.id,
        vaccineName: records.vaccineName,
        appliedDate: records.appliedDate,
        nextDueDate: records.nextDueDate,
        recordedByAccountId: records.recordedByAccountId,
        createdAt: records.createdAt,
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
      .leftJoinLateral(records, sql`true`)
      .where(
        and(
          eq(pets.id, request.petId),
          inArray(pets.status, ['ACTIVE', 'ARCHIVED']),
        ),
      )
      .orderBy(
        desc(records.appliedDate),
        desc(records.createdAt),
        desc(records.id),
      );

    if (rows.length === 0) return null;
    return rows.flatMap((row): VaccinationHistoryRow[] =>
      row.id === null ||
      row.vaccineName === null ||
      row.appliedDate === null ||
      row.recordedByAccountId === null ||
      row.createdAt === null
        ? []
        : [
            {
              id: row.id,
              vaccineName: row.vaccineName,
              appliedDate: row.appliedDate,
              nextDueDate: row.nextDueDate,
              recordedByAccountId: row.recordedByAccountId,
              createdAt: row.createdAt,
            },
          ],
    );
  }
}
