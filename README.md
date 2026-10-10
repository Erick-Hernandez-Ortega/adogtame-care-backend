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

## API documentation

Open Swagger UI at `http://localhost:3000/docs` (use your configured `PORT` if
different). The OpenAPI JSON is at `/docs-json`. Both are available in every
environment.

To try protected routes, register with `POST /accounts` if needed, then call
`POST /auth/login` with your email and password. Copy `accessToken` from the
response, click **Authorize** in Swagger, and enter the token. Swagger adds the
Bearer prefix to requests automatically.

The API exposes 35 operations.

| Route                                         | Description             | Bearer token |
| --------------------------------------------- | ----------------------- | ------------ |
| `GET /`                                       | Welcome message         | No           |
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

To archive a pet, send `POST /pets/{petId}/archive` as an active owner. Success is `204 No Content`, including retries on an archived pet after owner authorization is checked again. A retry performs no UPDATE and preserves `pets.updated_at`; a real transition changes it through the existing database trigger. Archive preserves the profile, memberships, pending invitations, and Health history. Collaborators, inactive members, absent memberships, and missing pets receive `404 PET_NOT_FOUND`. The pet ID must be a non-nil UUID. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`.

To restore an archived pet, send `POST /pets/{petId}/restore` as an active owner. Archive transitions `ACTIVE → ARCHIVED`; Restore transitions `ARCHIVED → ACTIVE`. Both return `204 No Content` and are idempotent after active owner authorization: an authorized retry performs no UPDATE or timestamp change. Restore preserves profile, memberships (including inactive members), all invitation states and expiration dates, and Health history. A pending, unexpired invitation can be accepted again under the existing acceptance rules; expired invitations are not revived. Restore uses the same Bearer, non-nil UUID, empty query and absent/empty body contract and `400 INVALID_REQUEST`, `401 UNAUTHENTICATED`, and `404 PET_NOT_FOUND` errors as Archive.

`GET /pets` includes active and archived pets with an active requester membership and exposes `status` in each summary. `GET /pets/{petId}` also permits both states for active members. Archived pets remain readable through Members and Health history, and Leave remains available. Profile updates, invitations, member removal/promotion, and all Health writes require an active pet. Pending invitations are preserved; accepting a pending, unexpired invitation for an archived pet returns `409 INVITATION_NOT_ACCEPTABLE` without granting access. Cancellation requires an active pet; rejection remains available according to the invitation lifecycle. See [pet archive](docs/pet-archive.md) for lock ordering and concurrency.

To list current members, send `GET /pets/{petId}/members` with a Bearer token and no body or query parameters. Active owners and collaborators can read active or archived pets. The complete `200` response is `{"members":[{"membershipId":"...","accountId":"...","email":"owner@example.com","role":"OWNER"}]}`. Only active memberships are included, including the requester and all owners; pending invitations are excluded. Owners appear first, followed by collaborators, with each role ordered by membership creation time and then membership ID ascending. An invalid or nil UUID or unexpected query parameter returns `400 INVALID_REQUEST`; a missing or invalid token returns `401 UNAUTHENTICATED`. Missing pets, absent memberships, and inactive requester memberships return `404 PET_NOT_FOUND`.

To remove another pet member, send `DELETE /pets/{petId}/members/{membershipId}` as an active owner of an active pet. Identify the target by the persistent `membershipId` returned by List Pet Members. Both owners and collaborators can be removed; only status changes to `INACTIVE`, preserving the membership ID, account ID, role, and creation time. Success is `204` without a response body, including retries on another inactive owner or collaborator. A retry performs no UPDATE and preserves `updated_at`; a real transition changes `updated_at`. Self-removal returns `409 SELF_REMOVAL_NOT_SUPPORTED`, even for the last owner; use `POST /pets/{petId}/leave`. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND` before target resolution or idempotence. Only after owner authorization does a missing target or one from another pet return `404 PET_MEMBER_NOT_FOUND`. Authorization is checked again on every retry. Both path IDs must be valid non-nil UUIDs. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`. The domain retains `LAST_OWNER_CANNOT_BE_REMOVED` as an internal defensive outcome, not a normal HTTP case: an authorized requester distinct from the target remains an active owner. See [member removal](docs/pet-member-removal.md) for the transaction protocol and concurrency behavior.

To promote a collaborator, send `POST /pets/{petId}/members/{membershipId}/promote` as an active owner of an active pet. An active collaborator becomes an active owner in the same membership, retaining its membership ID, account ID, and creation time. An active owner, including the requester, returns `204` without an UPDATE or `updated_at` change. An inactive member returns `409 PET_MEMBER_INACTIVE` and is not reactivated. A missing, archived, or inaccessible pet returns `404 PET_NOT_FOUND` before target resolution; a missing member or one from another pet then returns `404 PET_MEMBER_NOT_FOUND`. Both path IDs must be non-nil UUIDs. Send no query parameters and no body or `{}`; invalid structure returns `400 INVALID_REQUEST`. A missing or invalid Bearer token returns `401 UNAUTHENTICATED`.

To correct a pet profile, send `PATCH /pets/{petId}` as an active owner of an active pet. Include at least one of `name`, `species`, `breed`, `sex`, `birthInformation`, `color`, `distinctiveMarks`, or `microchip`. The nested `breed` and `birthInformation` objects use the same complete shapes as registration. Omitted fields are preserved; send `null` to clear `color`, `distinctiveMarks`, or `microchip`. The `200` response has the same shape as `GET /pets/{petId}`, with `role: "OWNER"`. A normalized no-op does not change `updated_at`. Invalid request structure returns `400 INVALID_REQUEST`; domain-invalid values return `422 INVALID_PET`. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`.

