# Adogtame Care Backend

## Project context

Adogtame Care is a backend application for managing pets that already have owners. Its purpose is to centralize pet information and progressively support ownership, collaboration, health history, and daily care.

The project is also intended as a practical software engineering project. Architecture and technologies must solve actual project needs rather than being introduced only for demonstration purposes.

* Use pnpm as the package manager and to run project scripts. Do not use npm, Yarn, or Bun.
* Build the backend with NestJS and TypeScript.
* Expose a REST API initially.
* Use PostgreSQL as the database.
* Use Drizzle ORM for database access and persistence.
* Use PostgreSQL in Docker for local development.
* Use Neon for remote PostgreSQL environments.
* Use Resend for transactional email delivery when email functionality is introduced.
* Do not install dependencies unless the user explicitly requests it.
* Do not introduce infrastructure such as Redis, message brokers, queues, event buses, cloud services, or caching unless explicitly requested.

## Architecture

Adogtame Care starts as a modular monolith.

Microservices must not be introduced unless future requirements provide a concrete reason to extract a module into an independently deployable service.

The current provisional bounded contexts are:

* Identity
* Pet Management
* Health
* Care

These boundaries may evolve as the domain is better understood.

Do not create modules, abstractions, infrastructure, or placeholder implementations for bounded contexts that are not part of the current task.

Within a bounded context, prefer the following dependency direction when the complexity of the feature justifies it:

```text
Infrastructure -> Application -> Domain
```

### Domain

The domain contains business concepts, behavior, and invariants.

Domain code should remain independent from:

* NestJS
* Drizzle
* PostgreSQL
* HTTP
* Resend
* external infrastructure

Do not add NestJS decorators, database schemas, transport DTOs, or infrastructure-specific types to domain objects.

Business invariants should be enforced by the domain model when they belong to the domain rather than being duplicated in controllers or persistence code.

### Application

The application layer coordinates use cases.

It may:

* load domain objects through persistence contracts;
* invoke domain behavior;
* coordinate multiple domain objects or aggregates;
* persist resulting changes;
* interact with required external capabilities through explicit contracts when justified.

Application code should describe application workflows rather than contain business rules that belong to the domain.

Prefer focused use cases over large services containing unrelated operations.

### Infrastructure

Infrastructure contains technical implementation details such as:

* NestJS controllers and modules;
* Drizzle persistence implementations;
* PostgreSQL integration;
* HTTP concerns;
* configuration;
* email provider integration.

Infrastructure may depend on application and domain code. Domain code must not depend on infrastructure.

### Architecture pragmatism

Do not introduce an abstraction only because a pattern commonly recommends one.

Avoid ceremonial architecture such as unnecessary factories, mappers, repositories, interfaces, commands, handlers, or directories that do not currently solve a concrete problem.

Simple functionality may remain simple.

Do not create empty architectural scaffolding for hypothetical future functionality.

## Domain boundaries

### Identity

Identity is responsible for concepts related to user accounts and authentication.

Pet Management should reference users by identity rather than own authentication or credential concerns.

Detailed Identity modeling has not yet been finalized. Do not make new Identity architecture decisions unless explicitly requested.

### Pet Management

Pet Management owns the pet's core identity and the relationships between pets and the people responsible for or collaborating in their care.

Current concepts include:

* Pet
* Pet Membership
* Pet Invitation

Pet Management does not own medical history or daily care activity.

### Health

Health will be responsible for medical and health-related information, including concepts such as:

* weight history;
* allergies;
* vaccinations;
* medical conditions;
* medications;
* veterinary visits;
* surgeries;
* preventive treatments.

Health has not yet been fully modeled. Do not implement it unless explicitly requested.

### Care

Care is a provisional bounded context for day-to-day pet care, potentially including:

* feeding;
* walks;
* routines;
* care instructions;
* special care;
* behavior-related care information.

Care has not yet been fully modeled. Do not implement it unless explicitly requested.

## Pet Management domain rules

The following rules represent current product decisions. Do not change them without explicit instruction.

