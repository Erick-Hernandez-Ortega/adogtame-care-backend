import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { AccountEmail, AccountLookup } from '../identity/account-lookup';
import type {
  PetMemberSummary,
  PetQueryRepository,
} from '../persistence/pet-query.repository';

export interface PetMember extends PetMemberSummary {
  readonly email: string;
}

export interface PetMembers {
  readonly members: PetMember[];
}

export class ListPetMembers {
  constructor(
    private readonly petQueryRepository: PetQueryRepository,
    private readonly accountLookup: AccountLookup,
  ) {}

  async execute(petId: string, accountId: string): Promise<PetMembers> {
    const memberships: PetMemberSummary[] | null =
      await this.petQueryRepository.findAccessibleMembers(petId, accountId);

    if (memberships === null) {
      throw new PetNotFoundError();
    }

    const accounts: AccountEmail[] =
      await this.accountLookup.findEmailsByAccountIds(
        memberships.map((membership): string => membership.accountId),
      );
    const emailsByAccountId: Map<string, string> = new Map(
      accounts.map((account): [string, string] => [
        account.accountId,
        account.email,
      ]),
    );

    return {
      members: memberships.map((membership): PetMember => {
        const email: string | undefined = emailsByAccountId.get(
          membership.accountId,
        );

        if (email === undefined) {
          throw new Error('Pet membership references a missing account');
        }

        return {
          membershipId: membership.membershipId,
          accountId: membership.accountId,
          email,
          role: membership.role,
        };
      }),
    };
  }
}
