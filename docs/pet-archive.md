# Pet archive

`POST /pets/{petId}/archive` requires a Bearer token, a valid non-nil pet UUID,
no query parameters, and an absent body or `{}`. Authentication precedes HTTP
validation. Persistence checks pet existence and active owner authorization
before resolving lifecycle. Missing pets and every unauthorized requester receive
`404 PET_NOT_FOUND`, including unauthorized retries on archived pets.

An active owner transitions `ACTIVE` to `ARCHIVED` and receives `204 No Content`.
An authorized retry returns `204` without an UPDATE. Archive preserves identity,
profile, memberships, invitations, and Health history. It adds no schema changes,
notifications or deletion.

## Domain and persistence

`Pet.archive()` returns a new aggregate with the same properties and archived
status; calling it on an archived aggregate returns the same instance. The
repository reconstitutes the complete aggregate only for a real transition.
`PetProperties` requires the membership collection, so persistence loads it to
avoid constructing a partial aggregate. Memberships are neither locked as a
collection nor written. Retries require only the locked pet and requester.

`ArchivePet` translates explicit persistence outcomes `ARCHIVED`,
`ALREADY_ARCHIVED`, and `PET_NOT_FOUND`. Unexpected failures propagate.

The `READ COMMITTED` transaction locks:

1. Pet `FOR UPDATE`.
2. Requester membership `FOR UPDATE`.

Only an active owner reaches lifecycle resolution. No owner count is needed:
archiving does not deactivate any owner. The domain transition drives an UPDATE
of only `pets.status`, guarded by the previous ACTIVE status. The existing
`pets_set_updated_at` trigger assigns `statement_timestamp()` on this UPDATE.
Retries perform no UPDATE; membership timestamps and pet creation time remain
unchanged.

## Archived operation matrix

The approved slice changes List My Pets and Get Pet Detail to permit archived
pets. The remaining restrictions are preserved.

| Operation | ARCHIVED behavior |
| --- | --- |
| List My Pets | Included for an ACTIVE membership; summary exposes status. |
| Get Pet Detail | Readable for an ACTIVE owner or collaborator; exposes status. |
| List Pet Members | Readable for an ACTIVE owner or collaborator; lists ACTIVE members only. |
| Weight History | Readable for an ACTIVE owner or collaborator. |
| Vaccination History | Readable for an ACTIVE owner or collaborator. |
| Update Pet Profile | `404 PET_NOT_FOUND`. |
| Invite Collaborator | `404 PET_NOT_FOUND`; transaction revalidates authorization. |
| Cancel Invitation | `404 PET_NOT_FOUND`, including cancellation retries. |
| Remove Pet Member | `404 PET_NOT_FOUND`, before target resolution. |
| Promote Collaborator | `404 PET_NOT_FOUND`, before target resolution. |
| Leave Pet | Allowed; last-owner invariant and inactive-member retry still apply. |
| Accept Invitation | A pending, unexpired invitation returns `409 INVITATION_NOT_ACCEPTABLE` without granting access. |
| Reject Invitation | Governed by invitation lifecycle and recipient email, independently of Pet status. |
| Record/Update/Delete Weight | `404 PET_NOT_FOUND`. |
| Record/Update/Delete Vaccination | `404 PET_NOT_FOUND`. |

Acceptance retains its existing precedence: an already accepted invitation has
an idempotent success without membership changes; an expired pending invitation
is expired before checking Pet lifecycle. Archive itself never changes pending
invitations. No status filters are introduced in the list endpoint.

## Invitation creation lock ordering

Invite's initial queries remain preliminary checks. `createPending` now
revalidates ACTIVE Pet and ACTIVE OWNER inside its transaction before writes:

- New invitation: Pet -> requester membership -> INSERT.
- Replacement of a pending expired invitation: existing Invitation -> Pet ->
  requester membership -> conditional expiry -> INSERT.

The existing invitation is locked before Pet, matching Accept and Cancel.
Acquiring it after Pet would create a lock inversion. The conditional expiry
still checks PENDING status, pet, email, and expiration time under lock. Unique
pending collisions retain their existing `INVITATION_ALREADY_PENDING` outcome.
Failure of owner/Pet authorization leaves the old invitation untouched.

## Concurrency

Pet is the common serialization point for Archive, profile updates, promotion,
removal, Leave, invitation creation, acceptance, and Health writes.

