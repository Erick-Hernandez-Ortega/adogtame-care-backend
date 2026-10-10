import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { AccountLookup } from '../identity/account-lookup';
import type { PetMemberSummary, PetQueryRepository } from '../persistence/pet-query.repository';
import { ListPetMembers } from './list-pet-members';

const PET_ID: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const OWNER_ID: string = '550e8400-e29b-41d4-a716-446655440000';
const COLLABORATOR_ID: string = '550e8400-e29b-41d4-a716-446655440001';

describe('ListPetMembers', () => {
    const memberships: PetMemberSummary[] = [
        { membershipId: 'owner-first', accountId: OWNER_ID, role: 'OWNER' },
        { membershipId: 'owner-second', accountId: 'other-owner', role: 'OWNER' },
        {
            membershipId: 'collaborator-first',
            accountId: COLLABORATOR_ID,
            role: 'COLLABORATOR',
        },
        {
            membershipId: 'collaborator-second',
            accountId: 'other-collaborator',
            role: 'COLLABORATOR',
        },
    ];
    let repository: jest.Mocked<PetQueryRepository>;
    let accountLookup: jest.Mocked<AccountLookup>;
    let listPetMembers: ListPetMembers;

    beforeEach(() => {
        repository = {
            findAccessibleMembers: jest.fn().mockResolvedValue(memberships),
            findAccessibleByAccountId: jest.fn(),
            findAccessibleDetailById: jest.fn(),
            hasActiveOwnerAccess: jest.fn(),
            hasActiveMembership: jest.fn(),
        };
        accountLookup = {
            findEmailsByAccountIds: jest.fn().mockResolvedValue([
                {
                    accountId: 'other-collaborator',
                    email: 'second-collaborator@example.com',
                },
                { accountId: COLLABORATOR_ID, email: 'first-collaborator@example.com' },
                { accountId: 'other-owner', email: 'second-owner@example.com' },
                { accountId: OWNER_ID, email: 'first-owner@example.com' },
            ]),
            findAccountIdByEmail: jest.fn(),
            findEmailByAccountId: jest.fn(),
        };
        listPetMembers = new ListPetMembers(repository, accountLookup);
    });

    it.each([OWNER_ID, COLLABORATOR_ID])(
        'includes requester %s and composes emails by account ID without changing reader order',
        async (requesterId: string) => {
            await expect(listPetMembers.execute(PET_ID, requesterId)).resolves.toEqual({
                members: [
                    { ...memberships[0], email: 'first-owner@example.com' },
                    { ...memberships[1], email: 'second-owner@example.com' },
                    { ...memberships[2], email: 'first-collaborator@example.com' },
                    { ...memberships[3], email: 'second-collaborator@example.com' },
                ],
            });
            expect(repository.findAccessibleMembers.mock.calls).toEqual([[PET_ID, requesterId]]);
            expect(accountLookup.findEmailsByAccountIds.mock.calls).toEqual([
                [memberships.map((membership): string => membership.accountId)],
            ]);
            expect(accountLookup.findEmailByAccountId.mock.calls).toEqual([]);
            expect(accountLookup.findAccountIdByEmail.mock.calls).toEqual([]);
        },
    );

    it('returns only the current memberships supplied by the authorized reader', async () => {
        repository.findAccessibleMembers.mockResolvedValue([memberships[0]]);
        await expect(listPetMembers.execute(PET_ID, OWNER_ID)).resolves.toEqual({
            members: [{ ...memberships[0], email: 'first-owner@example.com' }],
        });
        expect(accountLookup.findEmailsByAccountIds.mock.calls).toEqual([[[OWNER_ID]]]);
    });

    it('rejects an inaccessible pet before looking up Identity data', async () => {
        repository.findAccessibleMembers.mockResolvedValue(null);
        await expect(listPetMembers.execute(PET_ID, OWNER_ID)).rejects.toThrow(PetNotFoundError);
        expect(accountLookup.findEmailsByAccountIds.mock.calls).toEqual([]);
    });

    it('fails on a missing Account instead of silently omitting its membership', async () => {
        accountLookup.findEmailsByAccountIds.mockResolvedValue([
            { accountId: OWNER_ID, email: 'first-owner@example.com' },
        ]);
        await expect(listPetMembers.execute(PET_ID, OWNER_ID)).rejects.toThrow(
            'Pet membership references a missing account',
        );
    });

    it('does not invent an additional invariant for an empty reader result', async () => {
        repository.findAccessibleMembers.mockResolvedValue([]);
        accountLookup.findEmailsByAccountIds.mockResolvedValue([]);
        await expect(listPetMembers.execute(PET_ID, OWNER_ID)).resolves.toEqual({
            members: [],
        });
    });

    it('propagates reader failures without performing an Identity lookup', async () => {
        const error: Error = new Error('Database unavailable');

        repository.findAccessibleMembers.mockRejectedValue(error);
        await expect(listPetMembers.execute(PET_ID, OWNER_ID)).rejects.toBe(error);
        expect(accountLookup.findEmailsByAccountIds.mock.calls).toEqual([]);
    });

    it('propagates Identity lookup failures', async () => {
        const error: Error = new Error('Identity lookup unavailable');

        accountLookup.findEmailsByAccountIds.mockRejectedValue(error);
        await expect(listPetMembers.execute(PET_ID, OWNER_ID)).rejects.toBe(error);
    });
});
