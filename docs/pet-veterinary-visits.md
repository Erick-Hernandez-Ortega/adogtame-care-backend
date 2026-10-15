# Pet veterinary visits

## Record (#42)

`POST /pets/{petId}/health/veterinary-visits` records a visit. A visit reports an encounter; it has independent
identity, allows duplicates, and has no lifecycle status. Diagnosis text does not create
or link a medical condition. Veterinarians, clinics, attachments, medication links,
and reminders are outside these slices.

The strict body requires `visitDate` and `reason`. Visit date is an exact complete civil
`YYYY-MM-DD` date in years 0001–9999, no later than today UTC, sampled once through
`HEALTH_CLOCK`. It is never inferred from creation time. Reconstitution validates dates
structurally without consulting a Clock. Reason is trimmed, nonempty, case-preserving
text with at most 255 Unicode code points. Optional diagnosis and observations accept
omission/null; supplied text must remain nonempty after trimming, with bounds of 2,000
and 5,000 Unicode code points respectively. These bounds follow existing Health text
conventions, with a larger allowance for observations.

Success returns 201 with exactly `id`, `petId`, `visitDate`, `reason`, nullable `diagnosis`,
nullable `observations`, and `recordedByAccountId`. Authorship comes from the authenticated
account. Technical timestamps are persistence details and are omitted from the response.
No query parameters are accepted; path IDs must be non-nil UUIDs.

Authentication precedes HTTP validation, including JSON parser failures. Structural
errors return `400 INVALID_REQUEST`; semantic errors return 400 with
`INVALID_VETERINARY_VISIT_REASON`, `INVALID_VETERINARY_VISIT_DATE`,
`INVALID_VETERINARY_VISIT_DIAGNOSIS`, or `INVALID_VETERINARY_VISIT_OBSERVATIONS`.
Domain validation precedes transactional access. Missing/invalid Bearer returns
`401 UNAUTHENTICATED`. Missing/archived pets and missing/inactive memberships return
`404 PET_NOT_FOUND`, without exposing authorization details.

## Persistence and consistency

The aggregate and its value objects own normalization and date invariants. Application
coordinates recording through `PetVeterinaryVisitRepository.createIfPetWritable`, whose
outcomes are `CREATED` and `PET_NOT_FOUND`. Unexpected failures propagate.

ACTIVE owners and collaborators may record visits on ACTIVE pets. Authorization and INSERT
are atomic in a READ COMMITTED transaction with locks Pet → requester Membership → INSERT.
There is no existing visit row to lock during creation. This serializes against Archive,
Leave, and Remove; an access change that commits first prevents insertion, while a visit
that commits first remains preserved. Original authorship does not grant enduring access.
Archive and Restore do not change visit data or timestamps.

Generated migration `0017_mean_bishop.sql` creates `health_pet_veterinary_visits` with UUID
primary key, restrictive foreign keys to pet and recording account, a required PostgreSQL
date, bounded text, nonempty text checks and a civil date range check. Future-date validation
remains in Domain. The non-unique `(pet_id, visit_date DESC)` index supports pet-scoped
chronological access without extra indexes.

`created_at` and `updated_at` default to PostgreSQL `now()` and start equal. A small SQL
addition to the generated migration attaches the existing `set_updated_at()` trigger,
matching other Health records; physical updates use `statement_timestamp()`. No new trigger
function, infrastructure, data backfill, dependency, or existing-row rewrite is introduced.

Unit tests exercise domain behavior and application orchestration. PostgreSQL tests cover
constraints, access, rollback, timestamps, preservation and both serialization orders for
Archive/Leave/Remove, observing `pg_blocking_pids` behind a Pet barrier without timing sleeps.
HTTP tests cover exact responses, Unicode limits, UTC boundaries, strict requests, errors
and authentication precedence. OpenAPI tests assert the new contract and operation count.

## List (#43)

`GET /pets/{petId}/health/veterinary-visits` adds one operation, bringing the API to
44 OpenAPI operations. Authentication precedes HTTP validation. The path requires a
non-nil UUID; no query parameters, pagination, filters, or sorting options are accepted.
Invalid paths or queries return `400 INVALID_REQUEST`; missing/invalid Bearer tokens
return `401 UNAUTHENTICATED`.

ACTIVE owners and collaborators may read ACTIVE or ARCHIVED pets. Missing pets,
outsiders, and inactive members (including original authors) receive the same
`404 PET_NOT_FOUND`. An accessible pet without visits returns `200 { "items": [] }`.
All visits are returned, preserving independent duplicates and original authorship.
Each item contains exactly `id`, `visitDate`, `reason`, nullable `diagnosis`, nullable
`observations`, and `recordedByAccountId`. Pet identity comes from the route;
technical timestamps are omitted. Dates remain civil `YYYY-MM-DD` strings.

The application-owned `PetVeterinaryVisitReader.findAccessibleByPet` returns an array
for accessible pets or null for inaccessible pets. `ListPetVeterinaryVisits` maps null
to `PetNotFoundError`; unexpected failures propagate. The Drizzle implementation uses
one SQL statement joining Pet, ACTIVE requester Membership, and a left join of visits.
Rows sort by `visit_date DESC`, `created_at DESC` (including PostgreSQL microseconds),
then `id DESC`, matching existing Health list tie ordering.

Reads take no row locks and do not update visit, pet, or membership timestamps. A read
may observe a snapshot preceding a concurrent commit. Committed membership revocation
removes access on subsequent reads; Archive/Restore preserves readable history. Existing
write locking and domain invariants remain unchanged. The existing non-unique
`(pet_id, visit_date DESC)` index and primary key are retained. `pnpm db:generate`
reports no schema changes, so this slice has no new migration or data rewrite.

