# Adogtame Care Backend

**English** | [Español](README.es.md)

Adogtame Care backend built with NestJS, TypeScript, PostgreSQL, and Drizzle
ORM.

## Requirements

- Node.js
- pnpm
- Docker with Docker Compose

## Setup

Install the dependencies and create the local environment file:

```bash
pnpm install
cp .env.example .env
```

Configuration is validated when the application starts. `DATABASE_URL` must
use the `postgres://` or `postgresql://` protocol.

## Local PostgreSQL

Start PostgreSQL 18 and wait until the container is healthy:

```bash
pnpm db:up
pnpm db:migrate
```

Available commands:

| Command          | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm db:up`     | Starts PostgreSQL and waits for its healthcheck.                     |
| `pnpm db:down`   | Stops the containers while preserving the volume.                    |
| `pnpm db:status` | Shows the PostgreSQL service status.                                 |
| `pnpm db:logs`   | Follows the PostgreSQL logs.                                         |
| `pnpm db:check`  | Starts the NestJS context and checks the connection with `SELECT 1`. |

The credentials in `.env.example` and `compose.yaml` are intended exclusively
for local development.

## Development

```bash
pnpm start:dev
```

The API listens on the port defined by `PORT`.

## Running and deploying

Use Node.js 20 or later, compatible with NestJS 11. Supply process environment
variables or a `.env` file before startup:

| Variable | Rule | Default |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test` or `production` | `development` |
| `PORT` | Integer from 1 to 65535 | `3000` |
| `DATABASE_URL` | `postgres://` or `postgresql://` URL | Required |
| `JWT_ACCESS_TOKEN_SECRET` | At least 32 characters; generate a random secret | Required |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Positive integer | `3600` |

The secret in `.env.example` is intentionally empty; set it before running.
Process variables override `.env`. Invalid configuration prevents startup and
reports only invalid variable names.

For a generic deployment, set `NODE_ENV=production`, a remote Neon database URL
with Neon's supplied TLS settings, and an environment-specific secret. In the
preparation stage install from the lockfile and build; apply reviewed migrations
once before starting the compatible release:

```bash
pnpm install --frozen-lockfile --prod=false
pnpm lint
pnpm test
pnpm build
pnpm db:migrations:check
pnpm db:migrate
pnpm db:check
pnpm start:prod
```

Build and migration tooling require development dependencies in the preparation
stage. Runtime requires `dist/` and production dependencies. Public `GET /health`
executes `SELECT 1` and returns `200 {"status":"ok"}` or
`503 {"code":"DATABASE_UNAVAILABLE","message":"Database is unavailable"}`.
Check this route after startup; an open port does not prove database connectivity
or applied migrations. `GET /` retains its welcome message.

Logs use Nest's built-in Logger in JSON format. SIGINT/SIGTERM invoke Nest shutdown,
close the HTTP server and PostgreSQL pool; the process manager must forward the
signal to Node and allow shutdown to finish. SIGKILL cannot shut down gracefully.
No deployment provider, CORS policy, retention or rate limits are configured.
Helmet and rate limiting remain pending because they need new dependencies.
See [Production readiness](docs/production-readiness.md).

## API documentation

Open Swagger UI at `http://localhost:3000/docs` (use your configured `PORT` if
different). The OpenAPI JSON is at `/docs-json`. Both are available in every
environment.

To try protected routes, register with `POST /accounts` if needed, then call
`POST /auth/login` with your email and password. Copy `accessToken` from the
response, click **Authorize** in Swagger, and enter the token. Swagger adds the
Bearer prefix to requests automatically.

The API exposes 53 operations.

All list endpoints accept optional `limit` (default 20, maximum 100) and opaque
`cursor`; responses use `{ items, nextCursor }`. Pass `nextCursor` for the next
page; null means the final page. Pet lists now wrap the previous array in `items`,
and member lists use `items` instead of `members`. Routine suggested times allow
at most 24 unique entries, weekdays at most seven unique entries. Authentication
precedes body parser errors on every protected operation; the existing 100 KB body
limit is retained. See [API security](docs/api-security.md) for limits, authorization,
error handling and pending Helmet/rate limiting.


