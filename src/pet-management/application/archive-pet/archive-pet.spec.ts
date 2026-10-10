import { ArchivePet } from './archive-pet';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
    ArchivePetCommand,
    ArchivePetPersistenceResult,
    PetRepository,
} from '../persistence/pet.repository';

const command: ArchivePetCommand = {
    petId: '550e8400-e29b-41d4-a716-446655440000',
    requesterAccountId: '550e8400-e29b-41d4-a716-446655440001',
};

function createContext() {
    const archiveIfOwned = jest.fn<Promise<ArchivePetPersistenceResult>, [ArchivePetCommand]>();
    const persistence: PetRepository = {
        restoreIfOwned: jest.fn(),
        archiveIfOwned,
        save: jest.fn(),
        correctProfileIfOwned: jest.fn(),
        leave: jest.fn(),
        removeMemberIfOwned: jest.fn(),
        promoteCollaboratorIfOwned: jest.fn(),
    };

    return { archiveIfOwned, useCase: new ArchivePet(persistence) };
}

describe('ArchivePet', () => {
    it.each(['ARCHIVED', 'ALREADY_ARCHIVED'] as const)('succeeds for %s', async (outcome) => {
        const context = createContext();

        context.archiveIfOwned.mockResolvedValue({ outcome });
        await expect(context.useCase.execute(command)).resolves.toBeUndefined();
        expect(context.archiveIfOwned).toHaveBeenCalledWith(command);
        expect(context.archiveIfOwned).toHaveBeenCalledTimes(1);
    });
    it('conceals missing or unauthorized pets', async () => {
        const context = createContext();

        context.archiveIfOwned.mockResolvedValue({ outcome: 'PET_NOT_FOUND' });
        await expect(context.useCase.execute(command)).rejects.toBeInstanceOf(PetNotFoundError);
    });
    it('propagates unexpected persistence failures', async () => {
        const context = createContext();
        const failure: Error = new Error('Database unavailable');

        context.archiveIfOwned.mockRejectedValue(failure);
        await expect(context.useCase.execute(command)).rejects.toBe(failure);
    });
});
