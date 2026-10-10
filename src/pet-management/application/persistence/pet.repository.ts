import type { Pet } from '../../domain/pet/pet';

export const PET_REPOSITORY: unique symbol = Symbol('PET_REPOSITORY');

export interface LeavePetPersistenceResult {
    outcome: 'PET_NOT_FOUND' | 'LAST_OWNER_CANNOT_LEAVE' | 'LEFT' | 'ALREADY_LEFT';
}

export interface RemovePetMemberCommand {
    requesterAccountId: string;
    petId: string;
    targetMembershipId: string;
}

export interface RemovePetMemberPersistenceResult {
    outcome:
        | 'PET_NOT_FOUND'
        | 'PET_MEMBER_NOT_FOUND'
        | 'SELF_REMOVAL_NOT_SUPPORTED'
        | 'LAST_OWNER_CANNOT_BE_REMOVED'
        | 'REMOVED';
}

export interface PromoteCollaboratorCommand {
    requesterAccountId: string;
    petId: string;
    targetMembershipId: string;
}

export interface PromoteCollaboratorPersistenceResult {
    outcome:
        | 'PROMOTED'
        | 'ALREADY_OWNER'
        | 'PET_NOT_FOUND'
        | 'PET_MEMBER_NOT_FOUND'
        | 'PET_MEMBER_INACTIVE';
}

export interface ArchivePetCommand {
    requesterAccountId: string;
    petId: string;
}

export interface ArchivePetPersistenceResult {
    outcome: 'ARCHIVED' | 'ALREADY_ARCHIVED' | 'PET_NOT_FOUND';
}

export interface RestorePetCommand {
    requesterAccountId: string;
    petId: string;
}

export interface RestorePetPersistenceResult {
    outcome: 'RESTORED' | 'ALREADY_ACTIVE' | 'PET_NOT_FOUND';
}

export interface PetRepository {
    restoreIfOwned(command: RestorePetCommand): Promise<RestorePetPersistenceResult>;
    archiveIfOwned(command: ArchivePetCommand): Promise<ArchivePetPersistenceResult>;
    promoteCollaboratorIfOwned(
        command: PromoteCollaboratorCommand,
    ): Promise<PromoteCollaboratorPersistenceResult>;
    removeMemberIfOwned(command: RemovePetMemberCommand): Promise<RemovePetMemberPersistenceResult>;
    save(pet: Pet): Promise<void>;
    correctProfileIfOwned(
        petId: string,
        authenticatedAccountId: string,
        correct: (pet: Pet) => Pet,
    ): Promise<Pet | null>;
    leave(petId: string, authenticatedAccountId: string): Promise<LeavePetPersistenceResult>;
}
