import { MedicalConditionName } from '../../domain/medical-condition-name/medical-condition-name';
import { DiagnosedDate } from '../../domain/diagnosed-date/diagnosed-date';
import {
    PetMedicalCondition,
    PetMedicalConditionId,
    PetId,
    RecordedByAccountId,
} from '../../domain/pet-medical-condition/pet-medical-condition';
import type { PetMedicalConditionRepository } from '../persistence/pet-medical-condition.repository';
import { PetNotFoundError } from '../record-pet-medical-condition/record-pet-medical-condition';
import { PetMedicalConditionNotFoundError } from '../update-pet-medical-condition/update-pet-medical-condition';
import {
    ReopenPetMedicalCondition,
    type ReopenPetMedicalConditionCommand,
} from './reopen-pet-medical-condition';

const command: ReopenPetMedicalConditionCommand = {
    petId: '550e8400-e29b-41d4-a716-446655440001',
    conditionId: '550e8400-e29b-41d4-a716-446655440002',
    authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440003',
};

function setup() {
    const condition: PetMedicalCondition = PetMedicalCondition.reconstitute({
        id: PetMedicalConditionId.from(command.conditionId),
        petId: PetId.from(command.petId),
        name: MedicalConditionName.from('Epilepsy'),
        diagnosedDate: DiagnosedDate.reconstitute('2026-02-10'),
        notes: 'Clinical notes',
        status: 'ACTIVE',
        resolvedDate: null,
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440004'),
    });
    const reopenIfPetWritable = jest.fn<
        ReturnType<PetMedicalConditionRepository['reopenIfPetWritable']>,
        Parameters<PetMedicalConditionRepository['reopenIfPetWritable']>
    >();
    const repository: PetMedicalConditionRepository = {
        reopenIfPetWritable,
        createIfPetWritable: jest.fn(),
        correctIfPetWritable: jest.fn(),
        resolveIfPetWritable: jest.fn(),
    };

    return { useCase: new ReopenPetMedicalCondition(repository), reopenIfPetWritable, condition };
}

describe('ReopenPetMedicalCondition', () => {
    it.each(['REOPENED', 'UNCHANGED'] as const)(
        'projects %s completely for a requester other than the author without Clock',
        async (status) => {
            const { useCase, reopenIfPetWritable, condition } = setup();

            reopenIfPetWritable.mockResolvedValueOnce({ status, condition });
            expect(await useCase.execute(command)).toEqual({
                id: command.conditionId,
                petId: command.petId,
                name: 'Epilepsy',
                status: 'ACTIVE',
                diagnosedDate: '2026-02-10',
                resolvedDate: null,
                notes: 'Clinical notes',
                recordedByAccountId: condition.recordedByAccountId.value,
            });
            expect(reopenIfPetWritable).toHaveBeenCalledTimes(1);
            expect(reopenIfPetWritable.mock.calls[0][0]).toEqual(command);
            expect(reopenIfPetWritable.mock.calls[0][0]).not.toHaveProperty('getToday');
        },
    );

    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['PET_MEDICAL_CONDITION_NOT_FOUND', PetMedicalConditionNotFoundError],
    ] as const)('maps %s', async (status, errorClass) => {
        const { useCase, reopenIfPetWritable } = setup();

        reopenIfPetWritable.mockResolvedValueOnce({ status });
        await expect(useCase.execute(command)).rejects.toThrow(errorClass);
    });

    it('propagates unexpected repository failures', async () => {
        const { useCase, reopenIfPetWritable } = setup();
        const failure: Error = new Error('Unexpected failure');

        reopenIfPetWritable.mockRejectedValueOnce(failure);
        await expect(useCase.execute(command)).rejects.toBe(failure);
    });
});
