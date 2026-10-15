# API security and hardening (#53)

This review covers all 51 operations: three public operations (`GET /`, registration
and login) and 48 Bearer-protected operations. No dependency, external system,
database migration, CORS policy, retention rule or deployment change is introduced.

## Authorization review

| Boundary | Authorization and visibility |
| --- | --- |
| Identity | Registration and login are public. Passwords are hashed with Argon2id. Login does not distinguish an unknown email from a wrong password. Protected requests verify JWT signature/expiry and require a persisted account. |
| Pet lists, detail and members | ACTIVE membership grants access to ACTIVE and ARCHIVED pets. Member lists include only ACTIVE relationships. Missing pets, outsiders and inactive memberships share `404 PET_NOT_FOUND`. |
| Pet profile and owner administration | ACTIVE OWNER of an ACTIVE pet is required for profile changes, invitations, member removal and promotion. Access is checked before resolving another member. |
| Archive and Restore | ACTIVE OWNER is required; lifecycle retries are idempotent only after authorization. Restore is the deliberate archived-write exception. |
| Leave | Own historical membership is required, including on archived pets. Inactive retries succeed; the last active owner cannot leave. |
| Invitations | Accept/Reject require the authenticated recipient email to match the invitation; lifecycle and expiry rules remain unchanged. Cancel requires active owner access to the active pet. Acceptance cannot grant archived access. Current Identity has no email-verification workflow; hardening does not invent one. |
| Health and Care reads | ACTIVE OWNER or COLLABORATOR can read ACTIVE/ARCHIVED pets. Authorship does not grant continued access. Filters and empty/exhausted pages do not bypass membership checks. |
| Health and Care writes | ACTIVE OWNER or COLLABORATOR on ACTIVE pets. Archived pets are read-only. Pet authorization precedes record lookup; only authorized members can receive a record-specific 404. |

No new 403 distinction is introduced. Existing owner invariant conflicts and
invitation lifecycle outcomes remain unchanged. Recording retains existing domain
validation before persistence access; correction validates semantic values after
authorized locked loading. Structural HTTP validation follows authentication.

Mutations retain Pet → requester Membership → target record locks under READ COMMITTED.
Invitation operations retain their documented Invitation-first ordering where applicable;
see [Pet archive](pet-archive.md). No locking, timestamp, authorship or no-op write
behavior changes. Domain remains independent of NestJS, HTTP and Drizzle.

## Pagination

Every list now accepts optional `limit` (default 20, integer 1–100) and opaque
`cursor`, returning `{ items, nextCursor }`; the last page uses `nextCursor: null`.
This includes pets, members, allergies, conditions, medications, veterinary visits,
routines and activities, alongside the existing weight/vaccination history pages.
This replaces the former bare pet array and the former member `members` field.
Clients must follow `nextCursor` to retrieve complete collections.

Unknown, repeated, nested, noncanonical numeric limits and malformed cursors return
400 INVALID_REQUEST. The new cursors are canonical base64url versioned positions,
bounded to 2,048 characters and scoped to the list, account, pet and activity filters.
They are opaque continuation values, not credentials or signed authorization grants.
Every page rechecks access. Weight/vaccination retain their existing cursor format.
Limits may change between pages; filters must remain the same.

Ordering is preserved: pets by name/ID ascending; members by owner-first rank,
creation time/ID ascending; other lists use their existing descending date/creation
and ID ordering, including microseconds and condition dates with nulls last.
Readers apply keyset predicates and LIMIT (page size plus one) in PostgreSQL. Empty
pages retain an authorization sentinel. No unbounded application array is fetched
by a paginated endpoint. Activity local-day filters run before LIMIT, comparing
`completed_at AT TIME ZONE timezone` as a date in each record's stored IANA timezone.
Domain still derives the returned localDay. This preserves DST and inclusive bounds.

Pages use independent statement snapshots, without row locks or timestamp changes.
Concurrent insertions, deletions, renames, promotions or corrected ordering dates may
change later pages; pagination is not a historical snapshot. A deleted cursor record
does not invalidate its saved position. Existing indexes remain unchanged; large
histories may still require query-plan tuning, especially local-day filters.

## Input and resource bounds

The installed Nest Express adapter uses the parser's existing **100 KB** JSON and
URL-encoded body limit. It is retained, not increased. Oversized protected requests
now authenticate first and return 413 INVALID_REQUEST to authenticated callers.
Malformed/scalar JSON returns 400 INVALID_REQUEST after authentication. Missing or
invalid Bearer tokens take precedence with 401 UNAUTHENTICATED on every protected
operation, including GET and DELETE parser failures. Unknown routes are not added
to the authentication contract.

Health/Care domain text bounds remain unchanged: names/titles/reasons 255 Unicode
code points, ordinary notes/instructions 2,000, veterinary observations 5,000, and
existing medication dosage/frequency/reason bounds. HTTP shapes remain strict and
reject unexpected properties. Domain retains trimming, nonempty, date, timezone,
UUID and business validation. No clinical data moves into Pet Management.

Previously unbounded Pet profile transport strings now allow at most 255 trimmed
Unicode code points for name, breed name, color and microchip, and 2,000 for
distinctive marks. Raw UTF-16 input is also bounded to twice these values. Identity
and invitation transport email strings are capped at 508 UTF-16 units and password
inputs at 256, bounding work before normalization/hashing; these are transport
ceilings, not a change to email grammar or the registration password policy
(12–128 Unicode code points). No persisted text is rewritten.

Routine frequency now rejects more than 24 suggested times, more than seven weekdays,
and duplicates in either collection. Exact HH:mm and supported weekdays remain domain
rules; order, null/omission normalization, DAILY/WEEKLY semantics and independence
from timesPerPeriod remain unchanged. Creation, correction and reconstitution share
the value object. Existing invalid persisted suggestions require correction before
reconstitution; no silent deduplication or data migration is performed.

## Error handling and pending controls

Controllers expose explicit application errors. Unexpected exceptions propagate to
Nest's base filter, which returns the generic 500 Internal server error; stack traces,
SQL/constraint details and internal exception messages are not response fields.
The authentication-first parser filter uses fixed public messages and delegates all
other errors to the base filter. Server-side logging remains available.

Helmet and rate limiting are **not present**. Neither package is installed, and the
approved slice prohibits dependencies. Both remain pending; this review adds no
rate limits, custom replacement middleware, trusted proxy, CORS origins or security
header policy. Swagger remains available at /docs and /docs-json as before.

## Verification

Colocated unit tests cover routine limits/duplicates, page defaults, maximums,
opaque cursor round trips, invalid tokens, scope isolation, projections and use-case
orchestration. PostgreSQL list tests cover ordering, membership, archive preservation,
empty pages and histories beyond the default page size. HTTP tests cover page traversal,
cross-pet cursors and strict validation. api-security.e2e-spec.ts derives all protected
operations from OpenAPI and exercises missing/invalid/valid authentication against
malformed, scalar and oversized JSON, plus pagination and generic unexpected errors.
OpenAPI regression tests retain 51 operations and check paginated contracts.

Run pnpm lint, pnpm build, pnpm exec tsc --noEmit -p tsconfig.json and pnpm test.
Database tests require migrated PostgreSQL; HTTP tests require permission to bind
local sockets. A sandbox without those capabilities cannot verify their runtime results.
