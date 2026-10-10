import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    WeightHistoryReadRequest,
    WeightHistoryReader,
    WeightHistoryRow,
} from '../../../application/persistence/weight-history.reader';
import { healthWeightRecords } from './health.schema';

@Injectable()
export class DrizzleWeightHistoryReader implements WeightHistoryReader {
    constructor(private readonly databaseService: DatabaseService) {}

    async findAccessiblePage(
        request: WeightHistoryReadRequest,
    ): Promise<WeightHistoryRow[] | null> {
        const after = request.after;
        const records = this.databaseService.connection
            .select({
                id: healthWeightRecords.id,
                weightKg: healthWeightRecords.weightKg,
                measuredDate: healthWeightRecords.measuredDate,
                recordedByAccountId: healthWeightRecords.recordedByAccountId,
                createdAt:
                    sql<string>`to_char(${healthWeightRecords.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
                        'cursor_created_at',
                    ),
            })
            .from(healthWeightRecords)
            .where(
                and(
                    eq(healthWeightRecords.petId, request.petId),
                    after === null
                        ? undefined
                        : sql`(${healthWeightRecords.measuredDate}, ${healthWeightRecords.createdAt}, ${healthWeightRecords.id}) < (${after.measuredDate}::date, ${after.createdAt}::timestamptz, ${after.id}::uuid)`,
                ),
            )
            .orderBy(
                desc(healthWeightRecords.measuredDate),
                desc(healthWeightRecords.createdAt),
                desc(healthWeightRecords.id),
            )
            .limit(request.limit)
            .as('weight_history_page');

        const rows = await this.databaseService.connection
            .select({
                petId: pets.id,
                id: records.id,
                weightKg: records.weightKg,
                measuredDate: records.measuredDate,
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
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(desc(records.measuredDate), desc(records.createdAt), desc(records.id));

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): WeightHistoryRow[] =>
            row.id === null ||
            row.weightKg === null ||
            row.measuredDate === null ||
            row.recordedByAccountId === null ||
            row.createdAt === null
                ? []
                : [
                      {
                          id: row.id,
                          weightKg: row.weightKg,
                          measuredDate: row.measuredDate,
                          recordedByAccountId: row.recordedByAccountId,
                          createdAt: row.createdAt,
                      },
                  ],
        );
    }
}
