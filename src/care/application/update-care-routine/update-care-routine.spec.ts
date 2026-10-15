import { RoutineFrequency } from '../../domain/routine-frequency/routine-frequency';
import { RoutineTimezone } from '../../domain/routine-timezone/routine-timezone';
import { RoutineTitle } from '../../domain/routine-title/routine-title';
import { CareRoutineType } from '../../domain/routine-type/routine-type';
import { CareRoutine, PetId, RecordedByAccountId } from '../../domain/care-routine/care-routine';

function input() {
    return {
        petId: PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12'),
        type: CareRoutineType.from('FEEDING'),
        title: RoutineTitle.from('Morning feeding'),
        frequency: RoutineFrequency.from({
            period: 'DAILY',
            timesPerPeriod: 2,
            suggestedTimes: ['08:00', '20:00'],
        }),
        timezone: RoutineTimezone.from('America/Mexico_City'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440000'),
    };
}

import { UpdateCareRoutine, CareRoutineNotFoundError } from './update-care-routine';
import {
    PetNotFoundError,
    InvalidRoutineTypeError,
    InvalidRoutineTitleError,
    InvalidRoutineInstructionsError,
    InvalidRoutineFrequencyError,
    InvalidRoutineTimezoneError,
} from '../create-care-routine/create-care-routine';
import type {
    CareRoutineRepository,
    CareRoutineCorrection,
} from '../persistence/care-routine.repository';

function setup() {
    const routine: CareRoutine = CareRoutine.create(input());
    const correctIfPetWritable = jest
        .fn<
            ReturnType<CareRoutineRepository['correctIfPetWritable']>,
            Parameters<CareRoutineRepository['correctIfPetWritable']>
        >()
        .mockImplementation((correction) =>
            Promise.resolve({ status: 'UPDATED', routine: routine.correct(correction) }),
        );
    const repository: CareRoutineRepository = {
        correctIfPetWritable,
        createIfPetWritable: jest.fn(),
    };
    const command: CareRoutineCorrection = {
        petId: routine.petId.value,
        routineId: routine.id.value,
        authenticatedAccountId: routine.recordedByAccountId.value,
        title: ' Updated ',
    };

    return { routine, command, correctIfPetWritable, useCase: new UpdateCareRoutine(repository) };
}

describe('UpdateCareRoutine', () => {
    it('delegates raw values and projects the complete normalized aggregate', async () => {
        const { routine, command, correctIfPetWritable, useCase } = setup();
        const result = await useCase.execute(command);

        expect(correctIfPetWritable).toHaveBeenCalledWith(command);
        expect(result).toEqual({
            id: routine.id.value,
            petId: routine.petId.value,
            type: 'FEEDING',
            title: 'Updated',
            instructions: null,
            frequency: { ...routine.frequency },
            timezone: routine.timezone.value,
            recordedByAccountId: routine.recordedByAccountId.value,
        });
        correctIfPetWritable.mockResolvedValueOnce({ status: 'UNCHANGED', routine });
        expect((await useCase.execute(command)).title).toBe(routine.title.value);
    });

    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['CARE_ROUTINE_NOT_FOUND', CareRoutineNotFoundError],
    ] as const)('maps %s', async (status, errorClass) => {
        const { command, correctIfPetWritable, useCase } = setup();

        correctIfPetWritable.mockResolvedValueOnce({ status });
        await expect(useCase.execute(command)).rejects.toThrow(errorClass);
    });

    it.each([
        [{ type: 'INVALID' }, InvalidRoutineTypeError],
        [{ title: '' }, InvalidRoutineTitleError],
        [{ instructions: '' }, InvalidRoutineInstructionsError],
        [{ frequency: { period: 'DAILY', timesPerPeriod: 0 } }, InvalidRoutineFrequencyError],
        [{ timezone: '+01:00' }, InvalidRoutineTimezoneError],
    ] as const)('maps domain validation failures (%j)', async (fields, errorClass) => {
        const { command, useCase } = setup();

        await expect(useCase.execute({ ...command, ...fields })).rejects.toThrow(errorClass);
    });

    it('propagates unexpected failures', async () => {
        const { command, correctIfPetWritable, useCase } = setup();
        const failure: Error = new Error('Database unavailable');

        correctIfPetWritable.mockRejectedValueOnce(failure);
        await expect(useCase.execute(command)).rejects.toBe(failure);
    });
});
