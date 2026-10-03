import { RestorePet } from './restore-pet';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
  RestorePetCommand,
  RestorePetPersistenceResult,
  PetRepository,
} from '../persistence/pet.repository';

const command: RestorePetCommand = {
  petId: '550e8400-e29b-41d4-a716-446655440000',
  requesterAccountId: '550e8400-e29b-41d4-a716-446655440001',
};

function createContext() {
  const restoreIfOwned = jest.fn<
    Promise<RestorePetPersistenceResult>,
    [RestorePetCommand]
  >();
  const persistence: PetRepository = {
    restoreIfOwned,
    archiveIfOwned: jest.fn(),
    save: jest.fn(),
    correctProfileIfOwned: jest.fn(),
    leave: jest.fn(),
    removeMemberIfOwned: jest.fn(),
    promoteCollaboratorIfOwned: jest.fn(),
  };
  return { restoreIfOwned, useCase: new RestorePet(persistence) };
}

describe('RestorePet', () => {
  it.each(['RESTORED', 'ALREADY_ACTIVE'] as const)(
    'succeeds for %s',
    async (outcome) => {
      const context = createContext();
      context.restoreIfOwned.mockResolvedValue({ outcome });
      await expect(context.useCase.execute(command)).resolves.toBeUndefined();
      expect(context.restoreIfOwned).toHaveBeenCalledWith(command);
      expect(context.restoreIfOwned).toHaveBeenCalledTimes(1);
    },
  );
  it('conceals missing or unauthorized pets', async () => {
    const context = createContext();
    context.restoreIfOwned.mockResolvedValue({ outcome: 'PET_NOT_FOUND' });
    await expect(context.useCase.execute(command)).rejects.toBeInstanceOf(
      PetNotFoundError,
    );
  });
  it('propagates unexpected persistence failures', async () => {
    const context = createContext();
    const failure: Error = new Error('Database unavailable');
    context.restoreIfOwned.mockRejectedValue(failure);
    await expect(context.useCase.execute(command)).rejects.toBe(failure);
  });
});
