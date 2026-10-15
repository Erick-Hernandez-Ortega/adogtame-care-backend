import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { AccountEmail, AccountLookup } from '../identity/account-lookup';
import type { PetMemberSummary, PetQueryRepository } from '../persistence/pet-query.repository';

export interface PetMember extends PetMemberSummary {
    readonly email: string;
}

export interface PetMembers {
    readonly items: PetMember[];
    readonly nextCursor: string | null;
}

export class ListPetMembers {
    constructor(
        private readonly petQueryRepository: PetQueryRepository,
        private readonly accountLookup: AccountLookup,
    ) {}

    async execute(petId: string, accountId: string, query: PageQuery = {}): Promise<PetMembers> {
        const scope: string = JSON.stringify(['members', petId, accountId]);
        const memberships: PetMemberSummary[] | null =
            await this.petQueryRepository.findAccessibleMembers(
                petId,
                accountId,
                pageRequest(query, scope),
            );

        if (memberships === null) {
            throw new PetNotFoundError();
        }

        const page = pageResult(memberships, query, scope);
        const accounts: AccountEmail[] = await this.accountLookup.findEmailsByAccountIds(
            page.items.map((membership): string => membership.accountId),
        );
        const emailsByAccountId: Map<string, string> = new Map(
            accounts.map((account): [string, string] => [account.accountId, account.email]),
        );

        return {
            nextCursor: page.nextCursor,
            items: page.items.map((membership): PetMember => {
                const email: string | undefined = emailsByAccountId.get(membership.accountId);

                if (email === undefined) {
                    throw new Error('Pet membership references a missing account');
                }

                return {
                    ...membership,
                    email,
                };
            }),
        };
    }
}