To record a known current medical condition, send `POST /pets/{petId}/health/medical-conditions` with a Bearer token and JSON such as `{"name":"Epilepsy","diagnosedDate":"2026-03-14","notes":"Recurring seizures monitored by veterinarian."}`. Active owners and collaborators of active pets receive `201` with exactly `id`, `petId`, `name`, `status`, nullable `diagnosedDate`, nullable `resolvedDate`, nullable `notes`, and `recordedByAccountId`. Each condition has independent identity. The lifecycle distinguishes `ACTIVE` from `RESOLVED`, but Record always creates `ACTIVE` and does not accept client-supplied status or already resolved conditions. ACTIVE means a currently reported condition, not a severity or professional certification. `diagnosedDate` is the exact known date of the reported diagnosis, not symptom onset or when the owner learned about it; it does not certify a professional diagnosis. It accepts a valid complete `YYYY-MM-DD` calendar date no later than today UTC. Omit it or send null if unknown or only approximate; there is no date accuracy or partial-date field. Name is required, trimmed, preserves casing, and permits up to 255 Unicode code points. Notes are optional, trimmed, and permit up to 2,000 Unicode code points; omission/null mean absence, while present empty or whitespace-only text is invalid. Names do not define clinical identity: duplicates are allowed with distinct IDs, without a catalog or automatic deduplication. Authorship identifies the authenticated recording account, not a veterinarian or an enduring authorization grant. The body is strict and no query parameters are accepted. Authentication precedes HTTP validation, including malformed JSON; domain values are validated before transactional access. Structural/path/query errors return `400 INVALID_REQUEST`; semantic errors return `400 INVALID_MEDICAL_CONDITION_NAME`, `INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE`, or `INVALID_MEDICAL_CONDITION_NOTES`. Missing/invalid authentication returns `401 UNAUTHENTICATED`; missing/archived pets, inactive memberships, or absence of membership return `404 PET_NOT_FOUND`. Authorization and INSERT are atomic under READ COMMITTED locks Pet → requester Membership. Technical timestamps remain in persistence; Archive/Restore preserve conditions and timestamps. Record, List, Update, Resolve, Reopen, and Delete are available for medical conditions. No generic severity, treatments, medications, or veterinarian relationships are included.

To correct registered medical condition information, send `PATCH /pets/{petId}/health/medical-conditions/{conditionId}` with a Bearer token and at least one of `name`, `diagnosedDate`, or `notes`, for example `{"name":"Osteoarthritis","diagnosedDate":"2026-02-10","notes":"Confirmed during veterinary examination."}`. Omitted fields are preserved; `diagnosedDate: null` clears the known diagnosis date and `notes: null` clears notes. `name: null` is invalid. Name and notes retain their existing trimming, Unicode limits, and nonempty-text rules. Both ACTIVE and RESOLVED conditions can be corrected; identity, original author, and clinical status are preserved. Update does not Resolve or Reopen, create another condition, or add history. The complete `200` response contains exactly `id`, `petId`, `name`, `status`, nullable `diagnosedDate`, nullable `resolvedDate`, nullable `notes`, and `recordedByAccountId`. A normalized no-op returns the current representation without a physical UPDATE or timestamp change.