| Route                                         | Description             | Bearer token |
| --------------------------------------------- | ----------------------- | ------------ |
| `GET /`                                       | Welcome message         | No           |
| `GET /health` | Check PostgreSQL connectivity | No |
| `POST /accounts`                              | Register account        | No           |
| `POST /auth/login`                            | Get access token        | No           |
| `GET /pets`                                   | List accessible pets    | Yes          |
| `GET /pets/{petId}`                           | Get pet profile         | Yes          |
| `GET /pets/{petId}/members`                   | List current pet members | Yes         |
| `DELETE /pets/{petId}/members/{membershipId}` | Remove pet member access | Yes |
| `POST /pets/{petId}/members/{membershipId}/promote` | Promote collaborator to owner | Yes |
| `PATCH /pets/{petId}`                         | Correct pet profile     | Yes          |
| `POST /pets`                                  | Register pet            | Yes          |
| `POST /pets/{petId}/invitations`              | Invite collaborator     | Yes          |
| `POST /pets/{petId}/archive` | Archive a pet | Yes |
| `POST /pets/{petId}/restore` | Restore a pet | Yes |
| `POST /pets/{petId}/leave`                    | Leave a pet   | Yes          |
| `POST /pets/{petId}/care/routines` | Create a care routine | Yes |
| `GET /pets/{petId}/care/routines` | List care routines | Yes |
| `GET /pets/{petId}/care/activities` | List care activity history | Yes |
| `GET /pets/{petId}/care/summary` | Summarize expected and completed care | Yes |
| `PATCH /pets/{petId}/care/routines/{routineId}` | Update a care routine | Yes |
| `POST /pets/{petId}/care/routines/{routineId}/activities` | Record a completed care activity | Yes |
| `POST /pets/{petId}/health/veterinary-visits` | Record a veterinary visit | Yes |
| `GET /pets/{petId}/health/veterinary-visits` | List veterinary visit history | Yes |
| `PATCH /pets/{petId}/health/veterinary-visits/{visitId}` | Correct a registered veterinary visit | Yes |
| `DELETE /pets/{petId}/health/veterinary-visits/{visitId}` | Delete a registered veterinary visit | Yes |
| `POST /pets/{petId}/health/medications` | Record indicated pet medication | Yes |
| `GET /pets/{petId}/health/medications` | List registered pet medications | Yes |
| `PATCH /pets/{petId}/health/medications/{medicationId}` | Update registered pet medication information | Yes |
| `DELETE /pets/{petId}/health/medications/{medicationId}` | Delete an erroneous medication record | Yes |
| `POST /pets/{petId}/health/medications/{medicationId}/complete` | Report medication completion | Yes |
| `POST /pets/{petId}/health/medications/{medicationId}/discontinue` | Report medication discontinuation | Yes |
| `POST /pets/{petId}/health/medications/{medicationId}/reopen` | Correct an erroneous medication closure | Yes |
| `POST /pets/{petId}/health/medical-conditions` | Record a known current medical condition | Yes |
| `GET /pets/{petId}/health/medical-conditions` | List registered medical conditions | Yes |
| `PATCH /pets/{petId}/health/medical-conditions/{conditionId}` | Correct registered medical condition information | Yes |
| `POST /pets/{petId}/health/medical-conditions/{conditionId}/resolve` | Resolve an active medical condition | Yes |
| `POST /pets/{petId}/health/medical-conditions/{conditionId}/reopen` | Correct an erroneous medical condition resolution | Yes |
| `DELETE /pets/{petId}/health/medical-conditions/{conditionId}` | Delete an erroneous medical condition record | Yes |
| `POST /pets/{petId}/health/allergies` | Record a known pet allergy | Yes |
| `GET /pets/{petId}/health/allergies` | List known pet allergies | Yes |
| `PATCH /pets/{petId}/health/allergies/{allergyId}` | Correct a known pet allergy | Yes |
| `DELETE /pets/{petId}/health/allergies/{allergyId}` | Delete an erroneous allergy record | Yes |
| `POST /pets/{petId}/health/weight-records`    | Record pet weight (kg)  | Yes          |
| `GET /pets/{petId}/health/weight-records`     | List pet weight history | Yes          |
| `PATCH /pets/{petId}/health/weight-records/{weightRecordId}` | Correct pet weight record | Yes |
| `DELETE /pets/{petId}/health/weight-records/{weightRecordId}` | Delete pet weight record | Yes |
| `POST /pets/{petId}/health/vaccination-records` | Record pet vaccination | Yes |
| `GET /pets/{petId}/health/vaccination-records` | List pet vaccination history | Yes |
| `PATCH /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` | Correct vaccination record | Yes |
| `DELETE /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` | Delete vaccination record | Yes |
| `POST /pet-invitations/{invitationId}/accept` | Accept invitation       | Yes          |
| `POST /pet-invitations/{invitationId}/reject` | Reject invitation       | Yes          |
| `POST /pet-invitations/{invitationId}/cancel` | Cancel invitation       | Yes          |

To record a veterinary visit, send `POST /pets/{petId}/health/veterinary-visits` with a Bearer token and a strict body such as `{"visitDate":"2026-03-14","reason":"Annual checkup","diagnosis":null,"observations":"Routine examination completed."}`. Active owners and collaborators of ACTIVE pets receive `201` with exactly `id`, `petId`, `visitDate`, `reason`, nullable `diagnosis`, nullable `observations`, and `recordedByAccountId`. Visit date is required, must be a complete valid calendar date no later than today UTC, and is distinct from technical creation time. Reason is required and trimmed (255 Unicode code points); optional diagnosis (2,000) and observations (5,000) accept omission/null but must be nonempty after trimming when supplied. Duplicate visits are independent records. No query parameters are accepted. Authentication precedes HTTP validation; domain validation precedes transactional access. Structural errors return `400 INVALID_REQUEST`; field errors return `400 INVALID_VETERINARY_VISIT_REASON`, `INVALID_VETERINARY_VISIT_DATE`, `INVALID_VETERINARY_VISIT_DIAGNOSIS`, or `INVALID_VETERINARY_VISIT_OBSERVATIONS`. Missing/invalid tokens return `401 UNAUTHENTICATED`; missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`. See [veterinary visits](docs/pet-veterinary-visits.md) for persistence and consistency details.

Correct a registered visit with `PATCH /pets/{petId}/health/veterinary-visits/{visitId}`, supplying at least one of `visitDate`, `reason`, `diagnosis`, or `observations`. Omitted fields are preserved; null clears diagnosis or observations. ACTIVE owners and collaborators may correct visits on ACTIVE pets regardless of original authorship. Authorization and target resolution precede semantic validation. Missing or wrong-pet visits return `404 PET_VETERINARY_VISIT_NOT_FOUND`; archived or inaccessible pets return `404 PET_NOT_FOUND`. Success returns `200` with the complete representation; normalized no-ops preserve timestamps. See [veterinary visits](docs/pet-veterinary-visits.md).

Delete an erroneous registered visit with `DELETE /pets/{petId}/health/veterinary-visits/{visitId}`, a Bearer token, no query parameters, and no body or `{}`. ACTIVE owners and collaborators of ACTIVE pets may delete regardless of authorship. Physical deletion is permanent without history or restoration; List excludes the deleted visit. Success returns an empty `204`; an authorized retry returns `404 PET_VETERINARY_VISIT_NOT_FOUND`. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND` before visit lookup. Authentication precedes all HTTP validation, including JSON parser failures. See [veterinary visits](docs/pet-veterinary-visits.md).

To list all veterinary visits, use `GET /pets/{petId}/health/veterinary-visits` with a Bearer token and optional `limit`/`cursor`. ACTIVE owners and collaborators may read ACTIVE or ARCHIVED pets. It returns `200 { "items": [...], "nextCursor": null }` with `id`, `visitDate`, `reason`, nullable `diagnosis`, nullable `observations`, and `recordedByAccountId`; technical timestamps and `petId` are omitted. Order is visit date, creation timestamp, then ID descending. An accessible pet without visits returns `items: []`. Invalid UUIDs or queries return `400 INVALID_REQUEST`; missing or inaccessible pets return `404 PET_NOT_FOUND`; missing/invalid tokens return `401 UNAUTHENTICATED`.