| Race | Other operation first | Archive first |
| --- | --- | --- |
| Archive | One transition; second owner revalidates and returns success without UPDATE. | Same behavior. |
| Update Profile | Updated profile is retained when archived. | Update fails with PET_NOT_FOUND. |
| Promote | Promotion is retained when archived. | Promotion fails with PET_NOT_FOUND. |
| Remove Member | Removal is retained; Archive revalidates its requester. | Removal fails with PET_NOT_FOUND. |
| Invite | Created invitation is retained. | Invite revalidates and makes no invitation write. |
| Accept | Acceptance may grant access before archive. | Pending unexpired invitation cannot grant access. |
| Leave | A departed Archive requester fails authorization; another active owner may archive. | Leave remains allowed and cannot deactivate the last owner. |
| Health write | Committed record is retained. | Write fails with PET_NOT_FOUND. |

Accept/Cancel acquire Invitation -> Pet -> membership. Archive never acquires
Invitation, so it introduces no cycle with either. Expired invitation replacement
uses the same ordering. The six Health write methods acquire Pet -> membership;
correction/deletion then lock the record. Existing Health readers perform a
single query without explicit row locks and permit both Pet states.

## Verification

Domain tests verify transition, immutability, preserved aggregate state, and
same-instance retry. Application tests verify all outcomes and unexpected errors.
PostgreSQL integration tests verify authorization, rollback, timestamps, read
access, and ordered races in both directions. They also exercise stale Invite
authorization, expired replacement against Archive/Accept/Cancel, owner Leave,
and concurrent archives by the same or different owners.

Concurrency tests hold real PostgreSQL row locks, enqueue operations, observe
`pg_blocking_pids` through `pg_stat_activity`, and release explicit barriers. No
sleep determines operation order. A test-only trigger scoped to the fixture pet
rejects any UPDATE on already ARCHIVED state, detecting redundant physical writes
in both retries and Archive/Archive. It is removed after the test and is not a
migration or audit mechanism.

Record Weight represents the shared Health concurrency protocol. Both Weight and
Vaccination repositories already implement the same Pet-first revalidation for
all six writes. E2E tests additionally create both kinds of history, archive,
verify historical reads and preserved rows, and reject all six subsequent writes.
Swagger tests verify 24 operations and the Archive 204/400/401/404 contract.

## Restore

`POST /pets/{petId}/restore` uses the same authentication and HTTP validation
contract as Archive. Only an ACTIVE OWNER can restore; missing pets, collaborators,
inactive members and absent memberships return `404 PET_NOT_FOUND`.
Authorization precedes idempotence even when the pet is already ACTIVE.

`Pet.restore()` explicitly transitions ARCHIVED to ACTIVE in a new immutable
aggregate, or returns the same instance for ACTIVE. `RestorePet` maps RESTORED
and ALREADY_ACTIVE to success, and PET_NOT_FOUND to the application error.
Unexpected failures propagate. Persistence uses READ COMMITTED and locks Pet
then requester membership. It loads the complete aggregate's memberships only
for a transition, matching Archive, without writing them or counting owners.
Only status is updated, guarded by ARCHIVED; the existing trigger updates
pets.updated_at. Retries execute no physical UPDATE.

Restore preserves profile, identity, memberships including departed members,
all invitation states and expiration dates, and Health records and timestamps.
Pending unexpired invitations remain pending on an archived acceptance attempt
and can be accepted after Restore. Pending expired invitations are expired by
Accept before its Pet lifecycle check; Restore never revives them. Accepted,
rejected, cancelled and expired invitations retain their lifecycle.

Concurrent Restore calls serialize with one physical UPDATE. Restore and Archive
serialize in lock order: Restore then Archive ends ARCHIVED; Archive's no-op on
ARCHIVED then Restore ends ACTIVE. No operation has artificial priority.
Leave before Restore invalidates the same requester; Restore before Leave permits
a departure if another owner remains. A different remaining owner may restore.
Remove, Promote, Profile, Invite and Health writes fail if they lock an ARCHIVED
pet first and may proceed if Restore commits first. No failed operation is retried
automatically. Invite retains its transactional authorization recheck and locks
an existing expired invitation before Pet when replacing it. Accept/Cancel retain
Invitation -> Pet -> Membership; Restore never locks invitations and adds no cycle.
Reads continue to permit both statuses without new locks or filters.

Restore tests cover domain state preservation, persistence outcomes, authorization
on both statuses, rollback, physical no-op retries, invitation expiration, Health
history, ordered PostgreSQL races and HTTP/OpenAPI contracts. The API now exposes
25 operations. No schema migration, dependencies, audit log or deletion is added.

Restore has a narrowly scoped exception filter for JSON parser failures, which
occur before route guards. It authenticates these requests before returning
INVALID_REQUEST for scalar or malformed JSON. Other routes retain Nest's normal
error handling.
