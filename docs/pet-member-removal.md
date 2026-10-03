# Pet member removal

`DELETE /pets/:petId/members/:membershipId` allows an active owner of an active
Pet to remove another owner or collaborator. Success is `204 No Content`.
Removal preserves the historical membership and changes only status to INACTIVE.
Leave remains the explicit voluntary departure operation and also allows archived Pets.

## Authorization and precedence

Authentication runs before controller validation. Both path IDs must be valid
non-nil UUIDs. Query parameters are rejected; the body must be absent or `{}`.
After validation, the atomic persistence boundary evaluates:

1. Pet ACTIVE and requester ACTIVE OWNER; otherwise `PET_NOT_FOUND`.
2. Target membership belonging to that Pet; otherwise `PET_MEMBER_NOT_FOUND`.
3. Self-target; `SELF_REMOVAL_NOT_SUPPORTED`, even with additional owners.
4. Another INACTIVE target; idempotent success without UPDATE for either role.
5. Active target role and preservation of at least one active owner.
6. The domain transition and status-only persistence.

Authorization precedes target errors and idempotence on every retry. An inactive
requester targeting its own membership receives `PET_NOT_FOUND`, not the
self-removal conflict. UUID identity comparisons are normalized.

`SELF_REMOVAL_NOT_SUPPORTED` is the publicly reachable `409` conflict.
`LAST_OWNER_CANNOT_BE_REMOVED` is a defensive domain/persistence outcome mapped
by Application and HTTP, but not a normal reachable request under this contract:
if requester equals target, self-removal wins; otherwise the authorized requester
remains an active owner. Its rejection is tested in Domain and its persistence
outcome mapping in Application, without constructing an impossible HTTP fixture.
`LAST_OWNER_CANNOT_LEAVE` remains separate and publicly reachable for Leave.

## Domain and transaction protocol

`PetMemberRemovalPolicy` owns the administrative decision and calls the expressive
`removeAsOwner()` or `removeAsCollaborator()` transition. A small pure predicate
in `pet-owner-invariant.ts` is shared with Leave solely for owner-set preservation.
Membership does not inspect other members. No full Pet profile is required to
protect the Pet consistency boundary.

`removeMemberIfOwned` uses READ COMMITTED and locks:

1. Pet FOR UPDATE.
2. Requester membership FOR UPDATE by Pet and account.
3. Target membership FOR UPDATE by Pet and membership ID.
4. For another ACTIVE OWNER, query existence of another ACTIVE OWNER.

The decision is based on state read after the Pet lock. No authorization/mutation
split or role-based lock choice is performed before that mutex. Requester and
target may be the same locked row; no UPDATE occurs before detecting self-target.
The UPDATE checks identity, Pet, account, original role and ACTIVE status, and
must return exactly one row. No owner count is stored.

All owner-set writers follow the [Leave protocol](pet-leave.md). Register creates
the initial Pet and owner together. Accept locks Invitation before Pet and
membership, but never creates an owner. Remove never locks Invitation, so these
operations do not form a lock cycle. Direct SQL outside the protocol is not
protected by an owner-invariant database trigger.

## Concurrency and historical identity

Two owners removing the same owner serialize: one transitions it, the other
observes INACTIVE and succeeds without UPDATE. Cross-removal serializes and
rechecks authority: the removed requester receives `PET_NOT_FOUND`, leaving the
winning owner active. Remove and the target's Leave perform one deactivation in
either order; Leave remains idempotent after an administrative removal.

Promote rechecks authority after Pet: a removed requester cannot promote. On the
same collaborator, Promote then Remove leaves INACTIVE OWNER; Remove then
Promote rejects an inactive target. Separate targets also serialize on Pet.

Accept then Remove on an active owner preserves its owner role during Accept,
then removes it. Remove then pending Accept legitimately performs two changes:
INACTIVE OWNER followed by reactivation as ACTIVE COLLABORATOR on the same
membership. An already accepted invitation retry performs no reactivation.

The existing timestamp trigger changes updated_at on a real UPDATE; retries do
not UPDATE, preserving timestamps and physical row version/location. Membership
ID, account ID, role and created_at remain unchanged by removal. Current member
reads exclude removed members and active-membership access checks deny them.

PostgreSQL concurrency tests queue operations behind Pet and observe the scoped
blocking chain via pg_blocking_pids before releasing the barrier. No elapsed
sleep determines operation order. A test-only trigger guard rejects redundant
UPDATEs on an already inactive membership and is removed in finally; it is not
production integrity infrastructure or a migration. Reactivation remains allowed.

No migration, additional endpoint, dependency or owner-set infrastructure is
introduced. The API retains 23 operations.
