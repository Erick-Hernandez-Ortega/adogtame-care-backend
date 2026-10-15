# Pet veterinary visits

## Record (#42)

`POST /pets/{petId}/health/veterinary-visits` is the only veterinary visit operation.
The API now has 43 OpenAPI operations. A visit reports an encounter; it has independent
identity, allows duplicates, and has no lifecycle status. Diagnosis text does not create
or link a medical condition. Veterinarians, clinics, attachments, medication links,
reminders, and further visit operations are outside this slice.

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
outcomes are `CREATED` and `PET_NOT_FOUND`. Unexpected failures propagate. No reader is
introduced because this slice exposes no read operation.

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
chronological access without inventing a read contract or extra indexes.

`created_at` and `updated_at` default to PostgreSQL `now()` and start equal. A small SQL
addition to the generated migration attaches the existing `set_updated_at()` trigger,
matching other Health records; physical updates use `statement_timestamp()`. No new trigger
function, infrastructure, data backfill, dependency, or existing-row rewrite is introduced.

Unit tests exercise domain behavior and application orchestration. PostgreSQL tests cover
constraints, access, rollback, timestamps, preservation and both serialization orders for
Archive/Leave/Remove, observing `pg_blocking_pids` behind a Pet barrier without timing sleeps.
HTTP tests cover exact responses, Unicode limits, UTC boundaries, strict requests, errors
and authentication precedence. OpenAPI tests assert the new contract and operation count.