Application tests cover reader delegation, order preservation, empty results, null and
unexpected failures. PostgreSQL tests cover authorization, archived reads, pet isolation,
duplicates beyond 20 rows, date/microsecond/UUID ordering, Archive/Restore, Leave/Remove,
unchanged timestamps and nonblocking reads before/after a locked writer commits. E2E
and OpenAPI tests verify exact response shapes, validation, authentication precedence,
authorization, deterministic ordering, and the 44-operation contract.

## Update (#44)

`PATCH /pets/{petId}/health/veterinary-visits/{visitId}` adds one operation, bringing
the API to 45 OpenAPI operations. Both path IDs must be non-nil UUIDs; query parameters
are rejected. The strict partial body requires at least one of `visitDate`, `reason`,
`diagnosis`, or `observations`. Omitted fields retain their stored values. Only diagnosis
and observations accept null to clear them. Record's date, normalization, nonempty text,
and Unicode code point limits apply to supplied values. Unknown fields, empty bodies,
wrong types, and null for required visit facts return `400 INVALID_REQUEST`.

ACTIVE owners and collaborators may correct visits on ACTIVE pets, regardless of original
authorship. Archived pets remain read-only. Authentication precedes structural validation,
including malformed JSON and JSON scalar parser failures. The transaction checks pet and
requester access before resolving the pet-scoped visit, then validates semantic values.
Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`; only authorized
requesters can receive `404 PET_VETERINARY_VISIT_NOT_FOUND` for absent or wrong-pet visits.
Field errors reuse Record's four `INVALID_VETERINARY_VISIT_*` codes. Success returns 200
with the same seven fields as Record, preserving ID, pet, and original author.

`PetVeterinaryVisit.correct` enforces correction invariants and returns the same instance
for an equivalent normalized result. Reconstitution validates stored dates structurally;
an omitted historical date is preserved even if beyond current UTC today, while an
explicit date is validated temporally. The application defers its existing Health Clock
to persistence, sampled once after Pet → requester Membership → Visit row locks under
READ COMMITTED. `correctIfPetWritable` returns `UPDATED`, `UNCHANGED`, `PET_NOT_FOUND`, or
`PET_VETERINARY_VISIT_NOT_FOUND`; unexpected failures propagate and roll back.

Real corrections update only editable visit fields. The existing trigger assigns
`updated_at` using `statement_timestamp()`; creation time, authorship, pet and membership
timestamps remain unchanged. No-ops issue no UPDATE, preserving timestamps and row version.
Concurrent partial corrections reconstitute the latest locked state and preserve each
other's fields. Archive, Restore, Leave and Remove serialize through the same Pet lock.
No schema change or new index is required. `pnpm db:generate` reports no changes; no new
migration is generated. PostgreSQL reports the retained history index as
`(pet_id, visit_date DESC NULLS LAST)`.

Domain tests cover corrections, explicit validation, Unicode boundaries, preservation,
null clearing and no-op identity. Application tests cover raw command/deferred Clock
orchestration, outcomes and error mapping. PostgreSQL tests cover rollback, access hiding,
physical no-ops, timestamps, duplicates, list ordering, UTC midnight after lock waits,
concurrent partial corrections and both serialization orders for access changes. E2E and
OpenAPI tests cover strict contracts, exact representations, error precedence, parser
authentication and the 45-operation contract.

## Delete (#45)

`DELETE /pets/{petId}/health/veterinary-visits/{visitId}` adds one operation,
bringing the API to 46 operations. It mirrors Medication's physical deletion:
permanently remove an erroneous record without history, tombstones or restoration.
Both IDs must be non-nil UUIDs. No query parameters are accepted; the body must be
absent or `{}`. Success returns `204 No Content` without a representation.

Authentication precedes HTTP validation, including malformed JSON and scalar parser
failures. Structural errors return `400 INVALID_REQUEST`; missing or invalid tokens
return `401 UNAUTHENTICATED`. ACTIVE owners and collaborators may delete regardless
of authorship, including after the original author leaves. Archived pets are read-only.
Missing, archived or inaccessible pets return `404 PET_NOT_FOUND` before target lookup.
An authorized missing, wrong-pet or already deleted visit returns
`404 PET_VETERINARY_VISIT_NOT_FOUND`. Repeated deletion preserves the absent state
but does not repeat the successful response; access is revalidated on every request.

`DeletePetVeterinaryVisit` delegates to the application-owned repository contract and
maps `DELETED`, `PET_NOT_FOUND` and `PET_VETERINARY_VISIT_NOT_FOUND`. Unexpected errors
propagate. The READ COMMITTED transaction locks Pet → requester Membership → Visit,
then deletes only the pet-scoped target using DELETE RETURNING. It does not reconstruct
or semantically validate stored visit facts. No domain deletion state is introduced.
Existing date, text, identity and independent-duplicate invariants remain unchanged.

Deletion makes no UPDATE: retained visits, pet and membership timestamps and row
versions remain unchanged. The removed row's technical timestamps disappear with it.
The existing List reader excludes committed deletions naturally; a concurrent read may
observe an earlier snapshot. Duplicate visits and other pets' visits remain intact.
No incoming foreign keys require cascading deletion. Existing primary key and history
indexes suffice; there is no schema change or migration.

Tests cover domain identity independence, application outcomes and unexpected failures,
physical deletion, list exclusion, authorization hiding, archived pets, repeat requests,
rollback and released locks, unchanged retained timestamps, Pet → Membership → Visit
locking, and both serialization orders against Update, Record, Archive, Leave and Remove.
E2E tests cover empty 204 responses, strict requests, authentication-first parser errors,
access hiding and list exclusion. OpenAPI tests assert the 46-operation contract.
