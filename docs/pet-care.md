# Pet care

## Routine domain (#46)

Care owns routines (what should be done) and activities (what
actually happened). `CareRoutine` is an independent aggregate under
`src/care/domain`, referencing a pet and the original recording account by UUID.
It has no NestJS, Drizzle, HTTP or Health dependencies. Creation generates a UUID;
reconstitution preserves identity and validates the complete domain representation.

Routine types are FEEDING, WALK, HYGIENE and OTHER. Title is required, trimmed,
case-preserving text of 1–255 Unicode code points. Optional instructions normalize
omission/null to absence; supplied text must contain 1–2,000 Unicode code points
after trimming. These text bounds and UUID conventions follow Health names and
optional notes. Value objects own validation; the aggregate rejects invalid runtime
value objects rather than accepting transport or persistence representations.

Frequency has a DAILY or WEEKLY period and a positive safe integer
`timesPerPeriod`. Optional suggested times use exact 24-hour `HH:mm`, including
00:00 and 23:59. Optional weekdays apply only to WEEKLY and use the English
MONDAY through SUNDAY constants. Omitted/null collections become empty arrays;
input order is retained, and collections are defensively copied and frozen.
Suggestions do not impose an additional equality between their count and
`timesPerPeriod`; no duplicate rejection or scheduling algorithm is introduced.

Each routine requires an explicit IANA timezone, validated and canonicalized by
JavaScript Intl. UTC is supported; numeric offsets, surrounding whitespace and
unknown zones are rejected. The creator's timezone is supplied explicitly to the
creation use case; the aggregate does not read a machine default or
an account profile. `changeTimezone` returns a new aggregate while preserving
identity, authorship, frequency and its local wall-clock suggestions. An equivalent
canonical timezone returns the same instance. The HTTP PATCH route is introduced in #49 below.

An activity's occurrence will be stored as a UTC instant together with its
recorder's IANA timezone, with the day computed locally. Routine suggestions are
wall-clock values, not UTC instants. Activities and missed-activity queries are
outside #46: missed activities will be computed on query, never stored. This slice
makes no decisions about weekly query boundaries, matching activities to routines,
or historical schedule evaluation.

## Persistence

Git history introduces Medication and Veterinary Visit tables alongside their
initial domain implementations (commits `4e8821e` and `df00ebc`). Following that
precedent, `src/care/infrastructure/persistence/drizzle/care.schema.ts` declares
`care_routines`; migration `0018_blushing_justice.sql` and its metadata were generated
with `pnpm db:generate`, then extended with the timestamp trigger following Health's pattern.

The table has restrictive pet/account foreign keys, bounded text, supported type
and period checks, a positive safe-integer target check, valid one-dimensional
suggestion arrays without null elements, WEEKLY-only weekdays, and a nonempty
timezone check. IANA timezone validation and text normalization stay in Domain.
A bigint column avoids imposing PostgreSQL integer's smaller upper bound on the
TypeScript count. A non-unique pet index supports future pet-scoped access.

Technical `created_at` and `updated_at` are timestamptz columns defaulting to the
same transaction time, outside the aggregate as in Health. The migration attaches
the existing `set_updated_at()` trigger, matching Health; physical updates use
`statement_timestamp()`. The create adapter introduced in #47 uses these defaults without overriding timestamps.

## Boundaries and verification

The original #46 domain slice exposed no endpoints or application scaffolding.
#47 registers CareModule and its create endpoint as described below. Authorization
and locking belong at the application/persistence boundary, not in the standalone
routine aggregate. Future mutations of existing records must lock Pet → requester
Membership → Care record.

Colocated domain tests cover creation, reconstitution, identity, invalid runtime
values, Unicode boundaries, frequency validation, defensive copying, and timezone
changes without shifting local suggestions. PostgreSQL integration tests cover the
generated schema's defaults, round trips, constraints and restrictive foreign keys.
The #47 vertical slice adds HTTP e2e tests.

Reminders, notifications, attachments, stats and Adogtame integration remain V2.

## Create routine (#47)

