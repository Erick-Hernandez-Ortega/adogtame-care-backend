import {
    PetMedication,
    PetId,
    RecordedByAccountId,
} from '../../domain/pet-medication/pet-medication';
import type {
    PetMedicationRepository,
    UpdatePetMedicationOutcome,
} from '../persistence/pet-medication.repository';
import {
    PetNotFoundError,
    InvalidMedicationNameError,
    InvalidMedicationDosageError,
    InvalidMedicationFrequencyError,
    InvalidMedicationStartDateError,
    InvalidMedicationPlannedEndDateError,
    InvalidMedicationNotesError,
} from '../record-pet-medication/record-pet-medication';
import {
    UpdatePetMedication,
    PetMedicationNotFoundError,
    type UpdatePetMedicationCommand,
} from './update-pet-medication';

function setup(outcome?: UpdatePetMedicationOutcome) {
    const medication: PetMedication = PetMedication.create({
        petId: PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440000'),
        name: 'Amoxicillin',
        dosage: '250 mg',
    });
    const correctIfPetWritable = jest
        .fn<
            ReturnType<PetMedicationRepository['correctIfPetWritable']>,
            Parameters<PetMedicationRepository['correctIfPetWritable']>
        >()
        .mockImplementation((correction) =>
            Promise.resolve(
                outcome ?? { status: 'UPDATED', medication: medication.correct(correction) },
            ),
        );
    const repository: PetMedicationRepository = {
        deleteIfPetWritable: jest.fn(),
        createIfPetWritable: jest.fn(),
        correctIfPetWritable,
    };
    const command: UpdatePetMedicationCommand = {
        petId: medication.petId.value,
        medicationId: medication.id.value,
        authenticatedAccountId: '9b4a221a-e6ad-41ab-b1b2-21230b8b65a4',
        name: ' Other drug ',
    };

    return {
        medication,
        command,
        correctIfPetWritable,
        useCase: new UpdatePetMedication(repository),
    };
}

describe('UpdatePetMedication', () => {
    it('passes raw partial commands and projects exactly the returned aggregate without Clock', async () => {
        const { command, medication, correctIfPetWritable, useCase } = setup();
        const correction = Object.freeze({ ...command, dosage: null, notes: ' Notes ' });

        await expect(useCase.execute(correction)).resolves.toEqual({
            id: medication.id.value,
            petId: command.petId,
            recordedByAccountId: medication.recordedByAccountId.value,
            name: 'Other drug',
            dosage: null,
            frequency: null,
            startDate: null,
            plannedEndDate: null,
            notes: 'Notes',
        });
        expect(correctIfPetWritable).toHaveBeenCalledTimes(1);
        expect(correctIfPetWritable).toHaveBeenCalledWith(correction);
        expect(correctIfPetWritable.mock.calls[0][0]).not.toHaveProperty('frequency');
        expect(correction.notes).toBe(' Notes ');
    });

    it('projects an equivalent correction using UPDATED', async () => {
        const { command, useCase } = setup();

        await expect(useCase.execute({ ...command, name: ' Amoxicillin ' })).resolves.toMatchObject(
            { name: 'Amoxicillin', dosage: '250 mg' },
        );
    });

    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['PET_MEDICATION_NOT_FOUND', PetMedicationNotFoundError],
    ] as const)('maps %s before semantic validation', async (status, ErrorClass) => {
        const { command, useCase } = setup({ status });

        await expect(useCase.execute({ ...command, startDate: 'bad', name: '' })).rejects.toThrow(
            ErrorClass,
        );
    });

    it.each([
        [{ name: '' }, InvalidMedicationNameError],
        [{ dosage: '' }, InvalidMedicationDosageError],
        [{ frequency: '' }, InvalidMedicationFrequencyError],
        [{ startDate: '2026-02-29' }, InvalidMedicationStartDateError],
        [{ plannedEndDate: 'bad' }, InvalidMedicationPlannedEndDateError],
        [
            { startDate: '2100-01-02', plannedEndDate: '2100-01-01' },
            InvalidMedicationPlannedEndDateError,
        ],
        [{ notes: '' }, InvalidMedicationNotesError],
    ] as const)('translates domain error for %j', async (patch, ErrorClass) => {
        const { command, useCase } = setup();

        await expect(useCase.execute({ ...command, ...patch })).rejects.toThrow(ErrorClass);
    });

    it.each([new Error('Database failed'), new TypeError('Invalid persisted data')])(
        'propagates unexpected error %s',
        async (failure) => {
            const { command, correctIfPetWritable, useCase } = setup();

            correctIfPetWritable.mockRejectedValue(failure);
            await expect(useCase.execute(command)).rejects.toBe(failure);
        },
    );
});
