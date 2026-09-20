import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import {
  PET_REPOSITORY,
  type PetRepository,
} from '../application/persistence/pet.repository';
import { RegisterPet } from '../application/register-pet/register-pet';
import { PetsController } from './http/controllers/pets.controller';
import { DrizzlePetRepository } from './persistence/drizzle/drizzle-pet.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [PetsController],
  providers: [
    DrizzlePetRepository,
    {
      provide: PET_REPOSITORY,
      useExisting: DrizzlePetRepository,
    },
    {
      provide: RegisterPet,
      inject: [PET_REPOSITORY],
      useFactory: (petRepository: PetRepository): RegisterPet =>
        new RegisterPet(petRepository),
    },
  ],
})
export class PetManagementModule {}