`POST /pets/{petId}/care/routines` adds the 47th API operation. Authentication
precedes path/body/query validation, including malformed JSON and scalar parser
failures. The path requires a non-nil pet UUID and no query parameters are accepted.
The strict body requires `type`, `title`, `frequency` and `timezone`; optional
`instructions` accepts omission or null. The nested frequency object is also strict,
requiring `period` and numeric `timesPerPeriod`, with optional nullable arrays of
strings `suggestedTimes` and `weekdays`. Domain value objects enforce the rules
above; HTTP schemas enforce structure without duplicating domain validation.

The timezone is the creator's explicitly supplied timezone; there is no account
profile field or server fallback. Suggested times remain wall-clock values in that
zone. Creation neither converts suggestions to UTC instants nor creates activities.

Success is 201 with exactly `id`, `petId`, `type`, `title`, nullable `instructions`,
`frequency`, canonical `timezone`, and `recordedByAccountId` from authentication.
Frequency always includes `period`, `timesPerPeriod`, `suggestedTimes` and `weekdays`;
absent/null suggestions normalize to empty arrays. Technical timestamps stay in
persistence. Identical requests create independent routine identities, following
Health creation and the existing non-unique schema; no deduplication key is added.

Errors follow authentication (401 UNAUTHENTICATED), HTTP structure (400
INVALID_REQUEST), domain values (400 INVALID_ROUTINE_TYPE, INVALID_ROUTINE_TITLE,
INVALID_ROUTINE_INSTRUCTIONS, INVALID_ROUTINE_FREQUENCY, INVALID_ROUTINE_TIMEZONE),
then transactional access (404 PET_NOT_FOUND). Field validation proceeds in that
listed order. Domain validation precedes access, matching Health creation. Missing,
archived and inaccessible pets are indistinguishable; there is no 403 response.

CreateCareRoutine creates the existing aggregate and delegates to the
CareRoutineRepository port. Its createIfPetWritable outcomes are CREATED and
PET_NOT_FOUND; unexpected errors propagate. Drizzle authorizes ACTIVE OWNER or
COLLABORATOR membership and ACTIVE Pet atomically with INSERT under READ COMMITTED,
locking Pet then requester Membership. There is no existing routine row to lock.
Pet is the shared serialization point with Archive, Leave and Remove: an access
change committed first prevents creation; creation committed first remains stored.
Authorship does not grant enduring access. Archive/Restore preserve all routine
data and timestamps. Creation does not update pet or membership timestamps.

The existing care_routines schema, index, migration and timestamp trigger suffice;
no new schema change or migration is needed. No reader is introduced for POST:
the response projects the created aggregate, following Health, without a postcommit
query. Activities and missed-activity queries remain separate slices.
List is described below.

Application unit tests cover real aggregates, projection, normalization, domain
error translation, access outcomes and unexpected persistence failures. Integration
tests cover persisted projections, duplicates, authorization, rollback and released
locks, timestamps, Archive/Restore preservation, and both serialization orders for
Archive/Leave/Remove using observed PostgreSQL lock barriers. Existing schema tests
continue covering constraints and triggers. HTTP tests cover strict nested requests,
Unicode limits, timezone canonicalization, all types, frequencies, independent
duplicates, parser errors, authentication precedence, and access hiding. OpenAPI
tests assert the request/response/error schemas and 47-operation contract.

## List routines (#48)

`GET /pets/{petId}/care/routines` is the 48th API operation. The path requires a
non-nil UUID and the query must be empty: there are no filters, pagination, or
sorting parameters. Authentication precedes path/query validation and JSON parser
failures. Errors are 400 INVALID_REQUEST, 401 UNAUTHENTICATED and 404 PET_NOT_FOUND.

ACTIVE owners and collaborators may read ACTIVE or ARCHIVED pets. Missing pets,
outsiders and inactive members receive the same PET_NOT_FOUND, including original
recorders whose membership has ended. An accessible pet without routines returns
`200 { "items": [] }`. Each item contains exactly `id`, `type`, `title`, nullable
`instructions`, `frequency`, `timezone` and `recordedByAccountId`; pet identity
comes from the route and technical timestamps stay in persistence. Frequency
includes period, timesPerPeriod, suggestedTimes and weekdays, preserving order,
duplicates and empty arrays. Suggested times remain local HH:mm in the stored
IANA timezone; reading does not convert them to UTC or evaluate schedules.

Following Medication List, all routines are returned ordered by created_at DESC
(including PostgreSQL microseconds), then id DESC. Independent duplicates and
original authorship are preserved. No activities or missed occurrences are computed.

