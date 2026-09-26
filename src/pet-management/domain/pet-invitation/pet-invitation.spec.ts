import { AccountId } from '../pet-membership/pet-membership';
import { PetId } from '../pet/pet';
import {
  InvitationId,
  InvitedEmail,
  PetInvitation,
  PetInvitationStatus,
} from './pet-invitation';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';
const CREATED_AT: Date = new Date('2026-09-26T12:30:00.000Z');

function createInvitation(): PetInvitation {
  return PetInvitation.create({
    petId: PetId.from(PET_ID),
    invitedEmail: InvitedEmail.from('  Ana@Example.COM  '),
    invitedByAccountId: AccountId.from(ACCOUNT_ID),
    createdAt: CREATED_AT,
  });
}

describe('InvitedEmail', () => {
  it('normalizes casing and exterior whitespace', () => {
    expect(InvitedEmail.from('  Ana@Example.COM  ').value).toBe(
      'ana@example.com',
    );
    expect(InvitedEmail.from('account@localhost').value).toBe(
      'account@localhost',
    );
  });

  it.each(['', '   ', 'invalid', 'ana@@example.com', 'ana @example.com'])(
    'rejects an invalid email: %s',
    (value: string) => {
      expect(() => InvitedEmail.from(value)).toThrow(TypeError);
    },
  );
});

describe('PetInvitation', () => {
  it('creates a pending invitation with persistent identity and seven-day duration', () => {
    const invitation: PetInvitation = createInvitation();

    expect(InvitationId.from(invitation.id.value).value).toBe(
      invitation.id.value,
    );
    expect(invitation.petId.value).toBe(PET_ID);
    expect(invitation.invitedEmail.value).toBe('ana@example.com');
    expect(invitation.invitedByAccountId.value).toBe(ACCOUNT_ID);
    expect(invitation.status).toBe(PetInvitationStatus.PENDING);
    expect(invitation.createdAt).toBe('2026-09-26T12:30:00.000Z');
    expect(invitation.expiresAt).toBe('2026-10-03T12:30:00.000Z');
  });

  it('expires only when the deadline has arrived', () => {
    const invitation: PetInvitation = createInvitation();

    expect(invitation.expireIfDue(new Date('2026-10-03T12:29:59.999Z'))).toBe(
      false,
    );
    expect(invitation.status).toBe(PetInvitationStatus.PENDING);
    expect(invitation.expireIfDue(new Date('2026-10-03T12:30:00.000Z'))).toBe(
      true,
    );
    expect(invitation.status).toBe(PetInvitationStatus.EXPIRED);
  });

  it('rejects reconstituting an invitation with a different duration', () => {
    const invitation: PetInvitation = createInvitation();

    expect(() =>
      PetInvitation.reconstitute({
        id: invitation.id,
        petId: invitation.petId,
        invitedEmail: invitation.invitedEmail,
        invitedByAccountId: invitation.invitedByAccountId,
        status: PetInvitationStatus.PENDING,
        createdAt: invitation.createdAt,
        expiresAt: '2026-10-02T12:30:00.000Z',
      }),
    ).toThrow('Invitation state is invalid');
  });
});