To archive a pet, send `POST /pets/{petId}/archive` as an active owner. Success is `204 No Content`, including retries on an archived pet after owner authorization is checked again. A retry performs no UPDATE and preserves `pets.updated_at`; a real transition changes it through the existing database trigger. Archive preserves the profile, memberships, pending invitations, and Health history. Collaborators, inactive members, absent memberships, and missing pets receive `404 PET_NOT_FOUND`. The pet ID must be a non-nil UUID. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`.

To restore an archived pet, send `POST /pets/{petId}/restore` as an active owner. Archive transitions `ACTIVE → ARCHIVED`; Restore transitions `ARCHIVED → ACTIVE`. Both return `204 No Content` and are idempotent after active owner authorization: an authorized retry performs no UPDATE or timestamp change. Restore preserves profile, memberships (including inactive members), all invitation states and expiration dates, and Health history. A pending, unexpired invitation can be accepted again under the existing acceptance rules; expired invitations are not revived. Restore uses the same Bearer, non-nil UUID, empty query and absent/empty body contract and `400 INVALID_REQUEST`, `401 UNAUTHENTICATED`, and `404 PET_NOT_FOUND` errors as Archive.

`GET /pets` includes active and archived pets with an active requester membership and exposes `status` in each summary. `GET /pets/{petId}` also permits both states for active members. Archived pets remain readable through Members and Health history, and Leave remains available. Profile updates, invitations, member removal/promotion, and all Health writes require an active pet. Pending invitations are preserved; accepting a pending, unexpired invitation for an archived pet returns `409 INVITATION_NOT_ACCEPTABLE` without granting access. Cancellation requires an active pet; rejection remains available according to the invitation lifecycle. See [pet archive](docs/pet-archive.md) for lock ordering and concurrency.

To list current members, send `GET /pets/{petId}/members` with a Bearer token and no body and optional `limit`/`cursor`. Active owners and collaborators can read active or archived pets. The complete `200` response is `{"items":[{"membershipId":"...","accountId":"...","email":"owner@example.com","role":"OWNER"}],"nextCursor":null}`. Only active memberships are included, across all pages; pending invitations are excluded. Owners appear first, followed by collaborators, with each role ordered by membership creation time and then membership ID ascending. An invalid or nil UUID or unexpected query parameter returns `400 INVALID_REQUEST`; a missing or invalid token returns `401 UNAUTHENTICATED`. Missing pets, absent memberships, and inactive requester memberships return `404 PET_NOT_FOUND`.

To remove another pet member, send `DELETE /pets/{petId}/members/{membershipId}` as an active owner of an active pet. Identify the target by the persistent `membershipId` returned by List Pet Members. Both owners and collaborators can be removed; only status changes to `INACTIVE`, preserving the membership ID, account ID, role, and creation time. Success is `204` without a response body, including retries on another inactive owner or collaborator. A retry performs no UPDATE and preserves `updated_at`; a real transition changes `updated_at`. Self-removal returns `409 SELF_REMOVAL_NOT_SUPPORTED`, even for the last owner; use `POST /pets/{petId}/leave`. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND` before target resolution or idempotence. Only after owner authorization does a missing target or one from another pet return `404 PET_MEMBER_NOT_FOUND`. Authorization is checked again on every retry. Both path IDs must be valid non-nil UUIDs. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`. The domain retains `LAST_OWNER_CANNOT_BE_REMOVED` as an internal defensive outcome, not a normal HTTP case: an authorized requester distinct from the target remains an active owner. See [member removal](docs/pet-member-removal.md) for the transaction protocol and concurrency behavior.

To promote a collaborator, send `POST /pets/{petId}/members/{membershipId}/promote` as an active owner of an active pet. An active collaborator becomes an active owner in the same membership, retaining its membership ID, account ID, and creation time. An active owner, including the requester, returns `204` without an UPDATE or `updated_at` change. An inactive member returns `409 PET_MEMBER_INACTIVE` and is not reactivated. A missing, archived, or inaccessible pet returns `404 PET_NOT_FOUND` before target resolution; a missing member or one from another pet then returns `404 PET_MEMBER_NOT_FOUND`. Both path IDs must be non-nil UUIDs. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`.

