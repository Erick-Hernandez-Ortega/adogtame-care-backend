import { ListPetAllergies, PetNotFoundError } from './list-pet-allergies';
import type {
    PetAllergyListItem,
    PetAllergyReader,
    PetAllergyReadRequest,
} from '../persistence/pet-allergy.reader';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';
const first: PetAllergyListItem = {
    id: '80db31a0-aeb9-4768-b103-770110b39fd8',
    allergen: 'Penicillin',
    category: 'MEDICATION',
    severity: 'SEVERE',
    notes: 'Reported reaction.',
    recordedByAccountId: ACCOUNT_ID,
};
const second: PetAllergyListItem = {
    ...first,
    id: '7197fb48-3906-4da9-86d7-8323e04d7725',
    notes: null,
};

function setup(items: PetAllergyListItem[] | null = [first, second]) {
    const findAccessibleByPet = jest
        .fn<Promise<PetAllergyListItem[] | null>, [PetAllergyReadRequest]>()
        .mockResolvedValue(items);
    const reader: PetAllergyReader = { findAccessibleByPet };

    return { useCase: new ListPetAllergies(reader), findAccessibleByPet };
}

describe('ListPetAllergies', () => {
    it('returns all reader items in their original order with the exact contract', async () => {
        const { useCase, findAccessibleByPet } = setup();

        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).resolves.toEqual({ items: [first, second] });
        expect(findAccessibleByPet).toHaveBeenCalledTimes(1);
        expect(findAccessibleByPet).toHaveBeenCalledWith({
            petId: PET_ID,
            accountId: ACCOUNT_ID,
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
        const { useCase, findAccessibleByPet } = setup();
        const failure: Error = new Error('Database failure');

        findAccessibleByPet.mockRejectedValue(failure);
        await expect(
            useCase.execute({ petId: PET_ID, authenticatedAccountId: ACCOUNT_ID }),
        ).rejects.toBe(failure);
    });
});
