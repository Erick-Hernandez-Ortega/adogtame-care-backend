import type { PetAllergy } from '../../domain/pet-allergy/pet-allergy';
import type {
    PetAllergyRepository,
    CreatePetAllergyOutcome,
} from '../persistence/pet-allergy.repository';
import {
    RecordPetAllergy,
    PetNotFoundError,
    InvalidAllergenError,
    InvalidAllergyCategoryError,
    InvalidAllergySeverityError,
    InvalidAllergyNotesError,
    type RecordPetAllergyCommand,
} from './record-pet-allergy';

class FakePetAllergyRepository implements PetAllergyRepository {
    deleteIfPetWritable: PetAllergyRepository['deleteIfPetWritable'] = jest.fn();

    correctIfPetWritable: PetAllergyRepository['correctIfPetWritable'] = jest.fn();

    readonly allergies: PetAllergy[] = [];

    readonly requesterAccountIds: string[] = [];

    outcome: CreatePetAllergyOutcome = 'CREATED';

    failure: Error | undefined;

    createIfPetWritable(
        allergy: PetAllergy,
        authenticatedAccountId: string,
    ): Promise<CreatePetAllergyOutcome> {
        if (this.failure !== undefined) {
            return Promise.reject(this.failure);
        }

        this.allergies.push(allergy);
        this.requesterAccountIds.push(authenticatedAccountId);

        return Promise.resolve(this.outcome);
    }
}
function command(overrides: Partial<RecordPetAllergyCommand> = {}): RecordPetAllergyCommand {
    return {
        petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
        authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440000',
        allergen: '  Chicken  ',
        category: 'FOOD',
        severity: 'UNKNOWN',
        notes: '  Reported reaction.  ',
        ...overrides,
    };
}

describe('RecordPetAllergy', () => {
    it('persists the real aggregate and passes authorization separately from authorship', async () => {
        const repository: FakePetAllergyRepository = new FakePetAllergyRepository();
        const result = await new RecordPetAllergy(repository).execute(command());

        expect(result).toEqual({
            id: repository.allergies[0]?.id.value,
            petId: command().petId,
            allergen: 'Chicken',
            category: 'FOOD',
            severity: 'UNKNOWN',
            notes: 'Reported reaction.',
            recordedByAccountId: command().authenticatedAccountId,
        });
        expect(repository.requesterAccountIds).toEqual([command().authenticatedAccountId]);
        expect(repository.allergies[0]?.recordedByAccountId.value).toBe(
            command().authenticatedAccountId,
        );
    });
    it.each([undefined, null])(
        'returns null for absent notes %s',
        async (notes: undefined | null) => {
            const repository: FakePetAllergyRepository = new FakePetAllergyRepository();

            expect(
                (await new RecordPetAllergy(repository).execute(command({ notes }))).notes,
            ).toBeNull();
        },
    );
    it.each([
        [command({ allergen: '' }), InvalidAllergenError],
        [command({ allergen: 'x'.repeat(256) }), InvalidAllergenError],
        [command({ category: 'food' }), InvalidAllergyCategoryError],
        [command({ severity: 'critical' }), InvalidAllergySeverityError],
        [command({ notes: ' ' }), InvalidAllergyNotesError],
        [command({ notes: 'x'.repeat(2001) }), InvalidAllergyNotesError],
    ])('maps invalid domain input before persistence', async (input, errorClass) => {
        const repository: FakePetAllergyRepository = new FakePetAllergyRepository();

        await expect(new RecordPetAllergy(repository).execute(input)).rejects.toThrow(errorClass);
        expect(repository.allergies).toHaveLength(0);
    });
    it('translates inaccessible pets', async () => {
        const repository: FakePetAllergyRepository = new FakePetAllergyRepository();

        repository.outcome = 'PET_NOT_FOUND';
        await expect(new RecordPetAllergy(repository).execute(command())).rejects.toThrow(
            PetNotFoundError,
        );
    });
    it('propagates unexpected repository failures unchanged', async () => {
        const repository: FakePetAllergyRepository = new FakePetAllergyRepository();
        const failure: Error = new Error('Database failure');

        repository.failure = failure;
        await expect(new RecordPetAllergy(repository).execute(command())).rejects.toBe(failure);
    });
});