To correct a pet profile, send `PATCH /pets/{petId}` as an active owner of an active pet. Include at least one of `name`, `species`, `breed`, `sex`, `birthInformation`, `color`, `distinctiveMarks`, or `microchip`. The nested `breed` and `birthInformation` objects use the same complete shapes as registration. Omitted fields are preserved; send `null` to clear `color`, `distinctiveMarks`, or `microchip`. The `200` response has the same shape as `GET /pets/{petId}`, with `role: "OWNER"`. A normalized no-op does not change `updated_at`. Invalid request structure returns `400 INVALID_REQUEST`; domain-invalid values return `422 INVALID_PET`. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`.

To record indicated medication, send `POST /pets/{petId}/health/medications` with Bearer and JSON such as `{"name":"Amoxicillin","dosage":"250 mg","frequency":"Every 12 hours","startDate":"2026-10-10","plannedEndDate":"2026-10-17","notes":"Give with food"}`. `PetMedication` is an independent Health aggregate representing reported indication information. It does not verify prescriptions, interpret dosage or frequency, record administered doses, or establish adherence or clinical effectiveness. A new indication, including a real restart of the same medication, is another independent record; identical records are allowed.

Name is required, trimmed, preserves casing, and permits 1–255 Unicode code points. Dosage, frequency and notes are nullable free text with 1–2,000 Unicode code points after trimming. Omission or null means unknown/absent; supplied empty or whitespace-only text is invalid. `startDate` is the indicated or reported start, not evidence of administration. `plannedEndDate` is exclusively the planned end. Each is independently nullable and may be future. Dates use complete civil `YYYY-MM-DD` within `0001-01-01`–`9999-12-31`; when both exist, `plannedEndDate >= startDate`. No date defaults to today and no lifecycle transition follows automatically from a date.

Record returns `201` with `id`, `petId`, `name`, `dosage`, `frequency`, `startDate`, `plannedEndDate`, `notes`, `recordedByAccountId`, `status`, `endedDate`, and `discontinuationReason`, including explicit nulls. The authenticated recorder is historical authorship, not exclusive permission. Record accepts only indication fields and creates `OPEN` with null closure data. OPEN means **no closure recorded**, even when the indicated start is future or unknown; it does not assert current medication use. COMPLETED and DISCONTINUED describe reported closure, not clinical confirmation.

To report completion, send `POST /pets/{petId}/health/medications/{medicationId}/complete` with a required strict body `{"endedDate":"2026-10-11"}` or `{"endedDate":null}` when unknown. To report discontinuation, send `POST /pets/{petId}/health/medications/{medicationId}/discontinue` with required nullable `endedDate` and optional nullable `discontinuationReason`. A supplied reason is trimmed, nonempty text with at most 2,000 Unicode code points. Both actions return the complete medication with `200`, preserve identity and original authorship, and retain the record in List. Known closure dates cannot be future (today UTC). Completion requires `endedDate >= startDate` when both are known, but can be reported without a known start. Discontinuation may precede the indicated start because an indication may be withdrawn before starting. Neither closure date is ordered against plannedEndDate; reported completion need not match the plan.

Equivalent repeated closure reports return `200` without a physical UPDATE or timestamp change. A different normalized report on the same closed state or the other type of closure returns `409 PET_MEDICATION_LIFECYCLE_CONFLICT`. Supplied invalid dates are still rejected; they are not ignored on retries. Correct date/reason through PATCH, or correct closure type by Reopen followed by the intended closure action.

To correct an erroneous closure, send `POST /pets/{petId}/health/medications/{medicationId}/reopen` with no body or `{}`. It returns the complete medication with `200`, transitions to OPEN and clears endedDate and discontinuationReason. An OPEN retry performs no UPDATE. **Previous closure data is permanently removed; no transition history or audit is preserved.** Reopen is a correction, not a real restart. Idempotence is relative to current state: a delayed closure retry after Reopen can close again, and a delayed Reopen after another closure can clear that closure. No command identity or idempotency keys are implemented.

To correct information, send `PATCH /pets/{petId}/health/medications/{medicationId}` with a strict nonempty partial body. Accepted fields are `name`, `dosage`, `frequency`, `startDate`, `plannedEndDate`, `notes`, `endedDate`, and `discontinuationReason`; status cannot be patched. Omission preserves values and null clears optional fields; name cannot be null. Supplying endedDate on OPEN or discontinuationReason outside DISCONTINUED, even null, returns `409 PET_MEDICATION_LIFECYCLE_CONFLICT`. PATCH preserves status and validates the entire resulting interval and completion chronology. A newly supplied non-null ending is checked against today UTC; preserved historical dates are not time-validated. Equivalent corrections return `200` without UPDATE or timestamp changes.

To delete an erroneous record in any lifecycle state, send `DELETE /pets/{petId}/health/medications/{medicationId}` without a body or with `{}`. Success is `204`; an authorized second DELETE returns `404 PET_MEDICATION_NOT_FOUND`. **Hard deletion is permanent without deletion history or restoration.** Delete does not report completion or discontinuation.

To list medications, send `GET /pets/{petId}/health/medications`. The `200` response is `{"items":[...]}`, including all lifecycle states and independent duplicates. Items have the same fields as mutation responses except petId; technical timestamps are omitted. Unknown fields are explicit nulls. An accessible pet with no medications returns `{"items":[]}`. Ordering remains `created_at DESC, id DESC`; lifecycle and dates do not determine visibility or ordering. Optional limit and cursor paginate results; no other filters are supported.

ACTIVE OWNER and COLLABORATOR memberships can write medication records of ACTIVE pets, regardless of recordedByAccountId, including after the author leaves. They can read ACTIVE or ARCHIVED pets. Archived pets are read-only and Archive/Restore does not change medication lifecycle. All routes require non-nil UUIDs and reject query parameters. Errors follow authentication (`401 UNAUTHENTICATED`), HTTP structure (`400 INVALID_REQUEST`, including malformed JSON), Pet/access (`404 PET_NOT_FOUND`), medication lookup (`404 PET_MEDICATION_NOT_FOUND`), then domain validation or conflict. Domain errors use the existing medication field codes plus `INVALID_MEDICATION_ENDED_DATE` and `INVALID_MEDICATION_DISCONTINUATION_REASON` (400). There is no 403.

Writes use READ COMMITTED locks Pet → requester Membership → Medication (Record creates after access checks). Domain rules apply to the locked current record. Archive, Leave/Remove, PATCH, Delete and transitions serialize through Pet; failed writes roll back and release locks. Closure operations update only lifecycle columns; PATCH preserves status. Physical changes invoke the existing updated_at trigger; no-ops preserve timestamps. List uses one SQL statement without row locks and may observe an earlier snapshot if it began before a change committed. The migration gives existing records OPEN/null closure fields without inferring facts from notes or dates or rewriting timestamps. Only the existing non-unique pet_id index and primary key are retained. See [medication lifecycle](docs/pet-medication-lifecycle.md) for deployment and compatibility notes.

To record a known current medical condition, send `POST /pets/{petId}/health/medical-conditions` with a Bearer token and JSON such as `{"name":"Epilepsy","diagnosedDate":"2026-03-14","notes":"Recurring seizures monitored by veterinarian."}`. Active owners and collaborators of active pets receive `201` with exactly `id`, `petId`, `name`, `status`, nullable `diagnosedDate`, nullable `resolvedDate`, nullable `notes`, and `recordedByAccountId`. Each condition has independent identity. The lifecycle distinguishes `ACTIVE` from `RESOLVED`, but Record always creates `ACTIVE` and does not accept client-supplied status or already resolved conditions. ACTIVE means a currently reported condition, not a severity or professional certification. `diagnosedDate` is the exact known date of the reported diagnosis, not symptom onset or when the owner learned about it; it does not certify a professional diagnosis. It accepts a valid complete `YYYY-MM-DD` calendar date no later than today UTC. Omit it or send null if unknown or only approximate; there is no date accuracy or partial-date field. Name is required, trimmed, preserves casing, and permits up to 255 Unicode code points. Notes are optional, trimmed, and permit up to 2,000 Unicode code points; omission/null mean absence, while present empty or whitespace-only text is invalid. Names do not define clinical identity: duplicates are allowed with distinct IDs, without a catalog or automatic deduplication. Authorship identifies the authenticated recording account, not a veterinarian or an enduring authorization grant. The body is strict and no query parameters are accepted. Authentication precedes HTTP validation, including malformed JSON; domain values are validated before transactional access. Structural/path/query errors return `400 INVALID_REQUEST`; semantic errors return `400 INVALID_MEDICAL_CONDITION_NAME`, `INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE`, or `INVALID_MEDICAL_CONDITION_NOTES`. Missing/invalid authentication returns `401 UNAUTHENTICATED`; missing/archived pets, inactive memberships, or absence of membership return `404 PET_NOT_FOUND`. Authorization and INSERT are atomic under READ COMMITTED locks Pet → requester Membership. Technical timestamps remain in persistence; Archive/Restore preserve conditions and timestamps. Record, List, Update, Resolve, Reopen, and Delete are available for medical conditions. No generic severity, treatments, medication relationships, or veterinarian relationships are included in medical conditions.

To correct registered medical condition information, send `PATCH /pets/{petId}/health/medical-conditions/{conditionId}` with a Bearer token and at least one of `name`, `diagnosedDate`, or `notes`, for example `{"name":"Osteoarthritis","diagnosedDate":"2026-02-10","notes":"Confirmed during veterinary examination."}`. Omitted fields are preserved; `diagnosedDate: null` clears the known diagnosis date and `notes: null` clears notes. `name: null` is invalid. Name and notes retain their existing trimming, Unicode limits, and nonempty-text rules. Both ACTIVE and RESOLVED conditions can be corrected; identity, original author, and clinical status are preserved. Update does not Resolve or Reopen, create another condition, or add history. The complete `200` response contains exactly `id`, `petId`, `name`, `status`, nullable `diagnosedDate`, nullable `resolvedDate`, nullable `notes`, and `recordedByAccountId`. A normalized no-op returns the current representation without a physical UPDATE or timestamp change.

Active owners and collaborators of an ACTIVE pet may correct another account's record, including after that author leaves. Archived pets remain read-only. Both path IDs must be non-nil UUIDs; the partial body is strict and no query parameters are accepted. Error precedence is authentication (`401 UNAUTHENTICATED`), HTTP structure (`400 INVALID_REQUEST`), writable Pet and requester access (`404 PET_NOT_FOUND`), target matching both condition ID and pet ID (`404 PET_MEDICAL_CONDITION_NOT_FOUND`), then semantic validation using the existing `400 INVALID_MEDICAL_CONDITION_NAME`, `INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE`, and `INVALID_MEDICAL_CONDITION_NOTES` codes. READ COMMITTED locks follow Pet → requester Membership → Medical Condition; reconstruction uses the locked row, preventing lost updates and stale access during Archive/Restore or Leave/Remove. Clock is sampled once after these locks and target resolution. Explicit diagnosis dates must be valid calendar dates no later than that UTC day; persisted dates are reconstructed structurally, and omitted dates are preserved without applying the new-date temporal restriction. Technical timestamps are never exposed.

To resolve an active condition, send `POST /pets/{petId}/health/medical-conditions/{conditionId}/resolve` with Bearer and a required strict body such as `{"resolvedDate":"2026-09-15"}` or `{"resolvedDate":null}` when the exact clinical resolution date is unknown or only approximate. There is no implicit date or default to today. Known dates must be valid complete civil YYYY-MM-DD dates no later than today UTC; no ordering relative to diagnosedDate is imposed because a reported diagnosis can be retrospective. Active owners and collaborators of ACTIVE pets may resolve another account's records. Resolve transitions ACTIVE → RESOLVED, preserving identity, author, diagnosis, name and notes; the condition remains clinical history. ACTIVE always has resolvedDate null; RESOLVED may have a date or null, so status is the source of truth. Record returns resolvedDate null; Record, List, Update, Resolve and Reopen always include the nullable field. Update preserves status and resolvedDate and accepts neither in PATCH. List retains its projection without petId and supports ARCHIVED pets as read-only. An authorized retry returns 200 and the current representation without a physical UPDATE or timestamp change; a successful retry never modifies the existing resolution date, including when a structurally valid new date string is semantically invalid. The required field and strict body still apply to retries. No query parameters are accepted. Authentication precedes HTTP structure validation, followed by Pet authorization, target lookup and domain validation. Missing/inaccessible/archived pets return 404 PET_NOT_FOUND; missing conditions or conditions belonging to another pet return 404 PET_MEDICAL_CONDITION_NOT_FOUND; invalid first-resolution dates return 400 INVALID_MEDICAL_CONDITION_RESOLVED_DATE. Resolve uses READ COMMITTED locks Pet → requester Membership → MedicalCondition, samples HEALTH_CLOCK once after finding the locked target, and preserves persisted historical dates without checking them against today's Clock. Get Detail is not available for medical conditions.

To correct a resolution recorded by mistake, send `POST /pets/{petId}/health/medical-conditions/{conditionId}/reopen` with Bearer and no body or `{}`. Resolve records that a condition has resolved; Reopen corrects an erroneous resolution, not a clinical recurrence or relapse. It transitions RESOLVED → ACTIVE and sets `resolvedDate` to null, preserving the existing condition ID, pet ID, original recording account, name, diagnosed date and notes. **The previous resolution date is permanently removed; the system does not preserve or audit transition history.** The medical condition record remains, but its earlier resolution cannot be reconstructed. The current model cannot verify the user's intent or represent episodes. Active owners and collaborators of ACTIVE pets may reopen another account's condition. ARCHIVED pets remain readable for active members but are not writable. An authorized Reopen on ACTIVE returns the complete current representation with 200, without a physical UPDATE or timestamp changes. Idempotence applies to the current state: if a new Resolve occurs between requests, a later Reopen may change the state again; no idempotency keys are implemented. Nonempty bodies, unexpected properties, arrays, scalars, JSON null, malformed JSON and any query parameters return 400 INVALID_REQUEST. Authentication precedes path/body/query validation, then Pet authorization and target lookup: missing/invalid Bearer returns 401 UNAUTHENTICATED; missing/archived/inaccessible pets return 404 PET_NOT_FOUND; missing conditions or conditions from another pet return 404 PET_MEDICAL_CONDITION_NOT_FOUND. There is no 403 or conflict for an already ACTIVE condition. READ COMMITTED locks Pet → requester Membership → MedicalCondition protect authorization and transition atomically. Only status and resolved_date are updated on an actual transition; created_at and all other data are preserved, and the existing trigger updates updated_at. Reopen uses no Clock. A List started after commit sees the confirmed state unless another command has committed afterward. Recurrences, episodes, transition history and resolution audit remain outside the implemented functionality.

To delete a medical condition registered by mistake, send `DELETE /pets/{petId}/health/medical-conditions/{conditionId}` with Bearer and no body or `{}`. Delete physically and permanently removes an incorrect record from `health_pet_medical_conditions`; it does not represent clinical resolution, recovery, relapse, treatment completion, or a status change. Use Resolve for a condition that actually existed and is no longer active: Resolve preserves the record as clinical history. Both ACTIVE and RESOLVED conditions are deletable, including resolutions with a known date or null; no prior Resolve or status/date update is required. Active owners and collaborators of ACTIVE pets may delete another account's records. ARCHIVED pets remain readable but are read-only. Successful deletion returns `204 No Content` without a response body; a second authorized DELETE returns `404 PET_MEDICAL_CONDITION_NOT_FOUND`. A List started after commit no longer includes the deleted record. **The deleted condition and its history are not preserved: there is no deletion audit, tombstone, reason, soft delete, or restore.** Path IDs must be non-nil UUIDs, query parameters are forbidden, and bodies must be absent or an empty JSON object. Authentication precedes HTTP validation, including malformed JSON: errors follow `401 UNAUTHENTICATED` → `400 INVALID_REQUEST` → `404 PET_NOT_FOUND` → `404 PET_MEDICAL_CONDITION_NOT_FOUND`. Missing/archived pets and missing/inactive memberships return PET_NOT_FOUND without 403; a condition belonging to another pet is indistinguishable from a missing target. Deletion uses READ COMMITTED locks Pet → requester Membership → MedicalCondition, scopes target lookup and DELETE by condition ID and pet ID, and uses no Clock or postcommit read.

To list registered medical conditions, send `GET /pets/{petId}/health/medical-conditions` with a Bearer token. Active owners and collaborators may read ACTIVE or ARCHIVED pets; archived pets remain read-only. The response is `{ "items": [...], "nextCursor": null }` with a page of registered conditions, including both `ACTIVE` and `RESOLVED` statuses and independent duplicate entries. Each item contains exactly `id`, `name`, `status`, `diagnosedDate`, `resolvedDate`, `notes`, and `recordedByAccountId`; date and notes are always present and nullable. `diagnosedDate` retains the exact known reported diagnosis date as a civil `YYYY-MM-DD` string; unknown or only approximate dates remain null. No pet ID, technical timestamps, or Identity enrichment is included. Ordering is `diagnosed_date DESC NULLS LAST, created_at DESC, id DESC`: known dates newest first, then unknown dates, with technical creation time and ID breaking ties. Creation time does not represent a clinical date or guarantee concurrent commit order. Accessible pets with no conditions return `{ "items": [], "nextCursor": null }`. Missing pets, inactive memberships, or absent memberships return `404 PET_NOT_FOUND`; authorship grants no enduring access, while records remain visible to authorized members after their author leaves. Invalid or nil pet IDs and unsupported query parameters return `400 INVALID_REQUEST`; missing/invalid authentication returns `401 UNAUTHENTICATED`. Optional limit and cursor paginate results; no filters, search or configurable ordering are supported. Access and collection are read in a single SQL statement with a READ COMMITTED snapshot, without explicit transactions or row locks. Uncommitted writes are invisible; a read after commit observes the committed state. A simple non-unique `pet_id` index locates the collection, and PostgreSQL sorts the selected rows.

To record a known allergy in Health, send `POST /pets/{petId}/health/allergies` with a Bearer token and JSON such as `{"allergen":"Penicillin","category":"MEDICATION","severity":"SEVERE","notes":"Previous reaction reported by veterinarian."}`. Active owners and collaborators of active pets receive `201` with `id`, `petId`, `allergen`, `category`, `severity`, nullable `notes`, and `recordedByAccountId` from the authenticated account. Allergen is trimmed, preserves casing, and must contain 1–255 Unicode characters. Category is `FOOD`, `MEDICATION`, `ENVIRONMENTAL`, or `OTHER`; severity is required and must be `MILD`, `MODERATE`, `SEVERE`, or `UNKNOWN`. Severity describes known or reported gravity rather than a formal diagnosis. Optional notes are trimmed and limited to 2,000 Unicode characters; omission or null means absence, while present empty text is invalid. The body is strict. Structural errors return `400 INVALID_REQUEST`; semantic errors return `400 INVALID_ALLERGEN`, `INVALID_ALLERGY_CATEGORY`, `INVALID_ALLERGY_SEVERITY`, or `INVALID_ALLERGY_NOTES`. Missing/invalid authentication returns `401 UNAUTHENTICATED`; missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`. Duplicates are allowed. Allergies have no clinical identification date or lifecycle status. Technical timestamps stay in persistence, and Archive/Restore preserve the allergy data. Access checks and INSERT are atomic under Pet → Membership locks. Creation, listing, correction, and deletion are available.

