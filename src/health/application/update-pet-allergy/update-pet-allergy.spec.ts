import { Allergen } from '../../domain/allergen/allergen';
import {
  PetAllergy,
  PetId,
  RecordedByAccountId,
} from '../../domain/pet-allergy/pet-allergy';
import type {
  PetAllergyRepository,
  UpdatePetAllergyOutcome,
} from '../persistence/pet-allergy.repository';
import {
  InvalidAllergenError,
  InvalidAllergyCategoryError,
  InvalidAllergySeverityError,
  InvalidAllergyNotesError,
  PetNotFoundError,
} from '../record-pet-allergy/record-pet-allergy';
import {
  UpdatePetAllergy,
  PetAllergyNotFoundError,
  type UpdatePetAllergyCommand,
} from './update-pet-allergy';

const petId: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const originalAccountId: string = '550e8400-e29b-41d4-a716-446655440000';
const requesterAccountId: string = '9b4a221a-e6ad-41ab-b1b2-21230b8b65a4';
function setup(outcome?: UpdatePetAllergyOutcome) {
  const allergy: PetAllergy = PetAllergy.create({
    petId: PetId.from(petId),
    allergen: Allergen.from('Chicken'),
    category: 'FOOD',
    severity: 'UNKNOWN',
    recordedByAccountId: RecordedByAccountId.from(originalAccountId),
  });
  const correctIfPetWritable = jest
    .fn<
      ReturnType<PetAllergyRepository['correctIfPetWritable']>,
      Parameters<PetAllergyRepository['correctIfPetWritable']>
    >()
    .mockImplementation((correction) => {
      if (outcome !== undefined) return Promise.resolve(outcome);
      const corrected: PetAllergy = allergy.correct(correction);
      return Promise.resolve({
        status: corrected === allergy ? 'UNCHANGED' : 'UPDATED',
        allergy: corrected,
      });
    });
  const repository: PetAllergyRepository = {
    createIfPetWritable: jest.fn(),
    correctIfPetWritable,
  };
  const command: UpdatePetAllergyCommand = {
    petId,
    allergyId: allergy.id.value,
    authenticatedAccountId: requesterAccountId,
    allergen: '  Penicillin  ',
  };
  return {
    useCase: new UpdatePetAllergy(repository),
    correctIfPetWritable,
    allergy,
    command,
  };
}
describe('UpdatePetAllergy', () => {
  it.each(['UPDATED', 'UNCHANGED'] as const)(
    'maps %s to the full representation with original author',
    async (status) => {
      const initial = setup();
      const { useCase } = setup({ status, allergy: initial.allergy });
      await expect(useCase.execute(initial.command)).resolves.toEqual({
        id: initial.allergy.id.value,
        petId,
        allergen: 'Chicken',
        category: 'FOOD',
        severity: 'UNKNOWN',
        notes: null,
        recordedByAccountId: originalAccountId,
      });
    },
  );
  it('passes unnormalized correction to persistence and returns the corrected aggregate', async () => {
    const { useCase, command, correctIfPetWritable } = setup();
    const result = await useCase.execute({
      ...command,
      notes: '  Observed reaction  ',
    });
    expect(result).toEqual({
      id: command.allergyId,
      petId,
      allergen: 'Penicillin',
      category: 'FOOD',
      severity: 'UNKNOWN',
      notes: 'Observed reaction',
      recordedByAccountId: originalAccountId,
    });
    expect(correctIfPetWritable).toHaveBeenCalledWith({
      ...command,
      notes: '  Observed reaction  ',
    });
  });
  it.each([
    [{ allergen: '' }, InvalidAllergenError],
    [{ category: 'invalid' }, InvalidAllergyCategoryError],
    [{ severity: 'invalid' }, InvalidAllergySeverityError],
    [{ notes: '' }, InvalidAllergyNotesError],
  ])(
    'maps domain errors raised during persistence %j',
    async (patch, errorClass) => {
      const { useCase, command, correctIfPetWritable } = setup();
      await expect(useCase.execute({ ...command, ...patch })).rejects.toThrow(
        errorClass,
      );
      expect(correctIfPetWritable).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ['PET_NOT_FOUND', PetNotFoundError],
    ['PET_ALLERGY_NOT_FOUND', PetAllergyNotFoundError],
  ] as const)(
    'maps %s before validating semantic values',
    async (status, errorClass) => {
      const { useCase, command, correctIfPetWritable } = setup({ status });
      await expect(
        useCase.execute({ ...command, allergen: '', category: 'invalid' }),
      ).rejects.toThrow(errorClass);
      expect(correctIfPetWritable).toHaveBeenCalledTimes(1);
    },
  );
  it('propagates unexpected persistence failures unchanged', async () => {
    const { useCase, command, correctIfPetWritable } = setup();
    const failure: TypeError = new TypeError('Unexpected persistence failure');
    correctIfPetWritable.mockRejectedValue(failure);
    await expect(useCase.execute(command)).rejects.toBe(failure);
  });
});
