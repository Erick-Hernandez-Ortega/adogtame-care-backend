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
unknown zones are rejected. The creator's timezone must be supplied when the
creation use case is introduced; the aggregate does not read a machine default or
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
`statement_timestamp()`. There are no persistence mutation adapters in this slice.

## Boundaries and verification

This slice exposes no endpoints and registers no empty Nest module, repository
ports, readers or application scaffolding. The existing 46-operation OpenAPI
contract remains unchanged. Future HTTP slices must authenticate before validation
(including parser errors), authorize using pet memberships, keep archived pets
read-only, and lock Pet → requester Membership → existing Care record for writes.
Authorization and locking belong at the application/persistence boundary, not in
this standalone routine aggregate.

Colocated domain tests cover creation, reconstitution, identity, invalid runtime
values, Unicode boundaries, frequency validation, defensive copying, and timezone
changes without shifting local suggestions. PostgreSQL integration tests cover the
generated schema's defaults, round trips, constraints and restrictive foreign keys.
No HTTP e2e tests are introduced before a vertical slice exists.

Reminders, notifications, attachments, stats and Adogtame integration remain V2.
