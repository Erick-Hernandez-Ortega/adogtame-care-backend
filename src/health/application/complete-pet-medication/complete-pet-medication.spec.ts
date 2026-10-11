import {
    CompletePetMedication,
    InvalidMedicationEndedDateError,
    InvalidMedicationDiscontinuationReasonError,
    PetMedicationLifecycleConflictError,
} from './complete-pet-medication';
import { DiscontinuePetMedication } from '../discontinue-pet-medication/discontinue-pet-medication';
import { ReopenPetMedication } from '../reopen-pet-medication/reopen-pet-medication';
import type {
    PetMedicationRepository,
    UpdatePetMedicationOutcome,
} from '../persistence/pet-medication.repository';
import {
    PetMedication,
    PetId,
    RecordedByAccountId,
    InvalidMedicationEndedDateValueError,
    InvalidMedicationDiscontinuationReasonValueError,
    MedicationLifecycleConflictError,
} from '../../domain/pet-medication/pet-medication';
import { PetNotFoundError } from '../record-pet-medication/record-pet-medication';
import {
    PetMedicationNotFoundError,
    UpdatePetMedication,
} from '../update-pet-medication/update-pet-medication';

function setup() {
    const medication: PetMedication = PetMedication.create({
        petId: PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440000'),
        name: 'Amoxicillin',
    });
    const command = {
        petId: medication.petId.value,
        medicationId: medication.id.value,
        authenticatedAccountId: '9b4a221a-e6ad-41ab-b1b2-21230b8b65a4',
        endedDate: '2026-10-10',
    };
    const now = jest.fn<Date, []>(() => new Date('2026-10-11T00:00:00Z'));
    const completeIfPetWritable = jest
        .fn<
            ReturnType<PetMedicationRepository['completeIfPetWritable']>,
            Parameters<PetMedicationRepository['completeIfPetWritable']>
        >()
        .mockImplementation((closure): Promise<UpdatePetMedicationOutcome> =>
            Promise.resolve({
                status: 'UPDATED',
                medication: medication.complete(closure, closure.getToday),
            }),
        );
    const discontinueIfPetWritable = jest
        .fn<
            ReturnType<PetMedicationRepository['discontinueIfPetWritable']>,
            Parameters<PetMedicationRepository['discontinueIfPetWritable']>
        >()
        .mockImplementation((closure): Promise<UpdatePetMedicationOutcome> =>
            Promise.resolve({
                status: 'UPDATED',
                medication: medication.discontinue(closure, closure.getToday),
            }),
        );
    const reopenIfPetWritable = jest
        .fn<
            ReturnType<PetMedicationRepository['reopenIfPetWritable']>,
            Parameters<PetMedicationRepository['reopenIfPetWritable']>
        >()
        .mockResolvedValue({ status: 'UPDATED', medication });
    const correctIfPetWritable = jest
        .fn<
            ReturnType<PetMedicationRepository['correctIfPetWritable']>,
            Parameters<PetMedicationRepository['correctIfPetWritable']>
        >()
        .mockResolvedValue({ status: 'UPDATED', medication });
    const repository: PetMedicationRepository = {
        createIfPetWritable: jest.fn(),
        deleteIfPetWritable: jest.fn(),
        correctIfPetWritable,
        completeIfPetWritable,
        discontinueIfPetWritable,
        reopenIfPetWritable,
    };

    return {
        command,
        medication,
        now,
        completeIfPetWritable,
        discontinueIfPetWritable,
        reopenIfPetWritable,
        correctIfPetWritable,
        complete: new CompletePetMedication(repository, { now }),
        discontinue: new DiscontinuePetMedication(repository, { now }),
        reopen: new ReopenPetMedication(repository),
        update: new UpdatePetMedication(repository, { now }),
    };
}

