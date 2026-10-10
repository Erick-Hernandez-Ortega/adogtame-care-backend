import { Inject, Injectable } from '@nestjs/common';
import { and, DrizzleQueryError, eq, lte } from 'drizzle-orm';
import postgres from 'postgres';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    CreatePendingInvitationOutcome,
    type AcceptInvitationPersistenceResult,
    type CancelInvitationPersistenceResult,
    type PetInvitationRepository,
    type RejectInvitationPersistenceResult,
} from '../../../application/persistence/pet-invitation.repository';
import {
    decideRejection,
    type RejectionDecision,
} from '../../../application/reject-invitation/reject-invitation';
import {
    decideCancellation,
    type CancellationDecision,
} from '../../../application/cancel-invitation/cancel-invitation';
import {
    decideAcceptance,
    type AcceptanceDecision,
} from '../../../application/accept-invitation/accept-invitation';
import { CLOCK, type Clock } from '../../../application/time/clock';
import {
    AccountId,
    MembershipId,
    PetMembership,
    PetMembershipRole,
    PetMembershipStatus,
} from '../../../domain/pet-membership/pet-membership';
import {
    InvitationId,
    InvitedEmail,
    PetInvitation,
    PetInvitationStatus,
} from '../../../domain/pet-invitation/pet-invitation';
import type { PetInvitationStatus as PetInvitationStatusType } from '../../../domain/pet-invitation/pet-invitation.types';
import { PetId, PetStatus } from '../../../domain/pet/pet';
import type { PetStatus as PetStatusType } from '../../../domain/pet/pet.types';
import type {
    PetMembershipRole as PetMembershipRoleType,
    PetMembershipStatus as PetMembershipStatusType,
} from '../../../domain/pet-membership/pet-membership.types';
import { petInvitations, petMemberships, pets } from './pet-management.schema';

@Injectable()
export class DrizzlePetInvitationRepository implements PetInvitationRepository {
    constructor(
        private readonly databaseService: DatabaseService,
        @Inject(CLOCK) private readonly clock: Clock,
    ) {}

