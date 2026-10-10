import { Module } from '@nestjs/common';
import { UpdatePetMedicalCondition } from '../application/update-pet-medical-condition/update-pet-medical-condition';
import { ListPetMedicalConditions } from '../application/list-pet-medical-conditions/list-pet-medical-conditions';
import {
    PET_MEDICAL_CONDITION_READER,
    type PetMedicalConditionReader,
} from '../application/persistence/pet-medical-condition.reader';
import { DrizzlePetMedicalConditionReader } from './persistence/drizzle/drizzle-pet-medical-condition.reader';
import { RecordPetMedicalCondition } from '../application/record-pet-medical-condition/record-pet-medical-condition';
import {
    PET_MEDICAL_CONDITION_REPOSITORY,
    type PetMedicalConditionRepository,
} from '../application/persistence/pet-medical-condition.repository';
import { DrizzlePetMedicalConditionRepository } from './persistence/drizzle/drizzle-pet-medical-condition.repository';
import { PetMedicalConditionsController } from './http/controllers/pet-medical-conditions.controller';
import { DeletePetAllergy } from '../application/delete-pet-allergy/delete-pet-allergy';
import { UpdatePetAllergy } from '../application/update-pet-allergy/update-pet-allergy';
import { ListPetAllergies } from '../application/list-pet-allergies/list-pet-allergies';
import {
    PET_ALLERGY_READER,
    type PetAllergyReader,
} from '../application/persistence/pet-allergy.reader';
import { DrizzlePetAllergyReader } from './persistence/drizzle/drizzle-pet-allergy.reader';
import {
    PET_ALLERGY_REPOSITORY,
    type PetAllergyRepository,
} from '../application/persistence/pet-allergy.repository';
import { RecordPetAllergy } from '../application/record-pet-allergy/record-pet-allergy';
import { PetAllergiesController } from './http/controllers/pet-allergies.controller';
import { DrizzlePetAllergyRepository } from './persistence/drizzle/drizzle-pet-allergy.repository';
import { IdentityModule } from '../../identity/infrastructure/identity.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import {
    WEIGHT_RECORD_REPOSITORY,
    type WeightRecordRepository,
} from '../application/persistence/weight-record.repository';
import { RecordPetWeight } from '../application/record-pet-weight/record-pet-weight';
import { UpdatePetWeightRecord } from '../application/update-pet-weight-record/update-pet-weight-record';
import { DeletePetWeightRecord } from '../application/delete-pet-weight-record/delete-pet-weight-record';
import { ListPetWeightHistory } from '../application/list-pet-weight-history/list-pet-weight-history';
import {
    WEIGHT_HISTORY_READER,
    type WeightHistoryReader,
} from '../application/persistence/weight-history.reader';
import { HEALTH_CLOCK, type Clock } from '../application/time/clock';
import { WeightRecordsController } from './http/controllers/weight-records.controller';
import { DrizzleWeightRecordRepository } from './persistence/drizzle/drizzle-weight-record.repository';
import { DrizzleWeightHistoryReader } from './persistence/drizzle/drizzle-weight-history.reader';
import { VaccinationRecordsController } from './http/controllers/vaccination-records.controller';
import { DrizzleVaccinationRecordRepository } from './persistence/drizzle/drizzle-vaccination-record.repository';
import {
    VACCINATION_RECORD_REPOSITORY,
    type VaccinationRecordRepository,
} from '../application/persistence/vaccination-record.repository';
import { RecordVaccination } from '../application/record-vaccination/record-vaccination';
import { UpdateVaccinationRecord } from '../application/update-vaccination-record/update-vaccination-record';
import { DeleteVaccinationRecord } from '../application/delete-vaccination-record/delete-vaccination-record';
import {
    VACCINATION_HISTORY_READER,
    type VaccinationHistoryReader,
} from '../application/persistence/vaccination-history.reader';
import { ListPetVaccinationHistory } from '../application/list-pet-vaccination-history/list-pet-vaccination-history';
import { DrizzleVaccinationHistoryReader } from './persistence/drizzle/drizzle-vaccination-history.reader';