To correct an existing allergy, send `PATCH /pets/{petId}/health/allergies/{allergyId}` with at least one of `allergen`, `category`, `severity`, or `notes`. The body is strict and no query parameters are accepted. Omitted fields are preserved; `notes: null` clears notes, while the other fields reject null. Creation normalization and validation rules apply. The `200` response has the same complete representation as POST and preserves identity, pet, and `recordedByAccountId`, which identifies the original recorder, not the correcting account. A normalized no-op executes no UPDATE and preserves `updated_at`; a real correction preserves `created_at` and the trigger updates `updated_at`. Active owners and collaborators may correct other authors’ records on active pets. Authentication and HTTP validation precede access: missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`; next, a missing target or one belonging to another pet returns `404 PET_ALLERGY_NOT_FOUND`; domain validation then uses the same 400 codes as creation. The READ COMMITTED transaction locks Pet → Membership → PetAllergy and reconstructs the current state before correction, preventing lost updates. Duplicates remain allowed.

To delete an erroneous allergy record, send `DELETE /pets/{petId}/health/allergies/{allergyId}` with a Bearer token. Hard delete corrects data that should not exist; it does not mean clinical resolution, cure, or tolerance. Active owners and collaborators may delete records by any author only on ACTIVE pets; archived pets are read-only for Health. An absent body or `{}` is accepted; other JSON bodies and any query parameter return `400 INVALID_REQUEST`. Both IDs must be valid non-nil UUIDs. Success returns `204` without a body. Authentication precedes HTTP validation, Pet access, and target resolution: `401 UNAUTHENTICATED`, `400 INVALID_REQUEST`, `404 PET_NOT_FOUND`, and `404 PET_ALLERGY_NOT_FOUND`, respectively. A missing target or one belonging to another pet, after authorizing Pet, returns `PET_ALLERGY_NOT_FOUND`; a second DELETE does too. The READ COMMITTED transaction locks Pet → Membership → PetAllergy and deletes only the requested ID. Other duplicates remain; deleting the last record leaves `{ "items": [] }`. No lifecycle, soft delete, history, or migration is introduced.

To list known allergies, send `GET /pets/{petId}/health/allergies` with a Bearer token. Active owners and collaborators can read active or archived pets. The `200` response contains `{ "items": [...], "nextCursor": null }`, with a page of registered allergies; an accessible pet without allergies returns `{ "items": [], "nextCursor": null }`. Each item contains `id`, `allergen`, `category`, `severity`, nullable `notes`, and `recordedByAccountId`; `petId` and technical timestamps are omitted. Entries are ordered by `created_at DESC, id DESC` in PostgreSQL. This technical ordering does not represent a diagnosis, onset, or reaction date, or guarantee concurrent commit order. Duplicates remain independent entries. Optional limit and cursor paginate results; unsupported query parameters return `400 INVALID_REQUEST`, as does an invalid or nil pet UUID. Missing/invalid authentication returns `401 UNAUTHENTICATED`; a missing pet, inactive membership, or absent membership returns `404 PET_NOT_FOUND`. Original authorship never grants access after membership becomes inactive. Access and data are read in one SQL statement without row locks, using its READ COMMITTED snapshot. Archive/Restore preserves allergies and their timestamps. A non-unique index on `pet_id` supports locating the collection; PostgreSQL sorts the selected rows.

To record a weight, send `POST /pets/{petId}/health/weight-records` with a Bearer token and JSON such as `{"weightKg":"12.3456","measuredDate":"2026-09-26"}`. Weight is a positive decimal string in kilograms with at most four decimal places. The measured date is a valid calendar date no later than today in UTC. An active owner or collaborator of an active pet receives `201` with the record ID, pet ID, canonical `weightKg`, `measuredDate`, and `recordedByAccountId`. An inaccessible or archived pet returns `404 PET_NOT_FOUND`.

To read weight history, send `GET /pets/{petId}/health/weight-records` with a Bearer token. Active owners and collaborators can read active or archived pets. Results are ordered by measured date, newest first. Optional `limit` defaults to 20 (maximum 100); pass the opaque `nextCursor` as `cursor` for the next page. The `200` response contains `items` and `nextCursor` (`null` on the last page). Each item contains `id`, decimal string `weightKg`, `measuredDate`, and `recordedByAccountId`. Missing or inaccessible pets return `404 PET_NOT_FOUND`.

To correct a record, send `PATCH /pets/{petId}/health/weight-records/{weightRecordId}` with `weightKg`, `measuredDate`, or both. The response is `200` with the canonical values and original recorder. To permanently delete it, send `DELETE` to the same path without a body or with `{}`; the response is `204`. Both actions require an active owner or collaborator of an active pet, regardless of who recorded the weight. Missing or inaccessible pets return `404 PET_NOT_FOUND`; a missing record or one belonging to another pet returns `404 WEIGHT_RECORD_NOT_FOUND` once pet access is confirmed.

To record a vaccination, send `POST /pets/{petId}/health/vaccination-records` with a Bearer token and JSON such as `{"vaccineName":"Rabies","appliedDate":"2026-09-20","nextDueDate":"2027-09-20"}`. `nextDueDate` may be omitted or `null`; the `201` response always includes it, using `null` when unknown. The vaccine name is trimmed, preserves casing, and allows up to 255 characters. Applied date must be a valid date no later than today UTC; a known next due date must be after it, even if already overdue. Active owners and collaborators of an active pet may create multiple identical records. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`.

