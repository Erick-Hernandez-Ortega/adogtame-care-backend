import { Injectable } from '@nestjs/common';
import { and, DrizzleQueryError, eq, lte } from 'drizzle-orm';
import postgres from 'postgres';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
  CreatePendingInvitationOutcome,
  type PetInvitationRepository,
} from '../../../application/persistence/pet-invitation.repository';
import { AccountId } from '../../../domain/pet-membership/pet-membership';
import {
  InvitationId,
  InvitedEmail,
  PetInvitation,
  PetInvitationStatus,
} from '../../../domain/pet-invitation/pet-invitation';
import type { PetInvitationStatus as PetInvitationStatusType } from '../../../domain/pet-invitation/pet-invitation.types';
import { PetId } from '../../../domain/pet/pet';
import { petInvitations } from './pet-management.schema';

@Injectable()
export class DrizzlePetInvitationRepository implements PetInvitationRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findPending(
    petId: string,
    email: string,
  ): Promise<PetInvitation | null> {
    const rows = await this.databaseService.connection
      .select()
      .from(petInvitations)
      .where(
        and(
          eq(petInvitations.petId, petId),
          eq(petInvitations.invitedEmail, email),
          eq(petInvitations.status, PetInvitationStatus.PENDING),
        ),
      )
      .limit(1);
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return PetInvitation.reconstitute({
      id: InvitationId.from(row.id),
      petId: PetId.from(row.petId),
      invitedEmail: InvitedEmail.from(row.invitedEmail),
      invitedByAccountId: AccountId.from(row.invitedByAccountId),
      status: row.status as PetInvitationStatusType,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }

  async createPending(
    invitation: PetInvitation,
    expiredInvitation: PetInvitation | null,
  ): Promise<CreatePendingInvitationOutcome> {
    if (invitation.status !== PetInvitationStatus.PENDING) {
      throw new TypeError('New invitation must be pending');
    }

    try {
      await this.databaseService.connection.transaction(async (transaction) => {
        if (expiredInvitation !== null) {
          if (expiredInvitation.status !== PetInvitationStatus.EXPIRED) {
            throw new TypeError('Previous invitation must be expired');
          }

          await transaction
            .update(petInvitations)
            .set({ status: PetInvitationStatus.EXPIRED })
            .where(
              and(
                eq(petInvitations.id, expiredInvitation.id.value),
                eq(petInvitations.petId, invitation.petId.value),
                eq(petInvitations.invitedEmail, invitation.invitedEmail.value),
                eq(petInvitations.status, PetInvitationStatus.PENDING),
                lte(petInvitations.expiresAt, new Date(invitation.createdAt)),
              ),
            );
        }

        await transaction.insert(petInvitations).values({
          id: invitation.id.value,
          petId: invitation.petId.value,
          invitedEmail: invitation.invitedEmail.value,
          invitedByAccountId: invitation.invitedByAccountId.value,
          status: invitation.status,
          createdAt: new Date(invitation.createdAt),
          expiresAt: new Date(invitation.expiresAt),
        });
      });

      return CreatePendingInvitationOutcome.CREATED;
    } catch (error: unknown) {
      const cause: unknown =
        error instanceof DrizzleQueryError ? error.cause : error;

      if (
        cause instanceof postgres.PostgresError &&
        cause.code === '23505' &&
        cause.table_name === 'pet_invitations' &&
        cause.constraint_name === 'pet_invitations_one_pending_per_email'
      ) {
        return CreatePendingInvitationOutcome.ALREADY_PENDING;
      }

      throw error;
    }
  }
}
