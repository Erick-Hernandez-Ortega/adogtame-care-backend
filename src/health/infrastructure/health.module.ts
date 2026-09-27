import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/infrastructure/identity.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import {
  WEIGHT_RECORD_REPOSITORY,
  type WeightRecordRepository,
} from '../application/persistence/weight-record.repository';
import { RecordPetWeight } from '../application/record-pet-weight/record-pet-weight';
import { ListPetWeightHistory } from '../application/list-pet-weight-history/list-pet-weight-history';
import {
  WEIGHT_HISTORY_READER,
  type WeightHistoryReader,
} from '../application/persistence/weight-history.reader';
import { HEALTH_CLOCK, type Clock } from '../application/time/clock';
import { WeightRecordsController } from './http/controllers/weight-records.controller';
import { DrizzleWeightRecordRepository } from './persistence/drizzle/drizzle-weight-record.repository';
import { DrizzleWeightHistoryReader } from './persistence/drizzle/drizzle-weight-history.reader';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [WeightRecordsController],
  providers: [
    DrizzleWeightRecordRepository,
    DrizzleWeightHistoryReader,
    {
      provide: WEIGHT_HISTORY_READER,
      useExisting: DrizzleWeightHistoryReader,
    },
    {
      provide: ListPetWeightHistory,
      inject: [WEIGHT_HISTORY_READER],
      useFactory: (reader: WeightHistoryReader): ListPetWeightHistory =>
        new ListPetWeightHistory(reader),
    },
    {
      provide: WEIGHT_RECORD_REPOSITORY,
      useExisting: DrizzleWeightRecordRepository,
    },
    {
      provide: HEALTH_CLOCK,
      useFactory: (): Clock => ({ now: (): Date => new Date() }),
    },
    {
      provide: RecordPetWeight,
      inject: [WEIGHT_RECORD_REPOSITORY, HEALTH_CLOCK],
      useFactory: (
        repository: WeightRecordRepository,
        clock: Clock,
      ): RecordPetWeight => new RecordPetWeight(repository, clock),
    },
  ],
})
export class HealthModule {}