To read vaccination history, send `GET /pets/{petId}/health/vaccination-records` with a Bearer token. Active owners and collaborators can read active or archived pets. Records are ordered by application date, newest first, with stable ordering for ties. Optional `limit` defaults to 20 (maximum 100); pass the opaque `nextCursor` as `cursor` for the next page. The `200` response contains `items` and `nextCursor` (`null` on the last page). Each item contains `id`, `vaccineName`, `appliedDate`, nullable `nextDueDate`, and `recordedByAccountId`. Missing or inaccessible pets return `404 PET_NOT_FOUND`.

To correct a vaccination record, send `PATCH /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` with at least one of `vaccineName`, `appliedDate`, or `nextDueDate`. Omit `nextDueDate` to preserve it; send `null` to clear it. The final applied and due dates must remain valid. A normalized no-op returns `200` without changing `updated_at`. The response includes the original `recordedByAccountId`. To permanently remove a record, send `DELETE` to the same route without a body or with `{}`; success is `204` without a body, and a repeated DELETE returns `404 VACCINATION_RECORD_NOT_FOUND`. Both actions require an active owner or collaborator of an active pet, regardless of who recorded the vaccination. An archived or inaccessible pet returns `404 PET_NOT_FOUND`; a missing record or one belonging to another pet returns `404 VACCINATION_RECORD_NOT_FOUND` after pet access is confirmed.