The application-owned CareRoutineReader.findAccessibleByPet returns an array or
null for inaccessible pets. ListCareRoutines maps null to PetNotFoundError and
propagates unexpected failures. Its Drizzle adapter uses one statement joining
Pet, ACTIVE requester Membership and a left join of routines. Reads take no row
locks and do not update any timestamps. They may observe a snapshot before a
concurrent writer commits; subsequent queries recheck access. Write locking remains
Pet → requester Membership → record, with no changes to existing writers.

The existing table, primary key and non-unique pet index suffice; no schema change,
`pnpm db:generate` confirms no schema changes, so no migration is generated. No
new infrastructure or domain rule is required. Application tests cover delegation,
order, empty results, inaccessible pets and failures. PostgreSQL tests cover member
access, archived reads, pet isolation, independent duplicates beyond 20 rows,
microsecond/UUID ordering, Archive/Restore, Leave/Remove, unchanged timestamps and
nonblocking snapshot reads. HTTP and OpenAPI tests cover exact representations,
strict paths/queries, authentication precedence and the 48-operation contract.


## Update routine (#49)

`PATCH /pets/{petId}/care/routines/{routineId}` is the 49th API operation.
Both IDs must be non-nil UUIDs; query parameters are rejected. The strict partial
body requires at least one of `type`, `title`, `instructions`, `frequency` or
`timezone`. Omitted fields retain their stored values. Only instructions accept
null to clear the value. A supplied frequency replaces the complete value using
the creation shape: period and timesPerPeriod are required; omitted/null suggestion
arrays become empty arrays. Creation's normalization, Unicode code point limits,
frequency rules and canonical IANA timezone validation apply to supplied values.
Changing timezone preserves local HH:mm suggestions without conversion.

Authentication precedes all HTTP validation, including malformed or scalar JSON.
Structural failures return 400 INVALID_REQUEST. ACTIVE owners and collaborators
may update ACTIVE pets regardless of authorship. Archived pets remain read-only.
Missing, archived or inaccessible pets return 404 PET_NOT_FOUND before target lookup;
authorized missing or wrong-pet routines return 404 CARE_ROUTINE_NOT_FOUND before
semantic validation. Semantic errors reuse creation's five INVALID_ROUTINE_* codes.
Success returns 200 with the same eight fields as Create, preserving identity,
pet and original author. Technical timestamps remain private.

CareRoutine.correct owns validation and immutable corrections, returning the same
instance for equivalent normalized data. Array order and duplicates remain significant.
UpdateCareRoutine forwards raw values through the application-owned repository port,
maps UPDATED/UNCHANGED, PET_NOT_FOUND and CARE_ROUTINE_NOT_FOUND outcomes, projects
the aggregate and translates typed domain failures. Unexpected failures propagate.
The Drizzle adapter uses READ COMMITTED and locks Pet → requester Membership →
pet-scoped Routine before reconstitution and correction. Concurrent partial updates
therefore use the latest locked state and preserve one another's omitted fields.
Archive, Leave and Remove serialize on the same Pet lock.

Real corrections update only editable fields; the existing trigger assigns
updated_at with statement_timestamp(). Creation time, original authorship, pet and
membership timestamps stay unchanged. No-ops perform no UPDATE, preserving physical
row version and timestamps. List ordering stays based on creation time and ID.
The existing schema and index suffice; pnpm db:generate reports no changes.
No migration, dependency or infrastructure is introduced.

No deactivation capability is added: Care routines have no existing lifecycle state
or approved transition rules. Medication's reported clinical closure is specific to
that aggregate and does not establish routine deactivation semantics. Activities,
missed-activity evaluation and all V2 capabilities remain outside this slice.

Domain and application unit tests cover corrections, preservation, no-op identity,
frequency replacement and error mapping. PostgreSQL tests cover physical no-ops,
rollback, timestamps, access hiding, concurrent partial corrections and both lock
orders with Archive/Leave/Remove. HTTP and OpenAPI tests cover exact representations,
strict requests, Unicode limits, authentication-first parser failures, membership
access, archived writes, wrong-pet targets and the 49-operation contract.


## Complete activity (#50)

