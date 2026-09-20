import { Breed, BreedKind } from './breed';

describe('Breed', () => {
  it('represents a known breed', () => {
    const breed: Breed = Breed.known(' Labrador Retriever ');

    expect(breed.name).toBe('Labrador Retriever');
    expect(breed.kind).toBe(BreedKind.KNOWN);
  });

  it('represents a custom breed', () => {
    const breed: Breed = Breed.custom(' Local mixed breed ');

    expect(breed.name).toBe('Local mixed breed');
    expect(breed.kind).toBe(BreedKind.CUSTOM);
  });

  it.each([
    ['known', (name: string): Breed => Breed.known(name)],
    ['custom', (name: string): Breed => Breed.custom(name)],
  ])('rejects an empty %s breed', (_kind: string, createBreed) => {
    expect(() => createBreed('   ')).toThrow('Breed name cannot be empty');
  });
});