Active owners and collaborators of an ACTIVE pet may correct another account's record, including after that author leaves. Archived pets remain read-only. Both path IDs must be non-nil UUIDs; the partial body is strict and no query parameters are accepted. Error precedence is authentication (`401 UNAUTHENTICATED`), HTTP structure (`400 INVALID_REQUEST`), writable Pet and requester access (`404 PET_NOT_FOUND`), target matching both condition ID and pet ID (`404 PET_MEDICAL_CONDITION_NOT_FOUND`), then semantic validation using the existing `400 INVALID_MEDICAL_CONDITION_NAME`, `INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE`, and `INVALID_MEDICAL_CONDITION_NOTES` codes. READ COMMITTED locks follow Pet → requester Membership → Medical Condition; reconstruction uses the locked row, preventing lost updates and stale access during Archive/Restore or Leave/Remove. Clock is sampled once after these locks and target resolution. Explicit diagnosis dates must be valid calendar dates no later than that UTC day; persisted dates are reconstructed structurally, and omitted dates are preserved without applying the new-date temporal restriction. Technical timestamps are never exposed.

To resolve an active condition, send `POST /pets/{petId}/health/medical-conditions/{conditionId}/resolve` with Bearer and a required strict body such as `{"resolvedDate":"2026-09-15"}` or `{"resolvedDate":null}` when the exact clinical resolution date is unknown or only approximate. There is no implicit date or default to today. Known dates must be valid complete civil YYYY-MM-DD dates no later than today UTC; no ordering relative to diagnosedDate is imposed because a reported diagnosis can be retrospective. Active owners and collaborators of ACTIVE pets may resolve another account's records. Resolve transitions ACTIVE → RESOLVED, preserving identity, author, diagnosis, name and notes; the condition remains clinical history. ACTIVE always has resolvedDate null; RESOLVED may have a date or null, so status is the source of truth. Record returns resolvedDate null; Record, List, Update, Resolve and Reopen always include the nullable field. Update preserves status and resolvedDate and accepts neither in PATCH. List retains its projection without petId and supports ARCHIVED pets as read-only. An authorized retry returns 200 and the current representation without a physical UPDATE or timestamp change; a successful retry never modifies the existing resolution date, including when a structurally valid new date string is semantically invalid. The required field and strict body still apply to retries. No query parameters are accepted. Authentication precedes HTTP structure validation, followed by Pet authorization, target lookup and domain validation. Missing/inaccessible/archived pets return 404 PET_NOT_FOUND; missing conditions or conditions belonging to another pet return 404 PET_MEDICAL_CONDITION_NOT_FOUND; invalid first-resolution dates return 400 INVALID_MEDICAL_CONDITION_RESOLVED_DATE. Resolve uses READ COMMITTED locks Pet → requester Membership → MedicalCondition, samples HEALTH_CLOCK once after finding the locked target, and preserves persisted historical dates without checking them against today's Clock. Get Detail is not available for medical conditions.

To correct a resolution recorded by mistake, send `POST /pets/{petId}/health/medical-conditions/{conditionId}/reopen` with Bearer and no body or `{}`. Resolve records that a condition has resolved; Reopen corrects an erroneous resolution, not a clinical recurrence or relapse. It transitions RESOLVED → ACTIVE and sets `resolvedDate` to null, preserving the existing condition ID, pet ID, original recording account, name, diagnosed date and notes. **The previous resolution date is permanently removed; the system does not preserve or audit transition history.** The medical condition record remains, but its earlier resolution cannot be reconstructed. The current model cannot verify the user's intent or represent episodes. Active owners and collaborators of ACTIVE pets may reopen another account's condition. ARCHIVED pets remain readable for active members but are not writable. An authorized Reopen on ACTIVE returns the complete current representation with 200, without a physical UPDATE or timestamp changes. Idempotence applies to the current state: if a new Resolve occurs between requests, a later Reopen may change the state again; no idempotency keys are implemented. Nonempty bodies, unexpected properties, arrays, scalars, JSON null, malformed JSON and any query parameters return 400 INVALID_REQUEST. Authentication precedes path/body/query validation, then Pet authorization and target lookup: missing/invalid Bearer returns 401 UNAUTHENTICATED; missing/archived/inaccessible pets return 404 PET_NOT_FOUND; missing conditions or conditions from another pet return 404 PET_MEDICAL_CONDITION_NOT_FOUND. There is no 403 or conflict for an already ACTIVE condition. READ COMMITTED locks Pet → requester Membership → MedicalCondition protect authorization and transition atomically. Only status and resolved_date are updated on an actual transition; created_at and all other data are preserved, and the existing trigger updates updated_at. Reopen uses no Clock. A List started after commit sees the confirmed state unless another command has committed afterward. Recurrences, episodes, transition history and resolution audit remain outside the implemented functionality.

