import { afterPage, paginationKey } from '../../../../infrastructure/database/pagination';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CareActivityListItem,
    CareActivityReader,
    CareActivityReadRequest,
} from '../../../application/persistence/care-activity.reader';
import {
    CareActivity,
    CareActivityId,
    CompletedByAccountId,
} from '../../../domain/care-activity/care-activity';
import { CareRoutineId, PetId } from '../../../domain/care-routine/care-routine';
import { ActivityCompletedAt } from '../../../domain/activity-completed-at/activity-completed-at';
import { ActivityTimezone } from '../../../domain/activity-timezone/activity-timezone';
import { ActivityNotes } from '../../../domain/activity-notes/activity-notes';
import { careActivities } from './care.schema';

@Injectable()
export class DrizzleCareActivityReader implements CareActivityReader {
    constructor(private readonly databaseService: DatabaseService) {}

    async findAccessibleByPet(
        request: CareActivityReadRequest,
    ): Promise<CareActivityListItem[] | null> {
        const key = paginationKey([
            sql`to_char(${careActivities.completedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            sql`to_char(${careActivities.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            sql`${careActivities.id}::text`,
        ]);
        const rows = await this.databaseService.connection
            .select({
                activity: {
                    id: careActivities.id,
                    petId: careActivities.petId,
                    routineId: careActivities.routineId,
                    // PostgreSQL timestamp text makes Date reinterpret years below 0100.
                    completedAt: sql<string>`to_char(${careActivities.completedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
                    completedBy: careActivities.completedBy,
                    timezone: careActivities.timezone,
                    notes: careActivities.notes,
                },
                paginationKey: key,
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
                careActivities,
                and(
                    eq(careActivities.petId, pets.id),
                    afterPage(key, request.page),
                    request.from === undefined
                        ? undefined
                        : sql`(${careActivities.completedAt} AT TIME ZONE ${careActivities.timezone})::date >= ${request.from}::date`,
                    request.to === undefined
                        ? undefined
                        : sql`(${careActivities.completedAt} AT TIME ZONE ${careActivities.timezone})::date <= ${request.to}::date`,
                    request.routineId === undefined
                        ? undefined
                        : eq(careActivities.routineId, request.routineId),
                ),
            )
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(
                desc(careActivities.completedAt),
                desc(careActivities.createdAt),
                desc(careActivities.id),
            )
            .limit(request.page?.limit ?? 2147483647);

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): CareActivityListItem[] => {
            if (row.activity === null) {
                return [];
            }

            const activity: CareActivity = CareActivity.reconstitute({
                id: CareActivityId.from(row.activity.id),
                petId: PetId.from(row.activity.petId),
                routineId: CareRoutineId.from(row.activity.routineId),
                completedAt: ActivityCompletedAt.reconstitute(row.activity.completedAt),
                completedBy: CompletedByAccountId.from(row.activity.completedBy),
                timezone: ActivityTimezone.from(row.activity.timezone),
                notes: row.activity.notes === null ? null : ActivityNotes.from(row.activity.notes),
            });
            const localDay: string = activity.localDay;

            if (
                (request.from !== undefined && localDay < request.from) ||
                (request.to !== undefined && localDay > request.to)
            ) {
                return [];
            }

            return [
                {
                    ...(request.page === undefined ? {} : { paginationKey: row.paginationKey }),
                    id: activity.id.value,
                    routineId: activity.routineId.value,
                    completedAt: activity.completedAt.value,
                    completedBy: activity.completedBy.value,
                    timezone: activity.timezone.value,
                    localDay,
                    notes: activity.notes?.value ?? null,
                },
            ];
        });
    }
}
