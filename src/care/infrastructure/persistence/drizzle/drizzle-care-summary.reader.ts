import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import { afterPage, paginationKey } from '../../../../infrastructure/database/pagination';
import {
    pets,
    petMemberships,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CareSummaryReader,
    CareSummaryReadRequest,
    CareSummaryRoutine,
} from '../../../application/persistence/care-summary.reader';
import { RoutineFrequency } from '../../../domain/routine-frequency/routine-frequency';
import { careActivities, careRoutines } from './care.schema';

@Injectable()
export class DrizzleCareSummaryReader implements CareSummaryReader {
    constructor(private readonly databaseService: DatabaseService) {}

    async findAccessibleByPet(
        request: CareSummaryReadRequest,
    ): Promise<CareSummaryRoutine[] | null> {
        const key = paginationKey([
            sql`to_char(${careRoutines.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            sql`${careRoutines.id}::text`,
        ]);
        const activityDay = sql`(${careActivities.completedAt} AT TIME ZONE ${careActivities.timezone})::date`;
        const rows = await this.databaseService.connection
            .select({
                routine: careRoutines,
                paginationKey: key,
                createdLocalDay: sql<string>`to_char(${careRoutines.createdAt} AT TIME ZONE ${careRoutines.timezone}, 'YYYY-MM-DD')`,
                completedByDay: sql<Record<string, number>>`coalesce((
                select jsonb_object_agg(daily.local_day, daily.completed)
                from (
                    select to_char(${activityDay}, 'YYYY-MM-DD') as local_day, count(*) as completed
                    from ${careActivities}
                    where ${careActivities.petId} = ${pets.id}
                      and ${careActivities.routineId} = ${careRoutines.id}
                      and ${activityDay} >= date_trunc('week', ${request.from}::date)::date
                      and ${activityDay} <= date_trunc('week', ${request.to}::date)::date + 6
                    group by ${activityDay}
                ) daily
            ), '{}'::jsonb)`,
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
                careRoutines,
                and(
                    eq(careRoutines.petId, pets.id),
                    request.routineId === undefined
                        ? undefined
                        : eq(careRoutines.id, request.routineId),
                    afterPage(key, request.page),
                ),
            )
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(desc(careRoutines.createdAt), desc(careRoutines.id))
            .limit(request.page.limit);

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): CareSummaryRoutine[] => {
            if (row.routine === null) {
                return [];
            }

            return [
                {
                    routineId: row.routine.id,
                    timezone: row.routine.timezone,
                    createdLocalDay: row.createdLocalDay,
                    completedByDay: row.completedByDay,
                    paginationKey: row.paginationKey,
                    frequency: RoutineFrequency.from({
                        period: row.routine.frequencyPeriod,
                        timesPerPeriod: row.routine.timesPerPeriod,
                        weekdays: row.routine.weekdays,
                        suggestedTimes: row.routine.suggestedTimes,
                    }),
                },
            ];
        });
    }
}