@Module({
    imports: [DatabaseModule, IdentityModule],
    controllers: [
        PetMedicalConditionsController,
        WeightRecordsController,
        VaccinationRecordsController,
        PetAllergiesController,
    ],
    providers: [
        {
            provide: UpdatePetMedicalCondition,
            inject: [PET_MEDICAL_CONDITION_REPOSITORY, HEALTH_CLOCK],
            useFactory: (
                repository: PetMedicalConditionRepository,
                clock: Clock,
            ): UpdatePetMedicalCondition => new UpdatePetMedicalCondition(repository, clock),
        },
        DrizzlePetMedicalConditionReader,
        {
            provide: PET_MEDICAL_CONDITION_READER,
            useExisting: DrizzlePetMedicalConditionReader,
        },
        {
            provide: ListPetMedicalConditions,
            inject: [PET_MEDICAL_CONDITION_READER],
            useFactory: (reader: PetMedicalConditionReader): ListPetMedicalConditions =>
                new ListPetMedicalConditions(reader),
        },
        DrizzlePetMedicalConditionRepository,
        {
            provide: PET_MEDICAL_CONDITION_REPOSITORY,
            useExisting: DrizzlePetMedicalConditionRepository,
        },
        {
            provide: RecordPetMedicalCondition,
            inject: [PET_MEDICAL_CONDITION_REPOSITORY, HEALTH_CLOCK],
            useFactory: (
                repository: PetMedicalConditionRepository,
                clock: Clock,
            ): RecordPetMedicalCondition => new RecordPetMedicalCondition(repository, clock),
        },
        {
            provide: DeletePetAllergy,
            inject: [PET_ALLERGY_REPOSITORY],
            useFactory: (repository: PetAllergyRepository): DeletePetAllergy =>
                new DeletePetAllergy(repository),
        },
        {
            provide: UpdatePetAllergy,
            inject: [PET_ALLERGY_REPOSITORY],
            useFactory: (repository: PetAllergyRepository): UpdatePetAllergy =>
                new UpdatePetAllergy(repository),
        },
        DrizzlePetAllergyReader,
        {
            provide: PET_ALLERGY_READER,
            useExisting: DrizzlePetAllergyReader,
        },
        {
            provide: ListPetAllergies,
            inject: [PET_ALLERGY_READER],
            useFactory: (reader: PetAllergyReader): ListPetAllergies =>
                new ListPetAllergies(reader),
        },
        DrizzlePetAllergyRepository,
        {
            provide: PET_ALLERGY_REPOSITORY,
            useExisting: DrizzlePetAllergyRepository,
        },
        {
            provide: RecordPetAllergy,
            inject: [PET_ALLERGY_REPOSITORY],
            useFactory: (repository: PetAllergyRepository): RecordPetAllergy =>
                new RecordPetAllergy(repository),
        },
        DrizzleWeightRecordRepository,
        DrizzleWeightHistoryReader,
        DrizzleVaccinationRecordRepository,
        DrizzleVaccinationHistoryReader,
        {
            provide: VACCINATION_HISTORY_READER,
            useExisting: DrizzleVaccinationHistoryReader,
        },
        {
            provide: ListPetVaccinationHistory,
            inject: [VACCINATION_HISTORY_READER],
            useFactory: (reader: VaccinationHistoryReader): ListPetVaccinationHistory =>
                new ListPetVaccinationHistory(reader),
        },
        {
            provide: VACCINATION_RECORD_REPOSITORY,
            useExisting: DrizzleVaccinationRecordRepository,
        },
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
            useFactory: (repository: WeightRecordRepository, clock: Clock): RecordPetWeight =>
                new RecordPetWeight(repository, clock),
        },
        {
            provide: UpdatePetWeightRecord,
            inject: [WEIGHT_RECORD_REPOSITORY, HEALTH_CLOCK],
            useFactory: (repository: WeightRecordRepository, clock: Clock): UpdatePetWeightRecord =>
                new UpdatePetWeightRecord(repository, clock),
        },
        {
            provide: DeletePetWeightRecord,
            inject: [WEIGHT_RECORD_REPOSITORY],
            useFactory: (repository: WeightRecordRepository): DeletePetWeightRecord =>
                new DeletePetWeightRecord(repository),
        },
        {
            provide: RecordVaccination,
            inject: [VACCINATION_RECORD_REPOSITORY, HEALTH_CLOCK],
            useFactory: (
                repository: VaccinationRecordRepository,
                clock: Clock,
            ): RecordVaccination => new RecordVaccination(repository, clock),
        },
        {
            provide: UpdateVaccinationRecord,
            inject: [VACCINATION_RECORD_REPOSITORY, HEALTH_CLOCK],
            useFactory: (
                repository: VaccinationRecordRepository,
                clock: Clock,
            ): UpdateVaccinationRecord => new UpdateVaccinationRecord(repository, clock),
        },
        {
            provide: DeleteVaccinationRecord,
            inject: [VACCINATION_RECORD_REPOSITORY],
            useFactory: (repository: VaccinationRecordRepository): DeleteVaccinationRecord =>
                new DeleteVaccinationRecord(repository),
        },
    ],
})
export class HealthModule {}
