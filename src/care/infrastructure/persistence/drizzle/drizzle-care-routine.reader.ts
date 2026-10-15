import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CareRoutineListItem,
    CareRoutineReader,
    CareRoutineReadRequest,
} from '../../../application/persistence/care-routine.reader';
import { CareRoutineType } from '../../../domain/routine-type/routine-type';
import { RoutineFrequency } from '../../../domain/routine-frequency/routine-frequency';
import { careRoutines } from './care.schema';

@Injectable()
export class DrizzleCareRoutineReader implements CareRoutineReader {
    constructor(private readonly databaseService: DatabaseService) {}

    async findAccessibleByPet(
        request: CareRoutineReadRequest,
    ): Promise<CareRoutineListItem[] | null> {
        const rows = await this.databaseService.connection
            .select({
                routine: {
                    id: careRoutines.id,
                    type: careRoutines.type,
                    title: careRoutines.title,
                    instructions: careRoutines.instructions,
                    frequencyPeriod: careRoutines.frequencyPeriod,
                    timesPerPeriod: careRoutines.timesPerPeriod,
                    suggestedTimes: careRoutines.suggestedTimes,
                    weekdays: careRoutines.weekdays,
                    timezone: careRoutines.timezone,
                    recordedByAccountId: careRoutines.recordedByAccountId,
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
            .leftJoin(careRoutines, eq(careRoutines.petId, pets.id))
            .where(and(eq(pets.id, request.petId), inArray(pets.status, ['ACTIVE', 'ARCHIVED'])))
            .orderBy(desc(careRoutines.createdAt), desc(careRoutines.id));

        if (rows.length === 0) {
            return null;
        }

        return rows.flatMap((row): CareRoutineListItem[] => {
            if (row.routine === null) {
                return [];
            }

            const frequency: RoutineFrequency = RoutineFrequency.from({
                period: row.routine.frequencyPeriod,
                timesPerPeriod: row.routine.timesPerPeriod,
                suggestedTimes: row.routine.suggestedTimes,
                weekdays: row.routine.weekdays,
            });

            return [
                {
                    id: row.routine.id,
                    type: CareRoutineType.from(row.routine.type).value,
                    title: row.routine.title,
                    instructions: row.routine.instructions,
                    frequency: {
                        period: frequency.period,
                        timesPerPeriod: frequency.timesPerPeriod,
                        suggestedTimes: frequency.suggestedTimes,
                        weekdays: frequency.weekdays,
                    },
                    timezone: row.routine.timezone,
                    recordedByAccountId: row.routine.recordedByAccountId,
                },
            ];
        });
    }
}
