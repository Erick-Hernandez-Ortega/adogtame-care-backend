import type { BreedKind as BreedKindType } from './breed.types';

export const BreedKind = {
  KNOWN: 'KNOWN',
  CUSTOM: 'CUSTOM',
} as const satisfies Record<string, BreedKindType>;

export class Breed {
  private constructor(
    readonly name: string,
    readonly kind: BreedKindType,
  ) {}

  static known(name: string): Breed {
    return Breed.create(name, BreedKind.KNOWN);
  }

  static custom(name: string): Breed {
    return Breed.create(name, BreedKind.CUSTOM);
  }

  private static create(name: string, kind: BreedKindType): Breed {
    const normalizedName: string = name.trim();

    if (normalizedName.length === 0) {
      throw new TypeError('Breed name cannot be empty');
    }

    return new Breed(normalizedName, kind);
  }
}