To delete a medical condition registered by mistake, send `DELETE /pets/{petId}/health/medical-conditions/{conditionId}` with Bearer and no body or `{}`. Delete physically and permanently removes an incorrect record from `health_pet_medical_conditions`; it does not represent clinical resolution, recovery, relapse, treatment completion, or a status change. Use Resolve for a condition that actually existed and is no longer active: Resolve preserves the record as clinical history. Both ACTIVE and RESOLVED conditions are deletable, including resolutions with a known date or null; no prior Resolve or status/date update is required. Active owners and collaborators of ACTIVE pets may delete another account's records. ARCHIVED pets remain readable but are read-only. Successful deletion returns `204 No Content` without a response body; a second authorized DELETE returns `404 PET_MEDICAL_CONDITION_NOT_FOUND`. A List started after commit no longer includes the deleted record. **The deleted condition and its history are not preserved: there is no deletion audit, tombstone, reason, soft delete, or restore.** Path IDs must be non-nil UUIDs, query parameters are forbidden, and bodies must be absent or an empty JSON object. Authentication precedes HTTP validation, including malformed JSON: errors follow `401 UNAUTHENTICATED` → `400 INVALID_REQUEST` → `404 PET_NOT_FOUND` → `404 PET_MEDICAL_CONDITION_NOT_FOUND`. Missing/archived pets and missing/inactive memberships return PET_NOT_FOUND without 403; a condition belonging to another pet is indistinguishable from a missing target. Deletion uses READ COMMITTED locks Pet → requester Membership → MedicalCondition, scopes target lookup and DELETE by condition ID and pet ID, and uses no Clock or postcommit read.

To list registered medical conditions, send `GET /pets/{petId}/health/medical-conditions` with a Bearer token. Active owners and collaborators may read ACTIVE or ARCHIVED pets; archived pets remain read-only. The response is `{ "items": [...] }` with every registered condition, including both `ACTIVE` and `RESOLVED` statuses and independent duplicate entries. Each item contains exactly `id`, `name`, `status`, `diagnosedDate`, `resolvedDate`, `notes`, and `recordedByAccountId`; date and notes are always present and nullable. `diagnosedDate` retains the exact known reported diagnosis date as a civil `YYYY-MM-DD` string; unknown or only approximate dates remain null. No pet ID, technical timestamps, or Identity enrichment is included. Ordering is `diagnosed_date DESC NULLS LAST, created_at DESC, id DESC`: known dates newest first, then unknown dates, with technical creation time and ID breaking ties. Creation time does not represent a clinical date or guarantee concurrent commit order. Accessible pets with no conditions return `{ "items": [] }`. Missing pets, inactive memberships, or absent memberships return `404 PET_NOT_FOUND`; authorship grants no enduring access, while records remain visible to authorized members after their author leaves. Invalid or nil pet IDs and any query parameter return `400 INVALID_REQUEST`; missing/invalid authentication returns `401 UNAUTHENTICATED`. No filters, search, pagination, or configurable ordering are supported. Access and collection are read in a single SQL statement with a READ COMMITTED snapshot, without explicit transactions or row locks. Uncommitted writes are invisible; a read after commit observes the committed state. A simple non-unique `pet_id` index locates the collection, and PostgreSQL sorts the selected rows.