To leave a pet, send `POST /pets/{petId}/leave` with a Bearer token, no query parameters, and no body or `{}`. Owners and collaborators may leave active or archived pets. An active owner may leave only if another active owner remains; the last active owner receives `409 LAST_OWNER_CANNOT_LEAVE` without a change. Success is `204 No Content`, including retries on an inactive membership. Leave changes only membership status to `INACTIVE`, preserving the membership ID, account ID, role, and creation time. A real transition updates `updated_at`; retries perform no UPDATE. A departed member loses access and is excluded from List Pet Members. A new accepted invitation can reactivate the same historical membership as a collaborator, including a departed owner. Missing pets or absent own memberships return `404 PET_NOT_FOUND`. An invalid or nil pet UUID, unexpected query parameters, or a nonempty body returns `400 INVALID_REQUEST`; a missing or invalid token returns `401 UNAUTHENTICATED`.

Leave now returns `204` without a representation, replacing its previous `200` JSON response. Clients must no longer expect membership data in the response. See [Pet leave](docs/pet-leave.md) for the domain decision and transaction locking protocol.

## Care

Create a routine with `POST /pets/{petId}/care/routines`, a Bearer token and a strict
body such as `{"type":"FEEDING","title":"Breakfast","frequency":{"period":"DAILY","timesPerPeriod":1,"suggestedTimes":["08:00"]},"timezone":"America/Mexico_City"}`.
Active owners and collaborators may create routines for active pets; archived pets
are read-only. Types are FEEDING, WALK, HYGIENE and OTHER. Frequencies are DAILY or
WEEKLY with a positive safe-integer target; WEEKLY permits optional `weekdays`
(MONDAY–SUNDAY). Suggestions are local HH:mm; supply the creator's IANA timezone
explicitly. Optional `instructions` accepts omission/null. Success returns 201 with
`id`, `petId`, `type`, `title`, nullable `instructions`, complete `frequency`, canonical
`timezone` and authenticated `recordedByAccountId`. No query parameters are accepted.
Authentication precedes validation, including malformed JSON. Structural errors use
400 INVALID_REQUEST; domain errors use INVALID_ROUTINE_TYPE, INVALID_ROUTINE_TITLE,
INVALID_ROUTINE_INSTRUCTIONS, INVALID_ROUTINE_FREQUENCY or INVALID_ROUTINE_TIMEZONE.
Missing/archived/inaccessible pets use 404 PET_NOT_FOUND. Duplicate routines are
independent. See [Pet care](docs/pet-care.md) for decisions and persistence details.

