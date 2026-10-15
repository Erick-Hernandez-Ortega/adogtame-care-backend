import {
    CompleteCareActivity,
    InvalidActivityCompletedAtError,
    InvalidActivityNotesError,
    InvalidActivityTimezoneError,
    PetNotFoundError,
    CareRoutineNotFoundError,
    type CompleteCareActivityCommand,
} from './complete-care-activity';
import type {
    CareActivityRepository,
    CreateCareActivityOutcome,
} from '../persistence/care-activity.repository';
import type { CareActivity } from '../../domain/care-activity/care-activity';

const accountId: string = '10000000-0000-4000-8000-000000000001';
const command: CompleteCareActivityCommand = {
    petId: accountId,
    routineId: accountId,
    authenticatedAccountId: accountId,
    completedAt: '2026-10-15T01:00:00Z',
    timezone: 'Etc/UTC',
    notes: '  Done  ',
};

function fixture(outcome: CreateCareActivityOutcome = 'CREATED') {
    const createIfPetWritable = jest
        .fn<Promise<CreateCareActivityOutcome>, [CareActivity, string]>()
        .mockResolvedValue(outcome);
    const repository: CareActivityRepository = { createIfPetWritable };
    const now = jest.fn<Date, []>().mockReturnValue(new Date('2026-10-15T01:00:00Z'));

    return { useCase: new CompleteCareActivity(repository, { now }), createIfPetWritable, now };
}

describe('CompleteCareActivity', () => {
    it('uses one clock sample, the authenticated recorder, and projects normalized domain facts', async () => {
        const { useCase, createIfPetWritable, now } = fixture();
        const result = await useCase.execute(command);

        expect(result).toEqual({
            id: expect.any(String) as string,
            petId: accountId,
            routineId: accountId,
            completedBy: accountId,
            completedAt: '2026-10-15T01:00:00.000Z',
            timezone: 'UTC',
            notes: 'Done',
        });
        expect(now).toHaveBeenCalledTimes(1);
        expect(createIfPetWritable).toHaveBeenCalledWith(
            expect.objectContaining({ localDay: '2026-10-15' }),
            accountId,
        );
    });

    it.each([undefined, null])('normalizes absent notes %s', async (notes: undefined | null) => {
        expect((await fixture().useCase.execute({ ...command, notes })).notes).toBeNull();
    });

    it.each([
        [{ completedAt: '2026-10-15T01:00:00.001Z' }, InvalidActivityCompletedAtError],
        [{ completedAt: 'bad' }, InvalidActivityCompletedAtError],
        [{ timezone: 'Mars/Olympus' }, InvalidActivityTimezoneError],
        [{ notes: ' ' }, InvalidActivityNotesError],
    ] as const)('maps invalid domain facts before persistence', async (overrides, errorClass) => {
        const { useCase, createIfPetWritable } = fixture();

        await expect(useCase.execute({ ...command, ...overrides })).rejects.toThrow(errorClass);
        expect(createIfPetWritable).not.toHaveBeenCalled();
    });

    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['CARE_ROUTINE_NOT_FOUND', CareRoutineNotFoundError],
    ] as const)('maps %s', async (outcome, errorClass) => {
        await expect(fixture(outcome).useCase.execute(command)).rejects.toThrow(errorClass);
    });

    it('propagates unexpected clock failures without calling persistence', async () => {
        const { useCase, createIfPetWritable, now } = fixture();
        const failure: TypeError = new TypeError('clock unavailable');

        now.mockImplementation((): Date => {
            throw failure;
        });
        await expect(useCase.execute(command)).rejects.toBe(failure);
        expect(createIfPetWritable).not.toHaveBeenCalled();
    });

    it('propagates unexpected repository failures', async () => {
        const { useCase, createIfPetWritable } = fixture();
        const failure: Error = new Error('database unavailable');

        createIfPetWritable.mockRejectedValue(failure);
        await expect(useCase.execute(command)).rejects.toBe(failure);
    });
});
