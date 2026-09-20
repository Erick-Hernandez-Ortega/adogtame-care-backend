# Adogtame Care Backend

## Project context

- Use pnpm as the package manager and to run project scripts. Do not use npm, Yarn, or Bun.
- Build the backend with NestJS and TypeScript.
- Treat the application as a modular monolith.
- Expose a REST API initially.
- Use PostgreSQL as the database, with Drizzle ORM for queries and persistence.
- Use PostgreSQL in Docker for local development and Neon for remote environments.
- Use Resend for email delivery.
- The testing strategy is still to be defined. Do not assume a testing approach or add testing tools without an explicit request.
- Do not install dependencies unless the user explicitly requests it.

## Architecture scope

- Do not make broad architecture decisions, reorganize modules, or introduce abstractions unless the user requests it. The user owns the architecture and will evolve these instructions.
- Keep each requested change focused and consistent with the structure that already exists.

## TypeScript conventions

- Write all code in English, including identifiers, file names, type names, error messages, and code comments.
- Never use `any`, either explicitly or implicitly. Use a precise type, a generic, or `unknown` with proper narrowing.
- Place types in the file that owns the corresponding contract. Extract them to a dedicated file only when reuse or module boundaries justify it.
- Use `interface` for object shapes. Use `type` for unions, intersections, primitives, tuples, function signatures, and other non-object definitions.
- Prefer `as const` objects and derived union types over TypeScript `enum` declarations.
- Add explicit types to variables, parameters, functions, and methods when the type remains clear and reasonably concise. This includes simple declarations such as `const isActive: boolean = false` and explicit function return types. Use inference when spelling out the type would be disproportionately complex; never use `any` as a shortcut.
- Use descriptive names. Avoid abbreviated variable and parameter names, including callback parameters. Prefer `find((array) => array.pop())` over `find((a) => a.pop())` when `array` accurately describes the value.
- Prefix boolean names with `is` or `has` when either prefix expresses the meaning clearly.
- Name arrays and other collections with plural nouns, such as `users`.
- Do not chain more than one ternary expression. Use `if`/`else` or `switch` when the logic has more than two branches.

## Comments and documentation

- Prefer self-explanatory code over comments. Do not add comments that merely restate what the code does.
- Add a comment only when an important function, non-obvious decision, constraint, or tradeoff cannot be expressed clearly through names and structure.
- Keep comments close to the code they explain, but never place comments or documentation blocks above import statements. Imports must remain at the beginning of the file.
- Write every code comment in English.
- When a module, function, or process needs extensive explanation or many comments, create a focused Markdown document instead and keep only a concise reference near the relevant code when necessary.

## Git commits

- Follow the Conventional Commits specification.
- Write commit messages in English using the format `type(scope): description`. The scope is optional and should identify the affected module or area when useful.
- Use an appropriate type such as `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `style`, or `revert`.
- Write the description in lowercase imperative form without a trailing period.
- Mark breaking changes with `!` before the colon and explain them in a `BREAKING CHANGE:` footer when more context is required.
- Keep each commit focused on one coherent change.

## Formatting and validation

- Follow the repository's ESLint and Prettier configuration.
- Use single quotes and trailing commas as configured by Prettier.
- Run the relevant pnpm lint and build commands after code changes. Run tests once the project defines a testing strategy or when the changed area already has relevant tests.