`POST /pets/{petId}/care/routines/{routineId}/activities` is the 50th API operation.
A routine describes what should be done; each independent `CareActivity` aggregate
records an actual completion. No routine lifecycle transition or schedule evaluation
occurs. The activity references the pet, routine and authenticated completing account.
It does not copy the routine's profile or suggestions. Identical submissions create
independent identities, matching Health creation semantics; no idempotency key exists.

The strict body requires `completedAt` and `timezone`; optional `notes` accepts
omission/null. Both path IDs must be non-nil UUIDs and queries are rejected. completedAt
uses a valid Gregorian date in years 0001–9999 followed by UTC `THH:mm:ss[.SSS]Z`,
with 1–3 fractional digits when present. Offsets, local timestamps, leap seconds,
invalid calendar dates and surrounding whitespace are rejected. Domain normalizes to
UTC ISO milliseconds and rejects instants after the single current Clock sample,
including one millisecond into the future. Reconstitution validates structure without
consulting the Clock. Technical creation time is distinct from completion time.

Activity timezone is the recorder's explicitly supplied IANA zone, canonicalized by
Intl using the routine timezone validation convention. It is independent of routine
timezone and later changes to routine suggestions. The domain computes `localDay`
from completedAt in this stored zone, including daylight saving rules. No local day
column is stored. Notes follow Health's optional notes convention: trimmed,
case-preserving, nonempty text up to 2,000 Unicode code points when supplied.

Success returns 201 with exactly id, petId, routineId, completedAt, completedBy,
timezone and nullable notes. completedBy comes exclusively from authentication.
The response projects the created aggregate without a reader or postcommit lookup;
localDay and technical timestamps are omitted. No activity listing is added.

Authentication precedes HTTP validation, including parser failures. Structural errors
are 400 INVALID_REQUEST. Domain validation proceeds through completedAt, timezone,
then notes, before persistence authorization, matching Health recording. Semantic errors
are 400 INVALID_ACTIVITY_COMPLETED_AT, INVALID_ACTIVITY_TIMEZONE and
INVALID_ACTIVITY_NOTES. Missing/invalid tokens return 401 UNAUTHENTICATED.
ACTIVE owners and collaborators may record regardless of routine authorship. Missing,
archived or inaccessible pets return 404 PET_NOT_FOUND before routine lookup; an
authorized missing or wrong-pet routine returns 404 CARE_ROUTINE_NOT_FOUND.
No new collaborator permissions are introduced.

CompleteCareActivity owns orchestration through CareActivityRepository and a Care-owned
Clock. The adapter returns CREATED, PET_NOT_FOUND or CARE_ROUTINE_NOT_FOUND; unexpected
failures propagate and roll back. READ COMMITTED locks Pet → requester Membership →
pet-scoped Routine → INSERT. There is no existing activity row to lock. Archive, Leave,
Remove and routine updates serialize on Pet; an access change committed first denies
recording, while an activity committed first remains preserved. No pet, membership or
routine UPDATE occurs. Authorship does not grant enduring access.

`pnpm db:generate` generated 0019_mysterious_thena.sql and metadata. care_activities
has restrictive pet, routine and completing-account foreign keys, a UTC timestamptz,
required timezone, bounded optional notes, complementary nonempty/range checks and a
non-unique pet/routine index. Pet-scoped routine consistency is checked under locks.
Future-instant and IANA validation stay in Domain. created_at and updated_at default
to transaction now() and begin equal; the appended set_updated_at() trigger follows
0017 and uses statement_timestamp() for physical updates. No existing data is rewritten.
Archive/Restore preserves activities and their timestamps.

Domain tests cover identity, reconstitution, UTC boundaries, invalid runtime values,
Unicode notes, timezone canonicalization and local days including DST. Application
tests cover projection, single Clock sampling, errors, outcomes and unexpected failures.
Integration tests cover persistence, constraints, rollback, timestamps, preservation,
authorization and both serialization orders with Archive/Leave/Remove using observed
PostgreSQL lock barriers. HTTP and OpenAPI tests cover exact responses, independent
duplicates, strict bodies, wrong-pet targets, authentication-first parsing and 50 operations.

Missed activities remain computed on query in a future slice, never persisted. No
matching to suggested times, historical schedule rules, weekly query boundaries,
reminders, notifications, attachments, stats or Adogtame integration are introduced.
