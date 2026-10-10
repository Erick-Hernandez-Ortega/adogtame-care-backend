import type {
    PetMedicalConditionAccess,
    PetMedicalConditionRepository,
} from '../persistence/pet-medical-condition.repository';
import { PetNotFoundError } from '../record-pet-medical-condition/record-pet-medical-condition';
import { PetMedicalConditionNotFoundError } from '../update-pet-medical-condition/update-pet-medical-condition';
import { DeletePetMedicalCondition } from './delete-pet-medical-condition';

const command: PetMedicalConditionAccess = {
    petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
    conditionId: '6fe44a29-206e-4875-9f3e-72026868135e',
    authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440000',
};

function setup() {
    const deleteIfPetWritable = jest
        .fn<
            ReturnType<PetMedicalConditionRepository['deleteIfPetWritable']>,
            Parameters<PetMedicalConditionRepository['deleteIfPetWritable']>
        >()
        .mockResolvedValue('DELETED');
    const repository: PetMedicalConditionRepository = {
        createIfPetWritable: jest.fn(),
        resolveIfPetWritable: jest.fn(),
        reopenIfPetWritable: jest.fn(),
        correctIfPetWritable: jest.fn(),
        deleteIfPetWritable,
    };

    return { useCase: new DeletePetMedicalCondition(repository), deleteIfPetWritable };
}

describe('DeletePetMedicalCondition', () => {
    it('completes deletion without a representation', async () => {
        const { useCase, deleteIfPetWritable } = setup();

        await expect(useCase.execute(command)).resolves.toBeUndefined();
        expect(deleteIfPetWritable).toHaveBeenCalledTimes(1);
        expect(deleteIfPetWritable).toHaveBeenCalledWith(command);
    });

    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['PET_MEDICAL_CONDITION_NOT_FOUND', PetMedicalConditionNotFoundError],
    ] as const)('maps %s', async (outcome, errorClass) => {
        const { useCase, deleteIfPetWritable } = setup();

        deleteIfPetWritable.mockResolvedValue(outcome);
        await expect(useCase.execute(command)).rejects.toThrow(errorClass);
        expect(deleteIfPetWritable).toHaveBeenCalledTimes(1);
        expect(deleteIfPetWritable).toHaveBeenCalledWith(command);
    });

    it('propagates unexpected persistence failure unchanged', async () => {
        const { useCase, deleteIfPetWritable } = setup();
        const failure: Error = new Error('Unexpected persistence failure');

        deleteIfPetWritable.mockRejectedValue(failure);
        await expect(useCase.execute(command)).rejects.toBe(failure);
        expect(deleteIfPetWritable).toHaveBeenCalledTimes(1);
        expect(deleteIfPetWritable).toHaveBeenCalledWith(command);
    });
});