To record a known allergy in Health, send `POST /pets/{petId}/health/allergies` with a Bearer token and JSON such as `{"allergen":"Penicillin","category":"MEDICATION","severity":"SEVERE","notes":"Previous reaction reported by veterinarian."}`. Active owners and collaborators of active pets receive `201` with `id`, `petId`, `allergen`, `category`, `severity`, nullable `notes`, and `recordedByAccountId` from the authenticated account. Allergen is trimmed, preserves casing, and must contain 1–255 Unicode characters. Category is `FOOD`, `MEDICATION`, `ENVIRONMENTAL`, or `OTHER`; severity is required and must be `MILD`, `MODERATE`, `SEVERE`, or `UNKNOWN`. Severity describes known or reported gravity rather than a formal diagnosis. Optional notes are trimmed and limited to 2,000 Unicode characters; omission or null means absence, while present empty text is invalid. The body is strict. Structural errors return `400 INVALID_REQUEST`; semantic errors return `400 INVALID_ALLERGEN`, `INVALID_ALLERGY_CATEGORY`, `INVALID_ALLERGY_SEVERITY`, or `INVALID_ALLERGY_NOTES`. Missing/invalid authentication returns `401 UNAUTHENTICATED`; missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`. Duplicates are allowed. Allergies have no clinical identification date or lifecycle status. Technical timestamps stay in persistence, and Archive/Restore preserve the allergy data. Access checks and INSERT are atomic under Pet → Membership locks. Creation, listing, correction, and deletion are available.

To correct an existing allergy, send `PATCH /pets/{petId}/health/allergies/{allergyId}` with at least one of `allergen`, `category`, `severity`, or `notes`. The body is strict and no query parameters are accepted. Omitted fields are preserved; `notes: null` clears notes, while the other fields reject null. Creation normalization and validation rules apply. The `200` response has the same complete representation as POST and preserves identity, pet, and `recordedByAccountId`, which identifies the original recorder, not the correcting account. A normalized no-op executes no UPDATE and preserves `updated_at`; a real correction preserves `created_at` and the trigger updates `updated_at`. Active owners and collaborators may correct other authors’ records on active pets. Authentication and HTTP validation precede access: missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`; next, a missing target or one belonging to another pet returns `404 PET_ALLERGY_NOT_FOUND`; domain validation then uses the same 400 codes as creation. The READ COMMITTED transaction locks Pet → Membership → PetAllergy and reconstructs the current state before correction, preventing lost updates. Duplicates remain allowed.

To delete an erroneous allergy record, send `DELETE /pets/{petId}/health/allergies/{allergyId}` with a Bearer token. Hard delete corrects data that should not exist; it does not mean clinical resolution, cure, or tolerance. Active owners and collaborators may delete records by any author only on ACTIVE pets; archived pets are read-only for Health. An absent body or `{}` is accepted; other JSON bodies and any query parameter return `400 INVALID_REQUEST`. Both IDs must be valid non-nil UUIDs. Success returns `204` without a body. Authentication precedes HTTP validation, Pet access, and target resolution: `401 UNAUTHENTICATED`, `400 INVALID_REQUEST`, `404 PET_NOT_FOUND`, and `404 PET_ALLERGY_NOT_FOUND`, respectively. A missing target or one belonging to another pet, after authorizing Pet, returns `PET_ALLERGY_NOT_FOUND`; a second DELETE does too. The READ COMMITTED transaction locks Pet → Membership → PetAllergy and deletes only the requested ID. Other duplicates remain; deleting the last record leaves `{ "items": [] }`. No lifecycle, soft delete, history, or migration is introduced.

To list known allergies, send `GET /pets/{petId}/health/allergies` with a Bearer token. Active owners and collaborators can read active or archived pets. The `200` response contains `{ "items": [...] }`, with every registered allergy; an accessible pet without allergies returns `{ "items": [] }`. Each item contains `id`, `allergen`, `category`, `severity`, nullable `notes`, and `recordedByAccountId`; `petId` and technical timestamps are omitted. Entries are ordered by `created_at DESC, id DESC` in PostgreSQL. This technical ordering does not represent a diagnosis, onset, or reaction date, or guarantee concurrent commit order. Duplicates remain independent entries. No pagination, filters, or configurable sorting are supported; any query parameter returns `400 INVALID_REQUEST`, as does an invalid or nil pet UUID. Missing/invalid authentication returns `401 UNAUTHENTICATED`; a missing pet, inactive membership, or absent membership returns `404 PET_NOT_FOUND`. Original authorship never grants access after membership becomes inactive. Access and data are read in one SQL statement without row locks, using its READ COMMITTED snapshot. Archive/Restore preserves allergies and their timestamps. A non-unique index on `pet_id` supports locating the collection; PostgreSQL sorts the selected rows.

To record a weight, send `POST /pets/{petId}/health/weight-records` with a Bearer token and JSON such as `{"weightKg":"12.3456","measuredDate":"2026-09-26"}`. Weight is a positive decimal string in kilograms with at most four decimal places. The measured date is a valid calendar date no later than today in UTC. An active owner or collaborator of an active pet receives `201` with the record ID, pet ID, canonical `weightKg`, `measuredDate`, and `recordedByAccountId`. An inaccessible or archived pet returns `404 PET_NOT_FOUND`.