    async cancel(
        invitationId: string,
        authenticatedAccountId: string,
    ): Promise<CancelInvitationPersistenceResult> {
        return this.databaseService.connection.transaction(
            async (transaction) => {
                const invitationRows = await transaction
                    .select()
                    .from(petInvitations)
                    .where(eq(petInvitations.id, invitationId))
                    .for('update');
                const row = invitationRows[0];

                if (row === undefined) {
                    return { outcome: 'NOT_FOUND' };
                }

                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, row.petId))
                    .for('update');

                if (petRows[0]?.status !== PetStatus.ACTIVE) {
                    return { outcome: 'PET_NOT_FOUND' };
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, row.petId),
                            eq(petMemberships.accountId, authenticatedAccountId),
                        ),
                    )
                    .for('update');

                if (
                    membershipRows[0]?.status !== PetMembershipStatus.ACTIVE ||
                    membershipRows[0]?.role !== PetMembershipRole.OWNER
                ) {
                    return { outcome: 'PET_NOT_FOUND' };
                }

                const invitation: PetInvitation = PetInvitation.reconstitute({
                    id: InvitationId.from(row.id),
                    petId: PetId.from(row.petId),
                    invitedEmail: InvitedEmail.from(row.invitedEmail),
                    invitedByAccountId: AccountId.from(row.invitedByAccountId),
                    status: row.status as PetInvitationStatusType,
                    createdAt: row.createdAt.toISOString(),
                    expiresAt: row.expiresAt.toISOString(),
                });
                const decision: CancellationDecision = decideCancellation(
                    invitation,
                    this.clock.now(),
                );

                if (decision.invitationToSave !== null) {
                    const changedRows = await transaction
                        .update(petInvitations)
                        .set({ status: decision.invitationToSave.status })
                        .where(
                            and(
                                eq(petInvitations.id, invitationId),
                                eq(petInvitations.status, PetInvitationStatus.PENDING),
                            ),
                        )
                        .returning({ id: petInvitations.id });

                    if (changedRows.length !== 1) {
                        throw new Error('Invitation transition did not update one row');
                    }
                }

                return decision.outcome === 'CANCELLED'
                    ? { outcome: 'CANCELLED', id: row.id, petId: row.petId }
                    : { outcome: decision.outcome };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async reject(
        invitationId: string,
        invitedEmail: string,
    ): Promise<RejectInvitationPersistenceResult> {
        return this.databaseService.connection.transaction(
            async (transaction) => {
                const invitationRows = await transaction
                    .select()
                    .from(petInvitations)
                    .where(
                        and(
                            eq(petInvitations.id, invitationId),
                            eq(petInvitations.invitedEmail, invitedEmail),
                        ),
                    )
                    .for('update');
                const row = invitationRows[0];

                if (row === undefined) {
                    return { outcome: 'NOT_FOUND' };
                }

                const invitation: PetInvitation = PetInvitation.reconstitute({
                    id: InvitationId.from(row.id),
                    petId: PetId.from(row.petId),
                    invitedEmail: InvitedEmail.from(row.invitedEmail),
                    invitedByAccountId: AccountId.from(row.invitedByAccountId),
                    status: row.status as PetInvitationStatusType,
                    createdAt: row.createdAt.toISOString(),
                    expiresAt: row.expiresAt.toISOString(),
                });
                const decision: RejectionDecision = decideRejection(invitation, this.clock.now());

                if (decision.invitationToSave !== null) {
                    const changedRows = await transaction
                        .update(petInvitations)
                        .set({ status: decision.invitationToSave.status })
                        .where(
                            and(
                                eq(petInvitations.id, invitationId),
                                eq(petInvitations.status, PetInvitationStatus.PENDING),
                            ),
                        )
                        .returning({ id: petInvitations.id });

                    if (changedRows.length !== 1) {
                        throw new Error('Invitation transition did not update one row');
                    }
                }

                return decision.outcome === 'REJECTED'
                    ? { outcome: 'REJECTED', id: row.id, petId: row.petId }
                    : { outcome: decision.outcome };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async accept(
        invitationId: string,
        invitedEmail: string,
        accountId: string,
    ): Promise<AcceptInvitationPersistenceResult> {
        return this.databaseService.connection.transaction(
            async (transaction) => {
                const invitationRows = await transaction
                    .select()
                    .from(petInvitations)
                    .where(
                        and(
                            eq(petInvitations.id, invitationId),
                            eq(petInvitations.invitedEmail, invitedEmail),
                        ),
                    )
                    .for('update');
                const row = invitationRows[0];

                if (row === undefined) {
                    return { outcome: 'NOT_FOUND' };
                }

                const invitation: PetInvitation = PetInvitation.reconstitute({
                    id: InvitationId.from(row.id),
                    petId: PetId.from(row.petId),
                    invitedEmail: InvitedEmail.from(row.invitedEmail),
                    invitedByAccountId: AccountId.from(row.invitedByAccountId),
                    status: row.status as PetInvitationStatusType,
                    createdAt: row.createdAt.toISOString(),
                    expiresAt: row.expiresAt.toISOString(),
                });
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, row.petId))
                    .for('update');
                const petRow = petRows[0];

                if (petRow === undefined) {
                    throw new Error('Invitation pet is missing');
                }

                const membershipRows = await transaction
                    .select()
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, row.petId),
                            eq(petMemberships.accountId, accountId),
                        ),
                    )
                    .for('update');
                const membershipRow = membershipRows[0];
                const membership: PetMembership | null =
                    membershipRow === undefined
                        ? null
                        : PetMembership.reconstitute({
                              id: MembershipId.from(membershipRow.id),
                              accountId: AccountId.from(membershipRow.accountId),
                              role: membershipRow.role as PetMembershipRoleType,
                              status: membershipRow.status as PetMembershipStatusType,
                          });
                const now: Date = this.clock.now();
                const decision: AcceptanceDecision = decideAcceptance(
                    invitation,
                    petRow.status as PetStatusType,
                    membership,
                    accountId,
                    now,
                );

                if (decision.outcome === 'ACCEPTED' && decision.membershipChange !== null) {
                    const change = decision.membershipChange;

                    if (change.kind === 'CREATE') {
                        await transaction.insert(petMemberships).values({
                            id: change.membership.id.value,
                            petId: row.petId,
                            accountId: change.membership.accountId.value,
                            role: change.membership.role,
                            status: change.membership.status,
                        });
                    } else {
                        const changedRows = await transaction
                            .update(petMemberships)
                            .set({
                                role: change.membership.role,
                                status: change.membership.status,
                            })
                            .where(
                                and(
                                    eq(petMemberships.id, change.membership.id.value),
                                    eq(petMemberships.petId, row.petId),
                                    eq(petMemberships.accountId, accountId),
                                    eq(petMemberships.status, PetMembershipStatus.INACTIVE),
                                ),
                            )
                            .returning({ id: petMemberships.id });

                        if (changedRows.length !== 1) {
                            throw new Error('Membership reactivation did not update one row');
                        }
                    }
                }

                if (decision.invitationToSave !== null) {
                    const changedRows = await transaction
                        .update(petInvitations)
                        .set({ status: decision.invitationToSave.status })
                        .where(
                            and(
                                eq(petInvitations.id, invitationId),
                                eq(petInvitations.status, PetInvitationStatus.PENDING),
                            ),
                        )
                        .returning({ id: petInvitations.id });

                    if (changedRows.length !== 1) {
                        throw new Error('Invitation transition did not update one row');
                    }
                }

                return decision.outcome === 'ACCEPTED'
                    ? { outcome: 'ACCEPTED', id: row.id, petId: row.petId }
                    : { outcome: decision.outcome };
            },
            { isolationLevel: 'read committed' },
        );
    }

    async findPending(petId: string, email: string): Promise<PetInvitation | null> {
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
            return await this.databaseService.connection.transaction(
                async (transaction): Promise<CreatePendingInvitationOutcome> => {
                    // Existing invitation locks precede Pet, matching Accept/Cancel (docs/pet-archive.md).
                    if (expiredInvitation !== null) {
                        if (expiredInvitation.status !== PetInvitationStatus.EXPIRED) {
                            throw new TypeError('Previous invitation must be expired');
                        }

                        await transaction
                            .select({ id: petInvitations.id })
                            .from(petInvitations)
                            .where(eq(petInvitations.id, expiredInvitation.id.value))
                            .for('update');
                    }

                    const petRows = await transaction
                        .select({ status: pets.status })
                        .from(pets)
                        .where(eq(pets.id, invitation.petId.value))
                        .for('update');

                    if (petRows[0]?.status !== PetStatus.ACTIVE) {
                        return CreatePendingInvitationOutcome.PET_NOT_FOUND;
                    }

                    const requesterRows = await transaction
                        .select({
                            role: petMemberships.role,
                            status: petMemberships.status,
                        })
                        .from(petMemberships)
                        .where(
                            and(
                                eq(petMemberships.petId, invitation.petId.value),
                                eq(petMemberships.accountId, invitation.invitedByAccountId.value),
                            ),
                        )
                        .for('update');

                    if (
                        requesterRows[0]?.status !== PetMembershipStatus.ACTIVE ||
                        requesterRows[0].role !== PetMembershipRole.OWNER
                    ) {
                        return CreatePendingInvitationOutcome.PET_NOT_FOUND;
                    }

                    if (expiredInvitation !== null) {
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

                    return CreatePendingInvitationOutcome.CREATED;
                },
                { isolationLevel: 'read committed' },
            );
        } catch (error: unknown) {
            const cause: unknown = error instanceof DrizzleQueryError ? error.cause : error;

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
