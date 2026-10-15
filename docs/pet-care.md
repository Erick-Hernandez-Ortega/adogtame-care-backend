# Pet care

## Routine domain (#46)

Care owns routines (what should be done) and, in future slices, activities (what
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
canonical timezone returns the same instance. There is no HTTP PATCH route yet.

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
query. List, PATCH, activities, and missed-activity queries remain separate slices.

Application unit tests cover real aggregates, projection, normalization, domain
error translation, access outcomes and unexpected persistence failures. Integration
tests cover persisted projections, duplicates, authorization, rollback and released
locks, timestamps, Archive/Restore preservation, and both serialization orders for
Archive/Leave/Remove using observed PostgreSQL lock barriers. Existing schema tests
continue covering constraints and triggers. HTTP tests cover strict nested requests,
Unicode limits, timezone canonicalization, all types, frequencies, independent
duplicates, parser errors, authentication precedence, and access hiding. OpenAPI
tests assert the request/response/error schemas and 47-operation contract.