To read weight history, send `GET /pets/{petId}/health/weight-records` with a Bearer token. Active owners and collaborators can read active or archived pets. Results are ordered by measured date, newest first. Optional `limit` defaults to 20 (maximum 100); pass the opaque `nextCursor` as `cursor` for the next page. The `200` response contains `items` and `nextCursor` (`null` on the last page). Each item contains `id`, decimal string `weightKg`, `measuredDate`, and `recordedByAccountId`. Missing or inaccessible pets return `404 PET_NOT_FOUND`.

To correct a record, send `PATCH /pets/{petId}/health/weight-records/{weightRecordId}` with `weightKg`, `measuredDate`, or both. The response is `200` with the canonical values and original recorder. To permanently delete it, send `DELETE` to the same path without a body or with `{}`; the response is `204`. Both actions require an active owner or collaborator of an active pet, regardless of who recorded the weight. Missing or inaccessible pets return `404 PET_NOT_FOUND`; a missing record or one belonging to another pet returns `404 WEIGHT_RECORD_NOT_FOUND` once pet access is confirmed.

To record a vaccination, send `POST /pets/{petId}/health/vaccination-records` with a Bearer token and JSON such as `{"vaccineName":"Rabies","appliedDate":"2026-09-20","nextDueDate":"2027-09-20"}`. `nextDueDate` may be omitted or `null`; the `201` response always includes it, using `null` when unknown. The vaccine name is trimmed, preserves casing, and allows up to 255 characters. Applied date must be a valid date no later than today UTC; a known next due date must be after it, even if already overdue. Active owners and collaborators of an active pet may create multiple identical records. Missing, archived, or inaccessible pets return `404 PET_NOT_FOUND`.

To read vaccination history, send `GET /pets/{petId}/health/vaccination-records` with a Bearer token. Active owners and collaborators can read active or archived pets. Records are ordered by application date, newest first, with stable ordering for ties. Optional `limit` defaults to 20 (maximum 100); pass the opaque `nextCursor` as `cursor` for the next page. The `200` response contains `items` and `nextCursor` (`null` on the last page). Each item contains `id`, `vaccineName`, `appliedDate`, nullable `nextDueDate`, and `recordedByAccountId`. Missing or inaccessible pets return `404 PET_NOT_FOUND`.

To correct a vaccination record, send `PATCH /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` with at least one of `vaccineName`, `appliedDate`, or `nextDueDate`. Omit `nextDueDate` to preserve it; send `null` to clear it. The final applied and due dates must remain valid. A normalized no-op returns `200` without changing `updated_at`. The response includes the original `recordedByAccountId`. To permanently remove a record, send `DELETE` to the same route without a body or with `{}`; success is `204` without a body, and a repeated DELETE returns `404 VACCINATION_RECORD_NOT_FOUND`. Both actions require an active owner or collaborator of an active pet, regardless of who recorded the vaccination. An archived or inaccessible pet returns `404 PET_NOT_FOUND`; a missing record or one belonging to another pet returns `404 VACCINATION_RECORD_NOT_FOUND` after pet access is confirmed.

To leave a pet, send `POST /pets/{petId}/leave` with a Bearer token, no query parameters, and no body or `{}`. Owners and collaborators may leave active or archived pets. An active owner may leave only if another active owner remains; the last active owner receives `409 LAST_OWNER_CANNOT_LEAVE` without a change. Success is `204 No Content`, including retries on an inactive membership. Leave changes only membership status to `INACTIVE`, preserving the membership ID, account ID, role, and creation time. A real transition updates `updated_at`; retries perform no UPDATE. A departed member loses access and is excluded from List Pet Members. A new accepted invitation can reactivate the same historical membership as a collaborator, including a departed owner. Missing pets or absent own memberships return `404 PET_NOT_FOUND`. An invalid or nil pet UUID, unexpected query parameters, or a nonempty body returns `400 INVALID_REQUEST`; a missing or invalid token returns `401 UNAUTHENTICATED`.

Leave now returns `204` without a representation, replacing its previous `200` JSON response. Clients must no longer expect membership data in the response. See [Pet leave](docs/pet-leave.md) for the domain decision and transaction locking protocol.

## Migrations

Drizzle schemas will live in:

```text
src/<bounded-context>/infrastructure/persistence/drizzle/*.schema.ts
```

Once the first domain schema exists, generate and review the migration before
applying it:

```bash
pnpm db:generate
pnpm db:migrations:check
pnpm db:migrate
```

Versioned SQL migrations will be stored in `drizzle/`. No empty migration is
generated before a domain schema exists.

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
