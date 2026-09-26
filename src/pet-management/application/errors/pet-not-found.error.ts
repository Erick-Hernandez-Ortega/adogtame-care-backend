export class PetNotFoundError extends Error {
  constructor() {
    super('Pet was not found');
    this.name = 'PetNotFoundError';
  }
}