### Pet

A Pet has persistent identity independent of changes to its profile, owners, collaborators, or other attributes.

The initial product supports:

* dogs;
* cats.

A pet profile may include concepts such as:

* name;
* species;
* breed;
* sex;
* birth information;
* color;
* distinctive marks;
* photo;
* microchip information;
* status.

Age should not be stored when it can be derived from birth information.

Birth information supports both exact and approximate dates. Even an approximate birth date is represented as a date together with information indicating that it is approximate.

Breed should not be modeled as a closed TypeScript enum. The product should eventually support suggested known breeds while allowing custom user-provided values.

Health and Care information must not be added to the Pet model merely because it appears on the same product screen.

Examples of information that does not belong to the Pet Management pet profile include:

* weight history;
* allergies;
* vaccinations;
* medications;
* medical conditions;
* feeding history;
* walks.

Pets are archived rather than permanently deleted as part of normal product behavior so that historical information can be preserved.

### Pet Membership

A user's role is relative to a specific pet.

The same account may be an owner of one pet and a collaborator of another.

Current roles are:

* OWNER
* COLLABORATOR

Do not introduce additional roles without an explicit product requirement.

There is currently no primary owner. All owners have equivalent authority.

A pet must always have at least one active owner.

A pet may have zero or more collaborators.

Any owner may:

* manage the pet;
* remove another owner provided at least one owner remains;
* leave the pet provided at least one owner remains;
* manage collaborators;
* grant or revoke collaborator permissions;
* promote a collaborator to owner.

A collaborator may leave a pet voluntarily.

An owner may remove a collaborator.

A collaborator does not have owner-level administrative authority.

Collaborator capabilities are permission-based. Detailed permissions have not yet been modeled and must not be invented prematurely.

A person's historical relationship with a pet must be preserved when the membership becomes inactive.

If the same account later becomes involved with the pet again, the system must preserve the existing historical relationship rather than treating the person as an unrelated identity.

### Pet Invitation

Owners may invite other people to become:

* owners;
* collaborators.

Invitations may target an email address that does not yet correspond to an existing account.

An invitation has a lifecycle conceptually equivalent to:

```text
PENDING -> ACCEPTED
PENDING -> REJECTED
PENDING -> CANCELLED
PENDING -> EXPIRED
```

Invitations expire.

Any owner of the relevant pet may cancel a pending invitation.

An invitation may only be accepted by an authenticated account whose verified email matches the invited email address.

An accepted invitation cannot be accepted again.

Equivalent pending invitations for the same pet, email, and intended role should not coexist.

Email delivery will eventually use Resend, but invitation domain behavior must not depend directly on Resend.

## Current aggregate assumptions

These are current modeling assumptions and may evolve as implementation reveals additional constraints.

Pet is expected to be an aggregate root responsible for protecting pet-level invariants, particularly membership rules such as requiring at least one active owner.

Pet Membership currently belongs to the consistency boundary associated with Pet rather than being treated as an independently managed aggregate.

Pet Invitation is expected to have its own lifecycle and is currently considered a separate aggregate.

Do not change aggregate boundaries without discussing the architectural implications first.

## Persistence

Use PostgreSQL with Drizzle ORM.

Persistence models are not domain models.

Do not design domain objects around Drizzle table definitions.

Where mapping between persistence representation and domain representation is necessary, keep that responsibility outside the domain.

Do not expose Drizzle-specific types through the domain model.

Database constraints should complement domain invariants where appropriate rather than replacing domain behavior.

Schema design, migrations, transaction boundaries, and repository implementations should be introduced incrementally as required by actual use cases.

## TypeScript conventions

