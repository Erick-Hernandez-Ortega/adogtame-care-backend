import { ListPetMedications, PetNotFoundError } from './list-pet-medications';
import type {
    ListedPetMedication,
    PetMedicationReader,
    PetMedicationReadRequest,
} from '../persistence/pet-medication.reader';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';
const firstMedication: ListedPetMedication = {
    id: '80db31a0-aeb9-4768-b103-770110b39fd8',
    name: 'Amoxicillin',
    dosage: '250 mg',
    frequency: 'Every 12 hours',
    startDate: '2026-10-10',
    plannedEndDate: '2026-10-17',
    notes: 'Reported reaction.',
    recordedByAccountId: ACCOUNT_ID,
};
const secondMedication: ListedPetMedication = {
    ...firstMedication,
    id: '7197fb48-3906-4da9-86d7-8323e04d7725',
    dosage: null,
    frequency: null,
    startDate: null,
    plannedEndDate: null,
    notes: null,
};

function setup(items: ListedPetMedication[] | null = [firstMedication, secondMedication]) {
    const listIfPetReadable = jest
        .fn<Promise<ListedPetMedication[] | null>, [PetMedicationReadRequest]>()
        .mockResolvedValue(items);
    const reader: PetMedicationReader = { listIfPetReadable };

    return { useCase: new ListPetMedications(reader), listIfPetReadable };
}

describe('ListPetMedications', () => {
    it('returns all reader items in their original order with the exact contract', async () => {
        const { useCase, listIfPetReadable } = setup();

        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).resolves.toEqual({ items: [firstMedication, secondMedication] });
        expect(listIfPetReadable).toHaveBeenCalledTimes(1);
        expect(listIfPetReadable).toHaveBeenCalledWith({
            petId: PET_ID,
            authenticatedAccountId: ACCOUNT_ID,
        });
    });

    it('returns an empty collection for an accessible pet', async () => {
        const { useCase } = setup([]);

        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).resolves.toEqual({ items: [] });
    });

    it('translates inaccessible pets to PetNotFoundError', async () => {
        const { useCase } = setup(null);

        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).rejects.toThrow(PetNotFoundError);
    });

    it('propagates the original unexpected reader failure', async () => {
        const { useCase, listIfPetReadable } = setup();
        const failure: Error = new Error('Database failure');

        listIfPetReadable.mockRejectedValue(failure);
        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).rejects.toBe(failure);
    });
});
