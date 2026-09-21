import { z } from 'zod';
import type { BirthDateAccuracy } from '../../../domain/birth-information/birth-information.types';
import type { BreedKind } from '../../../domain/breed/breed.types';
import type { PetSex, PetSpecies } from '../../../domain/pet/pet.types';

export interface RegisterPetRequest {
  name: string;
  species: PetSpecies;
  breed: {
    name: string;
    kind: BreedKind;
  };
  sex: PetSex;
  birthInformation: {
    date: string;
    accuracy: BirthDateAccuracy;
  };
  color?: string;
  distinctiveMarks?: string;
  microchip?: string;
}

export const registerPetSchema: z.ZodType<RegisterPetRequest> = z
  .object({
    name: z.string(),
    species: z.enum(['DOG', 'CAT']),
    breed: z
      .object({
        name: z.string(),
        kind: z.enum(['KNOWN', 'CUSTOM']),
      })
      .strict(),
    sex: z.enum(['MALE', 'FEMALE', 'UNKNOWN']),
    birthInformation: z
      .object({
        date: z.string(),
        accuracy: z.enum(['EXACT', 'APPROXIMATE']),
      })
      .strict(),
    color: z.string().optional(),
    distinctiveMarks: z.string().optional(),
    microchip: z.string().optional(),
  })
  .strict();
