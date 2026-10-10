import { MedicalConditionName } from '../../domain/medical-condition-name/medical-condition-name';
import {
  PetMedicalCondition,
  PetMedicalConditionId,
  PetId,
  RecordedByAccountId,
} from '../../domain/pet-medical-condition/pet-medical-condition';
import type { PetMedicalConditionRepository } from '../persistence/pet-medical-condition.repository';
import {
  InvalidMedicalConditionNameError,
  InvalidMedicalConditionDiagnosedDateError,
  InvalidMedicalConditionNotesError,
  PetNotFoundError,
} from '../record-pet-medical-condition/record-pet-medical-condition';
import {
  UpdatePetMedicalCondition,
  PetMedicalConditionNotFoundError,
  type UpdatePetMedicalConditionCommand,
} from './update-pet-medical-condition';

const command: UpdatePetMedicalConditionCommand = {
  petId: '550e8400-e29b-41d4-a716-446655440001',
  conditionId: '550e8400-e29b-41d4-a716-446655440002',
  authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440003',
  name: ' Osteoarthritis ',
};
function setup(status: string = 'ACTIVE') {
  const condition: PetMedicalCondition = PetMedicalCondition.reconstitute({
    id: PetMedicalConditionId.from(command.conditionId),
    petId: PetId.from(command.petId),
    name: MedicalConditionName.from('Arthritis'),
    status,
    recordedByAccountId: RecordedByAccountId.from(
      '550e8400-e29b-41d4-a716-446655440004',
    ),
  });
  const correctIfPetWritable = jest
    .fn<
      ReturnType<PetMedicalConditionRepository['correctIfPetWritable']>,
      Parameters<PetMedicalConditionRepository['correctIfPetWritable']>
    >()
    .mockImplementation(
      (
        correction,
      ): ReturnType<PetMedicalConditionRepository['correctIfPetWritable']> => {
        const corrected: PetMedicalCondition = condition.correct(
          correction,
          correction.getToday(),
        );
        return Promise.resolve({
          status: corrected === condition ? 'UNCHANGED' : 'UPDATED',
          condition: corrected,
        });
      },
    );
  const repository: PetMedicalConditionRepository = {
    createIfPetWritable: jest.fn(),
    correctIfPetWritable,
  };
  const now = jest.fn((): Date => new Date('2026-03-13T18:30:00-06:00'));
  return {
    useCase: new UpdatePetMedicalCondition(repository, { now }),
    correctIfPetWritable,
    now,
    condition,
  };
}
describe('UpdatePetMedicalCondition', () => {
  it.each(['ACTIVE', 'RESOLVED'])(
    'returns complete UPDATED %s information preserving another author',
    async (status: string) => {
      const { useCase, now, condition } = setup(status);
      expect(await useCase.execute(command)).toEqual({
        id: command.conditionId,
        petId: command.petId,
        name: 'Osteoarthritis',
        status,
        diagnosedDate: null,
        notes: null,
        recordedByAccountId: condition.recordedByAccountId.value,
      });
      expect(now).toHaveBeenCalledTimes(1);
    },
  );
  it('returns UNCHANGED and passes raw values and deferred UTC Clock to persistence', async () => {
    const { useCase, correctIfPetWritable, now } = setup();
    expect(
      await useCase.execute({ ...command, name: ' Arthritis ' }),
    ).toMatchObject({ name: 'Arthritis' });
    expect(correctIfPetWritable.mock.calls[0]?.[0]).toMatchObject({
      name: ' Arthritis ',
      authenticatedAccountId: command.authenticatedAccountId,
    });
    expect(now).toHaveBeenCalledTimes(1);
    correctIfPetWritable.mockImplementationOnce(
      (
        correction,
      ): ReturnType<PetMedicalConditionRepository['correctIfPetWritable']> => {
        expect(now).toHaveBeenCalledTimes(1);
        expect(correction.getToday()).toBe('2026-03-14');
        return Promise.resolve({ status: 'PET_NOT_FOUND' });
      },
    );
    await expect(useCase.execute(command)).rejects.toThrow(PetNotFoundError);
  });
  it.each([
    ['PET_NOT_FOUND', PetNotFoundError],
    ['PET_MEDICAL_CONDITION_NOT_FOUND', PetMedicalConditionNotFoundError],
  ] as const)(
    'maps %s without consulting Clock or validating the patch',
    async (status, errorClass) => {
      const { useCase, correctIfPetWritable, now } = setup();
      correctIfPetWritable.mockResolvedValueOnce({ status });
      await expect(useCase.execute({ ...command, name: '' })).rejects.toThrow(
        errorClass,
      );
      expect(now).not.toHaveBeenCalled();
    },
  );
  it.each([
    [{ name: '' }, InvalidMedicalConditionNameError],
    [
      { diagnosedDate: '2026-03-15' },
      InvalidMedicalConditionDiagnosedDateError,
    ],
    [{ notes: ' ' }, InvalidMedicalConditionNotesError],
  ])('maps Domain errors for %j', async (patch, errorClass) => {
    await expect(
      setup().useCase.execute({ ...command, ...patch }),
    ).rejects.toThrow(errorClass);
  });
  it('propagates unexpected repository and Clock failures', async () => {
    const { useCase, correctIfPetWritable, now } = setup();
    const failure: Error = new Error('Unexpected failure');
    correctIfPetWritable.mockRejectedValueOnce(failure);
    await expect(useCase.execute(command)).rejects.toBe(failure);
    now.mockImplementationOnce((): Date => {
      throw failure;
    });
    await expect(useCase.execute(command)).rejects.toBe(failure);
  });
});
