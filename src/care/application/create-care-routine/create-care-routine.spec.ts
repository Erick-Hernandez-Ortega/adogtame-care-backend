import type { CareRoutineRepository } from '../persistence/care-routine.repository';
import { CareRoutine } from '../../domain/care-routine/care-routine';
import {
    CreateCareRoutine,
    type CreateCareRoutineCommand,
    InvalidRoutineTypeError,
    InvalidRoutineTitleError,
    InvalidRoutineInstructionsError,
    InvalidRoutineFrequencyError,
    InvalidRoutineTimezoneError,
    PetNotFoundError,
} from './create-care-routine';

function command(overrides: Partial<CreateCareRoutineCommand> = {}): CreateCareRoutineCommand {
    return {
        petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
        authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'FEEDING',
        title: '  Breakfast  ',
        instructions: '  One portion  ',
        frequency: { period: 'DAILY', timesPerPeriod: 1, suggestedTimes: ['08:00'] },
        timezone: 'Etc/UTC',
        ...overrides,
    };
}

function setup() {
    const createIfPetWritable = jest
        .fn<
            ReturnType<CareRoutineRepository['createIfPetWritable']>,
            Parameters<CareRoutineRepository['createIfPetWritable']>
        >()
        .mockResolvedValue('CREATED');
    const repository: CareRoutineRepository = {
        createIfPetWritable,
        correctIfPetWritable: jest.fn(),
    };

    return { useCase: new CreateCareRoutine(repository), createIfPetWritable };
}

describe('CreateCareRoutine', () => {
    it('persists a real aggregate and returns the exact normalized representation', async () => {
        const { useCase, createIfPetWritable } = setup();
        const result = await useCase.execute(command());
        const routine = createIfPetWritable.mock.calls[0]?.[0];

        expect(routine).toBeInstanceOf(CareRoutine);
        expect(createIfPetWritable).toHaveBeenCalledWith(routine, command().authenticatedAccountId);
        expect(result).toEqual({
            id: routine?.id.value,
            petId: command().petId,
            type: 'FEEDING',
            title: 'Breakfast',
            instructions: 'One portion',
            frequency: {
                period: 'DAILY',
                timesPerPeriod: 1,
                suggestedTimes: ['08:00'],
                weekdays: [],
            },
            timezone: 'UTC',
            recordedByAccountId: command().authenticatedAccountId,
        });
    });

    it.each([undefined, null])(
        'normalizes absent optional values %s',
        async (value: undefined | null) => {
            const { useCase } = setup();
            const result = await useCase.execute(
                command({
                    instructions: value,
                    frequency: {
                        period: 'WEEKLY',
                        timesPerPeriod: 3,
                        suggestedTimes: value,
                        weekdays: value,
                    },
                }),
            );

            expect(result.instructions).toBeNull();
            expect(result.frequency).toEqual({
                period: 'WEEKLY',
                timesPerPeriod: 3,
                suggestedTimes: [],
                weekdays: [],
            });
        },
    );

    it.each([
        [command({ type: 'MEDICATION' }), InvalidRoutineTypeError],
        [command({ title: ' ' }), InvalidRoutineTitleError],
        [command({ title: '🐕'.repeat(256) }), InvalidRoutineTitleError],
        [command({ instructions: '' }), InvalidRoutineInstructionsError],
        [command({ instructions: '🐕'.repeat(2001) }), InvalidRoutineInstructionsError],
        [
            command({ frequency: { period: 'MONTHLY', timesPerPeriod: 1 } }),
            InvalidRoutineFrequencyError,
        ],
        [
            command({ frequency: { period: 'DAILY', timesPerPeriod: 0 } }),
            InvalidRoutineFrequencyError,
        ],
        [
            command({ frequency: { period: 'DAILY', timesPerPeriod: 1, weekdays: ['MONDAY'] } }),
            InvalidRoutineFrequencyError,
        ],
        [
            command({
                frequency: { period: 'DAILY', timesPerPeriod: 1, suggestedTimes: ['24:00'] },
            }),
            InvalidRoutineFrequencyError,
        ],
        [command({ timezone: '+01:00' }), InvalidRoutineTimezoneError],
    ])('maps domain errors before persistence', async (input, errorClass) => {
        const { useCase, createIfPetWritable } = setup();

        await expect(useCase.execute(input)).rejects.toThrow(errorClass);
        expect(createIfPetWritable).not.toHaveBeenCalled();
    });

    it('maps inaccessible pets and propagates unexpected persistence failures', async () => {
        const { useCase, createIfPetWritable } = setup();

        createIfPetWritable.mockResolvedValueOnce('PET_NOT_FOUND');
        await expect(useCase.execute(command())).rejects.toThrow(PetNotFoundError);
        const failure: Error = new Error('Database failure');

        createIfPetWritable.mockRejectedValueOnce(failure);
        await expect(useCase.execute(command())).rejects.toBe(failure);
    });
});
