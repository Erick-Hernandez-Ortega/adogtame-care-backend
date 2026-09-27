import { AccountId } from '../../domain/pet-membership/pet-membership';
import {
  InvitationId,
  InvitedEmail,
  PetInvitation,
  PetInvitationStatus,
} from '../../domain/pet-invitation/pet-invitation';
import { PetId } from '../../domain/pet/pet';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
  CancelInvitationPersistenceResult,
  PetInvitationRepository,
} from '../persistence/pet-invitation.repository';
import {
  CancelInvitation,
  CancelInvitationExpiredError,
  CancelInvitationNotFoundError,
  CancelInvitationNotPendingError,
  decideCancellation,
} from './cancel-invitation';

const INVITATION_ID = '6fe44a29-206e-4875-9f3e-72026868135e';
const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const NOW = new Date('2026-09-27T12:30:00.000Z');

function invitation(
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED',
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

describe('decideCancellation', () => {
  it('cancels a pending invitation', () => {
    const pending = invitation('PENDING');
    expect(decideCancellation(pending, NOW)).toEqual({
      outcome: 'CANCELLED',
      invitationToSave: pending,
    });
    expect(pending.status).toBe(PetInvitationStatus.CANCELLED);
  });

  it('returns a successful retry without saving', () => {
    expect(decideCancellation(invitation('CANCELLED'), NOW)).toEqual({
      outcome: 'CANCELLED',
      invitationToSave: null,
    });
  });

  it('persists a due expiration', () => {
    const pending = invitation('PENDING', '2026-09-20T12:30:00.000Z');
    expect(decideCancellation(pending, NOW)).toEqual({
      outcome: 'EXPIRED',
      invitationToSave: pending,
    });
    expect(pending.status).toBe(PetInvitationStatus.EXPIRED);
  });

  it('does not rewrite an expired invitation', () => {
    expect(decideCancellation(invitation('EXPIRED'), NOW)).toEqual({
      outcome: 'EXPIRED',
      invitationToSave: null,
    });
  });

  it.each([PetInvitationStatus.ACCEPTED, PetInvitationStatus.REJECTED])(
    'rejects a %s invitation',
    (status) => {
      expect(decideCancellation(invitation(status), NOW)).toEqual({
        outcome: 'NOT_PENDING',
        invitationToSave: null,
      });
    },
  );
});

describe('CancelInvitation', () => {
  function setup(
    result: CancelInvitationPersistenceResult = {
      outcome: 'CANCELLED',
      id: INVITATION_ID,
      petId: PET_ID,
    },
  ) {
    const cancel = jest
      .fn<Promise<CancelInvitationPersistenceResult>, [string, string]>()
      .mockResolvedValue(result);
    const repository: PetInvitationRepository = {
      findPending: jest.fn() as PetInvitationRepository['findPending'],
      createPending: jest.fn() as PetInvitationRepository['createPending'],
      accept: jest.fn() as PetInvitationRepository['accept'],
      reject: jest.fn() as PetInvitationRepository['reject'],
      cancel,
    };
    return { useCase: new CancelInvitation(repository), cancel };
  }

  it('passes the authenticated account ID and returns cancellation', async () => {
    const { useCase, cancel } = setup();
    await expect(useCase.execute(INVITATION_ID, ACCOUNT_ID)).resolves.toEqual({
      id: INVITATION_ID,
      petId: PET_ID,
      status: 'CANCELLED',
    });
    expect(cancel).toHaveBeenCalledWith(INVITATION_ID, ACCOUNT_ID);
  });

  it.each([
    [{ outcome: 'NOT_FOUND' } as const, CancelInvitationNotFoundError],
    [{ outcome: 'PET_NOT_FOUND' } as const, PetNotFoundError],
    [{ outcome: 'EXPIRED' } as const, CancelInvitationExpiredError],
    [{ outcome: 'NOT_PENDING' } as const, CancelInvitationNotPendingError],
  ])('maps %s to its application error', async (result, errorClass) => {
    await expect(
      setup(result).useCase.execute(INVITATION_ID, ACCOUNT_ID),
    ).rejects.toThrow(errorClass);
  });

  it('propagates unexpected repository errors', async () => {
    const { useCase, cancel } = setup();
    cancel.mockRejectedValue(new Error('database failure'));
    await expect(useCase.execute(INVITATION_ID, ACCOUNT_ID)).rejects.toThrow(
      'database failure',
    );
  });
});
