export interface InviteCollaboratorCommand {
  petId: string;
  invitedByAccountId: string;
  email: string;
}

export interface CreatedPetInvitation {
  id: string;
  petId: string;
  email: string;
  status: 'PENDING';
  createdAt: string;
  expiresAt: string;
}
