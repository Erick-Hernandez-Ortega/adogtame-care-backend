# Pet leave

`POST /pets/:petId/leave` resolves only the authenticated account's own membership,
including an inactive historical membership. Success is `204 No Content` for
owners and collaborators, on active or archived pets. An inactive membership
is an idempotent success before evaluating ownership. Missing pets or absent
own memberships are both `404 PET_NOT_FOUND`.

## Domain decision

`PetLeavePolicy` expresses only Leave: an active owner can leave when another
active owner exists for the same pet. Otherwise the result is
`LAST_OWNER_CANNOT_LEAVE`, mapped to HTTP `409`. The owner-set predicate is
shared with `PetMemberRemovalPolicy` through the small `pet-owner-invariant.ts`
domain function. Collaborators need no owner
check. `PetMembership.leaveAsOwner()` and `leaveAsCollaborator()` express local
transitions; the entity does not know the other memberships. Call the owner
transition only after the policy allows it.

The policy belongs to Pet's consistency boundary without requiring the complete
profile and membership collection to be reconstituted. Persistence supplies the
current existence fact under the aggregate mutex and invokes the pure domain
decision. Application maps persistence outcomes to errors or success; HTTP maps
the errors to status codes. No layer duplicates the last-owner decision.

## Transaction protocol

Leave uses `READ COMMITTED` and acquires locks in this order:

1. Pet `FOR UPDATE`, without filtering out archived pets.
2. Own membership `FOR UPDATE`, by pet and authenticated account.
3. For an active owner only, query whether another active owner exists.
4. Run the domain policy and update only membership status when allowed.

Pet is a logical aggregate mutex. After waiting for it, the separate owner
query sees preceding committed changes under `READ COMMITTED`. Concurrent
Leaves serialize: each departing owner sees the current set, and the last
owner is rejected. Do not acquire membership before Pet or read the role to
choose a lock path before acquiring Pet. Collaborator Leave follows the same
protocol so Promote cannot race a role-based choice.

The Pet row lock does not itself prevent membership phantoms. Correctness
requires all writers affecting the owner set to respect this protocol:

- Register inserts a new Pet and its initial owner in one transaction; it does
  not update existing pets.
- Promote locks Pet, requester membership, then target membership.
- Remove Member uses the same order, rejects self-removal, and checks owner
  preservation before removing another active owner. Inactive targets are no-ops.
- Accept locks Invitation, Pet, then membership; it creates or reactivates as
  collaborator, never as owner. An active membership is preserved.
- Leave locks Pet then its own membership for both roles.

These are the membership-writing flows currently present in production code.
Future owner-changing operations must use Pet first and evaluate the invariant
under that mutex. Direct SQL outside this protocol is not constrained by a
last-owner database trigger. No count is stored and no migration is required.

Leave does not lock Invitation, so it cannot form a lock cycle with Accept's
Invitation-first order. Profile and Health writes also acquire Pet before
membership. Administrative operations revalidate active owner authority after
acquiring Pet, including when a preceding Leave revoked that authority.

## Historical identity and retries

A real transition preserves membership ID, account ID, role, and `created_at`.
The existing `pet_memberships_set_updated_at` trigger updates `updated_at` on
UPDATE. An inactive retry performs no UPDATE; the Pet lock does not update Pet.
Departed owners remain `INACTIVE OWNER`, disappear from current member lists,
and lose access through the existing active-membership checks.

A new invitation may reactivate a departed owner as `ACTIVE COLLABORATOR` in
the same membership. Accept's existing behavior is unchanged. Retrying an
already accepted invitation does not reactivate a membership that left later.

## Verification

PostgreSQL tests hold Pet in a barrier transaction and observe its blocking
chain through `pg_blocking_pids` before releasing queued operations. They check
two- and three-owner Leave races and ordering against Promote, Remove and
Accept. Observation is scoped to the test barrier's backend, with a bounded
timeout; elapsed sleeps do not determine operation order. Retry tests compare
row versions and locations as well as timestamps to detect physical UPDATEs.

The endpoint replaces its earlier `200` representation with `204` without
content. It requires a non-nil UUID and rejects unexpected query parameters or
a nonempty body with `400 INVALID_REQUEST`. The API still has 23 operations.
