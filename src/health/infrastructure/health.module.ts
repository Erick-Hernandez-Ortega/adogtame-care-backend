import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/infrastructure/identity.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import {
  WEIGHT_RECORD_REPOSITORY,
  type WeightRecordRepository,
} from '../application/persistence/weight-record.repository';
import { RecordPetWeight } from '../application/record-pet-weight/record-pet-weight';
import { HEALTH_CLOCK, type Clock } from '../application/time/clock';
import { WeightRecordsController } from './http/controllers/weight-records.controller';
import { DrizzleWeightRecordRepository } from './persistence/drizzle/drizzle-weight-record.repository';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [WeightRecordsController],
  providers: [
    DrizzleWeightRecordRepository,
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