* Write all code in English, including identifiers, file names, type names, error messages, and code comments.
* Never use `any`, either explicitly or implicitly. Use a precise type, a generic, or `unknown` with proper narrowing.
* Place types in the file that owns the corresponding contract. Extract them to a dedicated file only when reuse or module boundaries justify it.
* Use `interface` for object shapes. Use `type` for unions, intersections, primitives, tuples, function signatures, and other non-object definitions.
* Prefer `as const` objects and derived union types over TypeScript `enum` declarations.
* Add explicit types to variables, parameters, functions, and methods when the type remains clear and reasonably concise. This includes simple declarations such as `const isActive: boolean = false` and explicit function return types.
* Use inference when spelling out the type would be disproportionately complex; never use `any` as a shortcut.
* Use descriptive names.
* Avoid abbreviated variable and parameter names, including callback parameters.
* Prefix boolean names with `is` or `has` when either prefix expresses the meaning clearly.
* Name arrays and other collections with plural nouns.
* Do not chain more than one ternary expression. Use `if`/`else` or `switch` when the logic has more than two branches.

## Comments and documentation

* Prefer self-explanatory code over comments.
* Do not add comments that merely restate what the code does.
* Add a comment only when an important function, non-obvious decision, constraint, or tradeoff cannot be expressed clearly through names and structure.
* Keep comments close to the code they explain, but never place comments or documentation blocks above import statements. Imports must remain at the beginning of the file.
* Write every code comment in English.
* When a module, function, or process needs extensive explanation or many comments, create a focused Markdown document instead and keep only a concise reference near the relevant code when necessary.

## Git commits

* Follow the Conventional Commits specification.
* Write commit messages in English using the format `type(scope): description`.
* The scope is optional and should identify the affected module or area when useful.
* Use an appropriate type such as `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `style`, or `revert`.
* Write the description in lowercase imperative form without a trailing period.
* Mark breaking changes with `!` before the colon and explain them in a `BREAKING CHANGE:` footer when more context is required.
* Keep each commit focused on one coherent change.

## Testing

* Use the testing tools already configured by the NestJS project. Do not introduce additional testing libraries or dependencies unless explicitly requested.
* Colocate unit tests with the source code they test using the `*.spec.ts` naming convention.
* Keep the root `test/` directory for end-to-end tests and broader integration tests when they are introduced.
* Prioritize unit tests for domain behavior and business invariants.
* Domain unit tests must not require NestJS, a database, network access, or external services.
* Test observable behavior and business rules rather than private implementation details.
* Application-layer tests should focus on use-case orchestration and interactions with required contracts. Use test doubles only when they provide meaningful isolation.
* Do not mock domain objects merely to isolate application code when using the real domain object is simpler and more representative.
* Infrastructure code should not be unit tested by extensively mocking Drizzle, PostgreSQL, NestJS, or external libraries. Prefer integration tests when verifying real infrastructure behavior provides more value.
* Add integration tests when persistence or other infrastructure behavior warrants them.
* Add end-to-end tests once a complete vertical slice exists and can be exercised through the public API.
* End-to-end tests should verify complete application behavior through real application boundaries rather than duplicate domain unit tests.
* Keep tests deterministic, isolated, readable, and focused on behavior.
* Follow the Arrange, Act, Assert structure when it improves readability, without adding comments that merely label each section.
* Do not add tests solely to increase coverage metrics.
* Do not introduce a coverage threshold unless explicitly requested.
* Run the relevant unit tests after modifying tested behavior.
* Run relevant integration or end-to-end tests when the changed area is covered by them.


## Formatting and validation

* Follow the repository's ESLint and Prettier configuration.
* Use single quotes and trailing commas as configured by Prettier.
* Run the relevant pnpm lint and build commands after code changes.
- Run the relevant pnpm lint, build, and test commands after code changes.

## Agent behavior

* Implement only the requested scope.
* Do not continue into adjacent features without explicit instruction.
* Do not install dependencies without explicit instruction.
* Do not silently make architecture or domain decisions when requirements are ambiguous.
* Ask or report the ambiguity when a decision would materially affect the domain or architecture.
* Do not generate placeholder implementations for future bounded contexts.
* Do not refactor unrelated code while implementing a requested feature.
* Prefer the simplest implementation consistent with the established domain model and architecture.
* Before completing a task, verify that the implementation respects module boundaries and does not move business rules into infrastructure.
