import type { Pet } from '../../domain/pet/pet';

export const PET_REPOSITORY: unique symbol = Symbol('PET_REPOSITORY');

export interface PetRepository {
  save(pet: Pet): Promise<void>;
}