describe('Medication lifecycle use cases', () => {
    it('delegates closure and projects the real aggregate with original authorship', async () => {
        const { command, medication, now, complete, completeIfPetWritable } = setup();

        await expect(complete.execute(command)).resolves.toMatchObject({
            id: medication.id.value,
            petId: command.petId,
            recordedByAccountId: medication.recordedByAccountId.value,
            status: 'COMPLETED',
            endedDate: command.endedDate,
            discontinuationReason: null,
        });
        expect(completeIfPetWritable.mock.calls[0][0]).toMatchObject(command);
        expect(typeof completeIfPetWritable.mock.calls[0][0].getToday).toBe('function');
        expect(now).toHaveBeenCalledTimes(1);
    });

    it('projects normalized reasons and never supplies an implicit event date', async () => {
        const { command, now, discontinue } = setup();

        await expect(
            discontinue.execute({
                ...command,
                endedDate: null,
                discontinuationReason: ' Withdrawn ',
            }),
        ).resolves.toMatchObject({
            status: 'DISCONTINUED',
            endedDate: null,
            discontinuationReason: 'Withdrawn',
        });
        expect(now).not.toHaveBeenCalled();
    });

    it('reopens through its authorized persistence contract without time', async () => {
        const { command, reopen, reopenIfPetWritable, now } = setup();
        const { endedDate: omittedDate, ...access } = command;

        expect(omittedDate).toBe('2026-10-10');
        await expect(reopen.execute(access)).resolves.toMatchObject({
            status: 'OPEN',
            endedDate: null,
            discontinuationReason: null,
        });
        expect(reopenIfPetWritable).toHaveBeenCalledWith(access);
        expect(now).not.toHaveBeenCalled();
    });

    it.each(['PET_NOT_FOUND', 'PET_MEDICATION_NOT_FOUND'] as const)(
        'maps %s before sampling time',
        async (status) => {
            const {
                command,
                complete,
                discontinue,
                reopen,
                completeIfPetWritable,
                discontinueIfPetWritable,
                reopenIfPetWritable,
                now,
            } = setup();
            const ErrorClass =
                status === 'PET_NOT_FOUND' ? PetNotFoundError : PetMedicationNotFoundError;

            completeIfPetWritable.mockResolvedValue({ status });
            discontinueIfPetWritable.mockResolvedValue({ status });
            reopenIfPetWritable.mockResolvedValue({ status });
            await expect(complete.execute(command)).rejects.toThrow(ErrorClass);
            await expect(discontinue.execute(command)).rejects.toThrow(ErrorClass);
            await expect(reopen.execute(command)).rejects.toThrow(ErrorClass);
            expect(now).not.toHaveBeenCalled();
        },
    );

    it.each([
        [
            new InvalidMedicationEndedDateValueError(new RangeError('Invalid ending')),
            InvalidMedicationEndedDateError,
        ],
        [
            new InvalidMedicationDiscontinuationReasonValueError(new TypeError('Invalid reason')),
            InvalidMedicationDiscontinuationReasonError,
        ],
        [new MedicationLifecycleConflictError(), PetMedicationLifecycleConflictError],
    ] as const)('maps lifecycle domain failures', async (failure, ErrorClass) => {
        const {
            command,
            complete,
            discontinue,
            update,
            completeIfPetWritable,
            discontinueIfPetWritable,
            correctIfPetWritable,
        } = setup();

        completeIfPetWritable.mockRejectedValue(failure);
        discontinueIfPetWritable.mockRejectedValue(failure);
        correctIfPetWritable.mockRejectedValue(failure);
        await expect(complete.execute(command)).rejects.toThrow(ErrorClass);
        await expect(discontinue.execute(command)).rejects.toThrow(ErrorClass);
        await expect(update.execute(command)).rejects.toThrow(ErrorClass);
    });

    it('propagates unexpected persistence failures unchanged', async () => {
        const { command, complete, completeIfPetWritable } = setup();
        const failure: Error = new Error('Database unavailable');

        completeIfPetWritable.mockRejectedValue(failure);
        await expect(complete.execute(command)).rejects.toBe(failure);
    });
});
