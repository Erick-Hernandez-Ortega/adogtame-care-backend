import { AccountId } from '../../domain/pet-membership/pet-membership';
import {
    InvitationId,
    InvitedEmail,
    PetInvitation,
    PetInvitationStatus,
} from '../../domain/pet-invitation/pet-invitation';
import { PetId } from '../../domain/pet/pet';
import type { AccountLookup } from '../identity/account-lookup';
import type {
    PetInvitationRepository,
    RejectInvitationPersistenceResult,
} from '../persistence/pet-invitation.repository';
import {
    decideRejection,
    RejectInvitation,
    RejectInvitationExpiredError,
    RejectInvitationNotFoundError,
    RejectInvitationNotPendingError,
} from './reject-invitation';

const INVITATION_ID = '6fe44a29-206e-4875-9f3e-72026868135e';
const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const NOW = new Date('2026-09-27T12:30:00.000Z');

function invitation(
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' = 'PENDING',
    createdAt = '2026-09-26T12:30:00.000Z',
): PetInvitation {
    return PetInvitation.reconstitute({
        id: InvitationId.from(INVITATION_ID),
        petId: PetId.from(PET_ID),
        invitedEmail: InvitedEmail.from('friend@example.com'),
        invitedByAccountId: AccountId.from(ACCOUNT_ID),
        status,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 604_800_000).toISOString(),
    });
}

describe('decideRejection', () => {
    it('rejects a pending invitation before its deadline', () => {
        const pending = invitation();

        expect(decideRejection(pending, NOW)).toEqual({
            outcome: 'REJECTED',
            invitationToSave: pending,
        });
        expect(pending.status).toBe(PetInvitationStatus.REJECTED);
    });

    it('returns a successful retry without a new transition', () => {
        expect(decideRejection(invitation('REJECTED'), NOW)).toEqual({
            outcome: 'REJECTED',
            invitationToSave: null,
        });
    });

    it('materializes a due pending invitation as expired', () => {
        const pending = invitation('PENDING', '2026-09-20T12:30:00.000Z');

        expect(decideRejection(pending, NOW)).toEqual({
            outcome: 'EXPIRED',
            invitationToSave: pending,
        });
        expect(pending.status).toBe(PetInvitationStatus.EXPIRED);
    });

    it('returns expired without rewriting a persisted expired invitation', () => {
        expect(decideRejection(invitation('EXPIRED'), NOW)).toEqual({
            outcome: 'EXPIRED',
            invitationToSave: null,
        });
    });

    it.each([PetInvitationStatus.ACCEPTED, PetInvitationStatus.CANCELLED])(
        'does not reject a %s invitation',
        (status) => {
            expect(decideRejection(invitation(status), NOW)).toEqual({
                outcome: 'NOT_PENDING',
                invitationToSave: null,
            });
        },
    );
});

describe('RejectInvitation', () => {
    function setup(
        result: RejectInvitationPersistenceResult = {
            outcome: 'REJECTED',
            id: INVITATION_ID,
            petId: PET_ID,
        },
        email: string | null = 'friend@example.com',
    ) {
        const reject = jest
            .fn<Promise<RejectInvitationPersistenceResult>, [string, string]>()
            .mockResolvedValue(result);
        const accountLookup: AccountLookup = {
            findEmailsByAccountIds: jest.fn().mockResolvedValue([]),
            findAccountIdByEmail: jest
                .fn()
                .mockResolvedValue(null) as AccountLookup['findAccountIdByEmail'],
            findEmailByAccountId: jest
                .fn()
                .mockResolvedValue(email) as AccountLookup['findEmailByAccountId'],
        };
        const repository: PetInvitationRepository = {
            findPending: jest
                .fn()
                .mockResolvedValue(null) as PetInvitationRepository['findPending'],
            createPending: jest
                .fn()
                .mockResolvedValue('CREATED') as PetInvitationRepository['createPending'],
            accept: jest.fn().mockResolvedValue({
                outcome: 'NOT_FOUND',
            }) as PetInvitationRepository['accept'],
            reject,
            cancel: jest.fn().mockResolvedValue({
                outcome: 'NOT_FOUND',
            }) as PetInvitationRepository['cancel'],
        };

        return { useCase: new RejectInvitation(accountLookup, repository), reject };
    }

    it('uses only the authenticated account ID and resolved email', async () => {
        const { useCase, reject } = setup();

        await expect(useCase.execute(INVITATION_ID, ACCOUNT_ID)).resolves.toEqual({
            id: INVITATION_ID,
            petId: PET_ID,
            status: 'REJECTED',
        });
        expect(reject).toHaveBeenCalledWith(INVITATION_ID, 'friend@example.com');
    });

    it('hides a missing account email and a missing or foreign invitation alike', async () => {
        const withoutEmail = setup(undefined, null);

        await expect(withoutEmail.useCase.execute(INVITATION_ID, ACCOUNT_ID)).rejects.toThrow(
            RejectInvitationNotFoundError,
        );
        expect(withoutEmail.reject).not.toHaveBeenCalled();
        await expect(
            setup({ outcome: 'NOT_FOUND' }).useCase.execute(INVITATION_ID, ACCOUNT_ID),
        ).rejects.toThrow(RejectInvitationNotFoundError);
    });

    it.each([
        [{ outcome: 'EXPIRED' } as const, RejectInvitationExpiredError],
        [{ outcome: 'NOT_PENDING' } as const, RejectInvitationNotPendingError],
    ])('maps %s to its application error', async (result, errorClass) => {
        await expect(setup(result).useCase.execute(INVITATION_ID, ACCOUNT_ID)).rejects.toThrow(
            errorClass,
        );
    });

    it('propagates unexpected persistence errors', async () => {
        const { useCase, reject } = setup();

        reject.mockRejectedValue(new Error('database failure'));
        await expect(useCase.execute(INVITATION_ID, ACCOUNT_ID)).rejects.toThrow(
            'database failure',
        );
    });
});