List routines with `GET /pets/{petId}/care/routines`, a Bearer token and optional `limit`/`cursor`
parameters. Active owners and collaborators may read active or archived pets.
Success returns `200 { "items": [...], "nextCursor": null }` with `id`, `type`, `title`, nullable
`instructions`, complete `frequency`, `timezone` and `recordedByAccountId`.
Pet identity and technical timestamps are omitted. Order is creation timestamp,
then ID descending; duplicates are preserved across pages. An
accessible pet without routines returns `items: []`. Invalid UUIDs or queries
return `400 INVALID_REQUEST`; missing/invalid tokens return `401 UNAUTHENTICATED`;
missing or inaccessible pets return `404 PET_NOT_FOUND`. Authentication precedes
validation, including JSON parser failures. See [Pet care](docs/pet-care.md).

Update a routine with `PATCH /pets/{petId}/care/routines/{routineId}` and at least
one of `type`, `title`, `instructions`, `frequency` or `timezone`. Omitted fields
are preserved; null clears instructions. A supplied frequency replaces the full
value using the creation shape. Timezone changes preserve local HH:mm suggestions.
ACTIVE owners and collaborators may update ACTIVE pets regardless of authorship.
Success returns the complete routine with 200; normalized no-ops do not write.
Archived/inaccessible pets return PET_NOT_FOUND; an authorized missing or wrong-pet
routine returns CARE_ROUTINE_NOT_FOUND. Authentication precedes HTTP validation;
access and target lookup precede semantic validation. See [Pet care](docs/pet-care.md).

Record a completion with `POST /pets/{petId}/care/routines/{routineId}/activities`,
a Bearer token and `{"completedAt":"2026-10-10T14:00:00Z","timezone":"America/Mexico_City","notes":"Finished breakfast"}`.
Active owners and collaborators may write active pets regardless of routine authorship.
Supply a valid UTC instant ending in Z, with optional 1–3 fractional digits, no later
than now, and the recorder's explicit IANA timezone. Optional notes accept omission/null
or trimmed nonempty text up to 2,000 Unicode code points. Success returns 201 with
`id`, `petId`, `routineId`, normalized `completedAt`, authenticated `completedBy`,
canonical `timezone` and nullable `notes`. Identical requests create independent
activities. No query parameters are accepted. Authentication precedes HTTP validation;
semantic validation precedes transactional access. Errors are INVALID_REQUEST,
INVALID_ACTIVITY_COMPLETED_AT, INVALID_ACTIVITY_TIMEZONE, INVALID_ACTIVITY_NOTES,
UNAUTHENTICATED, PET_NOT_FOUND or CARE_ROUTINE_NOT_FOUND. Archived pets are read-only;
pet access is checked before routine lookup. Local days are computed in the recorder's
timezone; no missed activities are stored. See [Pet care](docs/pet-care.md).

List activity history with `GET /pets/{petId}/care/activities` and a Bearer token.
Optional `from` and `to` are inclusive `YYYY-MM-DD` bounds on each activity's local
day in its recorded timezone; `routineId` filters within the pet. Active owners and
collaborators may read active or archived pets. Success returns `200 { "items": [...], "nextCursor": null }`
with `id`, `routineId`, `completedAt`, `completedBy`, `timezone`, `localDay` and nullable
`notes`, ordered by completion instant, creation timestamp and ID descending, with
`limit`/`cursor` pagination. No matches, including unknown or wrong-pet routines, return empty items
after pet authorization. Reversed ranges, invalid dates/UUIDs and unknown or repeated
query parameters return 400 INVALID_REQUEST; invalid authentication returns 401
UNAUTHENTICATED; missing/inaccessible pets return 404 PET_NOT_FOUND. Authentication
precedes validation, including JSON parser failures. Expected/completed summaries
are available through the summary route below. Missed activities are never stored. See
[Pet care](docs/pet-care.md).

Read expected/completed care with `GET /pets/{petId}/care/summary?from=2026-03-01&to=2026-03-31`
and a Bearer token. Both local dates are required (inclusive, maximum 31 days).
Optional `routineId` filters the pet's routines; `limit`/`cursor` paginate routines.
Active owners/collaborators may read archived pets. Each routine returns `days`
or whole ISO `weeks` with expected/completed/missed counts. Current frequency and
routine timezone apply to past expectations; completion days use each activity's
stored timezone. Weekly remainder goes to earliest selected ISO weekdays; routines
without selected weekdays report whole weeks, with zero expectation in their
creation week. Nothing is stored for missed activities. See [Pet care](docs/pet-care.md).

## Audit and history

See [Audit and history](docs/audit-and-history.md) for account attribution, timestamp
triggers, archival, deletion behavior, and the limits of retained history across contexts.

## Shared domain utilities

`src/shared/domain/uuid.ts`, `civil-date.ts`, and `text.ts` provide reusable
UUID validation/generation, civil calendar validation, and bounded Unicode text
normalization. UUIDs require exactly 36 characters and civil dates exactly
`YYYY-MM-DD`; surrounding whitespace and trailing line breaks are rejected.

Domain objects retain their own identifiers, casing policies, field limits,
nullable semantics, errors, date ordering, and future-date rules. Shared helpers
do not access the database, HTTP, configuration, or the current date.

## Migrations

Drizzle schemas live in:

```text
src/<bounded-context>/infrastructure/persistence/drizzle/*.schema.ts
```

After changing a schema, generate the migration and review its SQL and metadata
before applying it:

```bash
pnpm db:generate
pnpm db:migrations:check
pnpm db:migrate
```

Versioned SQL migrations and metadata are stored in `drizzle/`. Review the generated
SQL before running `pnpm db:migrate`. Append only extra statements already used by
existing migrations, such as the `updated_at` trigger in `drizzle/0017_mean_bishop.sql`.
Do not generate empty migrations or edit applied migrations. Deployments apply
reviewed migrations; they do not generate them at API startup. See
[Production readiness](docs/production-readiness.md).

See [Pet member reads](docs/pet-members-read.md) for the email lookup boundary,
read consistency, and the separate technical debt concerning the missing
membership-to-account foreign key.

Run `pnpm format` to apply the project style with ESLint and Prettier: four-space indentation, a 100-character print width, braces around control flow, and blank lines between logical blocks and class members. Rest/spread is used for simple projections; domain-to-response conversions remain explicit.

## Verification

```bash
pnpm lint
pnpm test
pnpm build
```
