import { RestorePet } from '../application/restore-pet/restore-pet';
import { ArchivePet } from '../application/archive-pet/archive-pet';
import { RemovePetMember } from '../application/remove-pet-member/remove-pet-member';
import { PromoteCollaboratorToOwner } from '../application/promote-collaborator-to-owner/promote-collaborator-to-owner';
import { Module } from '@nestjs/common';
import { AcceptInvitation } from '../application/accept-invitation/accept-invitation';
import { RejectInvitation } from '../application/reject-invitation/reject-invitation';
import { CancelInvitation } from '../application/cancel-invitation/cancel-invitation';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../../identity/infrastructure/identity.module';
import { ACCOUNT_LOOKUP, type AccountLookup } from '../application/identity/account-lookup';
import { GetPetDetail } from '../application/get-pet-detail/get-pet-detail';
import { InviteCollaborator } from '../application/invite-collaborator/invite-collaborator';
import { ListPetMembers } from '../application/list-pet-members/list-pet-members';
import { ListMyPets } from '../application/list-my-pets/list-my-pets';
import { LeavePet } from '../application/leave-pet/leave-pet';
import {
    PET_INVITATION_REPOSITORY,
    type PetInvitationRepository,
} from '../application/persistence/pet-invitation.repository';
import {
    PET_QUERY_REPOSITORY,
    type PetQueryRepository,
} from '../application/persistence/pet-query.repository';
import { PET_REPOSITORY, type PetRepository } from '../application/persistence/pet.repository';
import { RegisterPet } from '../application/register-pet/register-pet';
import { UpdatePetProfile } from '../application/update-pet-profile/update-pet-profile';
import { CLOCK, type Clock } from '../application/time/clock';
import { PetsController } from './http/controllers/pets.controller';
import { PetInvitationsController } from './http/controllers/pet-invitations.controller';
import { DrizzlePetQueryRepository } from './persistence/drizzle/drizzle-pet-query.repository';
import { DrizzlePetInvitationRepository } from './persistence/drizzle/drizzle-pet-invitation.repository';
import { DrizzlePetRepository } from './persistence/drizzle/drizzle-pet.repository';

@Module({
    imports: [DatabaseModule, IdentityModule],
    controllers: [PetsController, PetInvitationsController],
    providers: [
        {
            provide: RestorePet,
            inject: [PET_REPOSITORY],
            useFactory: (petRepository: PetRepository): RestorePet => new RestorePet(petRepository),
        },
        {
            provide: ArchivePet,
            inject: [PET_REPOSITORY],
            useFactory: (petRepository: PetRepository): ArchivePet => new ArchivePet(petRepository),
        },
        {
            provide: PromoteCollaboratorToOwner,
            inject: [PET_REPOSITORY],
            useFactory: (petRepository: PetRepository): PromoteCollaboratorToOwner =>
                new PromoteCollaboratorToOwner(petRepository),
        },
        {
            provide: RemovePetMember,
            inject: [PET_REPOSITORY],
            useFactory: (petRepository: PetRepository): RemovePetMember =>
                new RemovePetMember(petRepository),
        },
        DrizzlePetQueryRepository,
        DrizzlePetInvitationRepository,
        {
            provide: PET_INVITATION_REPOSITORY,
            useExisting: DrizzlePetInvitationRepository,
        },
        {
            provide: CLOCK,
            useFactory: (): Clock => ({ now: (): Date => new Date() }),
        },
        {
            provide: PET_QUERY_REPOSITORY,
            useExisting: DrizzlePetQueryRepository,
        },
        {
            provide: ListMyPets,
            inject: [PET_QUERY_REPOSITORY],
            useFactory: (petQueryRepository: PetQueryRepository): ListMyPets =>
                new ListMyPets(petQueryRepository),
        },
        {
            provide: ListPetMembers,
            inject: [PET_QUERY_REPOSITORY, ACCOUNT_LOOKUP],
            useFactory: (
                petQueryRepository: PetQueryRepository,
                accountLookup: AccountLookup,
            ): ListPetMembers => new ListPetMembers(petQueryRepository, accountLookup),
        },
        {
            provide: GetPetDetail,
            inject: [PET_QUERY_REPOSITORY],
            useFactory: (petQueryRepository: PetQueryRepository): GetPetDetail =>
                new GetPetDetail(petQueryRepository),
        },
        {
            provide: InviteCollaborator,
            inject: [PET_QUERY_REPOSITORY, ACCOUNT_LOOKUP, PET_INVITATION_REPOSITORY, CLOCK],
            useFactory: (
                petQueryRepository: PetQueryRepository,
                accountLookup: AccountLookup,
                petInvitationRepository: PetInvitationRepository,
                clock: Clock,
            ): InviteCollaborator =>
                new InviteCollaborator(
                    petQueryRepository,
                    accountLookup,
                    petInvitationRepository,
                    clock,
                ),
        },
        {
            provide: AcceptInvitation,
            inject: [ACCOUNT_LOOKUP, PET_INVITATION_REPOSITORY],
            useFactory: (
                accountLookup: AccountLookup,
                invitationRepository: PetInvitationRepository,
            ): AcceptInvitation => new AcceptInvitation(accountLookup, invitationRepository),
        },
        {
            provide: RejectInvitation,
            inject: [ACCOUNT_LOOKUP, PET_INVITATION_REPOSITORY],
            useFactory: (
                accountLookup: AccountLookup,
                invitationRepository: PetInvitationRepository,
            ): RejectInvitation => new RejectInvitation(accountLookup, invitationRepository),
        },
        {
            provide: CancelInvitation,
            inject: [PET_INVITATION_REPOSITORY],
            useFactory: (invitationRepository: PetInvitationRepository): CancelInvitation =>
                new CancelInvitation(invitationRepository),
        },
        DrizzlePetRepository,
        {
            provide: PET_REPOSITORY,
            useExisting: DrizzlePetRepository,
        },
        {
            provide: RegisterPet,
            inject: [PET_REPOSITORY],
            useFactory: (petRepository: PetRepository): RegisterPet =>
                new RegisterPet(petRepository),
        },
        {
            provide: UpdatePetProfile,
            inject: [PET_REPOSITORY],
            useFactory: (petRepository: PetRepository): UpdatePetProfile =>
                new UpdatePetProfile(petRepository),
        },
        {
            provide: LeavePet,
            inject: [PET_REPOSITORY],
            useFactory: (petRepository: PetRepository): LeavePet => new LeavePet(petRepository),
        },
    ],
})
export class PetManagementModule {}
