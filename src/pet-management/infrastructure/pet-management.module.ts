import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../../identity/infrastructure/identity.module';
import { ListMyPets } from '../application/list-my-pets/list-my-pets';
import {
  PET_QUERY_REPOSITORY,
  type PetQueryRepository,
} from '../application/persistence/pet-query.repository';
import {
  PET_REPOSITORY,
  type PetRepository,
} from '../application/persistence/pet.repository';
import { RegisterPet } from '../application/register-pet/register-pet';
import { PetsController } from './http/controllers/pets.controller';
import { DrizzlePetQueryRepository } from './persistence/drizzle/drizzle-pet-query.repository';
import { DrizzlePetRepository } from './persistence/drizzle/drizzle-pet.repository';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [PetsController],
  providers: [
    DrizzlePetQueryRepository,
    {
      provide: PET_QUERY_REPOSITORY,
      useExisting: DrizzlePetQueryRepository,
    },
    {
      provide: ListMyPets,
      inject: [PET_QUERY_REPOSITORY],
      useFactory: (petQueryRepository: PetQueryRepository): ListMyPets =>
        new ListMyPets(petQueryRepository),
    },
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
