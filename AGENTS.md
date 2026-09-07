# Repository Operating Guide

## Scope

These instructions apply to this repository. More specific `AGENTS.md` files in subdirectories override them.

Before changing a component, read the relevant package/config files and the applicable service or module documentation for that component.

Code and documentation changes should be scoped to the user’s request. Do not expand the architecture, introduce new systems, or make opportunistic refactors unless explicitly requested.

## Repository Map

- `src/worker.ts` — Cloudflare Worker entry point; forwards all requests to the counter handler.
- `src/counter.ts` — request routing, Bearer-token validation, visitor-cookie deduplication, validation, Redis commands, and structured logging.
- `src/types.ts` — Worker environment and API request/response types.
- `test/counter.test.ts` — Worker-level API behavior tests using the Cloudflare Vitest pool and an in-memory Upstash HTTP mock.
- `wrangler.toml` — Worker name, entry point, and Cloudflare compatibility date.
- `vitest.config.mts` — Vitest Worker-pool configuration and non-secret test bindings.
- `README.md` — current public API, local-development, secret-setup, and deployment instructions.
- `PRD.md` — draft product background; its Durable Objects proposal is not the current implementation.

## Sources Of Truth

- `src/worker.ts`, `src/counter.ts`, and `src/types.ts` define the deployed request behavior, required `UPSTASH_URL`, `UPSTASH_TOKEN`, and `ACCESS_TOKEN` environment bindings, Redis key layout, and API response shapes.
- `wrangler.toml` defines the Cloudflare Worker entry point and deployment configuration. Production credentials are Cloudflare secrets; local credentials belong only in the gitignored `.dev.vars` file.
- `test/counter.test.ts` and `vitest.config.mts` define regression expectations. Tests mock the Upstash REST API and must not require a live Redis database.
- `README.md` defines the public API contract and supported development/deployment workflow. Keep it synchronized with any behavior, endpoint, secret, or operational change.
- `PRD.md` is a draft and describes a Durable Objects-backed design without the current auth and upvote behavior. When it conflicts with source, tests, or README, treat the current implementation and tests as authoritative; update the PRD only when intentionally changing product direction.

The implementation and tests define current behavior. The user request defines intended behavior. If they differ, surface the discrepancy and resolve it explicitly.

Do not hand-edit generated files. Use the repository’s documented generation, migration, or build commands.

## Coding Guidelines

- Think before coding. Surface assumptions, ambiguities, and tradeoffs instead of silently guessing.
- If multiple interpretations are plausible, say so. Prefer the simplest valid interpretation.
- Prefer the minimum code required to solve the task. Do not add speculative features, abstractions, configurability, or unnecessary defensive logic.
- Keep changes surgical. Touch only code directly related to the request and preserve the existing project style and structure.
- Do not refactor, reformat, rename, or clean up unrelated code unless explicitly asked.
- Remove only imports, variables, functions, or files made unused by your own changes. Mention unrelated dead code instead of deleting it.
- Every changed line should be traceable to the requested task. If a change cannot be justified by the request, leave it out.
- Define verifiable success criteria before implementation. Prefer tests or concrete checks over vague goals like "make it work."
- For bugs, reproduce the failure first when practical, then fix it and verify the regression is covered.
- For refactors, verify behavior before and after the change.
- For larger tasks, state a short implementation plan with a verification step for each stage.
- If the solution becomes significantly more complex than necessary, simplify it before finishing.
- Optimize for small diffs, predictable behavior, and correctness over speed. Use judgment for trivial tasks.
- Preserve atomic counter updates: global counter mutations use the Redis Lua `EVAL` path, while post upvotes use Redis `INCR`. Do not replace either with a Worker-side read-modify-write sequence.
- Keep `/increment` visitor deduplication, cookie attributes, authenticated access, JSON error shapes, and counter floor behavior aligned with their tests and README.
- Treat incoming bodies and Redis values as untrusted. Preserve bounded parsing and validation when changing request or storage behavior.
- Keep external storage calls behind the existing `redisCommand` helper unless the request explicitly requires a new integration.

## Architecture Boundaries

Do not introduce new:

- services
- libraries
- databases
- queues
- architectural patterns
- abstractions
- background workers
- state management systems

without explicitly explaining why and asking first.

Implement only the architecture requested. If the requested design has problems, point them out before writing code rather than silently redesigning it.

## Documentation

Update the applicable README, service guide, or module documentation in the same change when modifying behavior, APIs, lifecycle, configuration, operations, or structure.

Keep durable architecture notes, workflows, and project-specific conventions in the appropriate documentation instead of growing this file unnecessarily.

## Commands

Run from the repository root:

- `npm test` — runs the full Worker API suite with the in-memory Upstash mock.
- `npm test -- test/counter.test.ts` — runs this repository's sole test file.
- `npx tsc --noEmit` — type-checks `src/**/*.ts` with the repository's strict TypeScript configuration.
- `npm run dev` — starts local development through `wrangler dev`; requires non-production values in `.dev.vars`.
- `npm run cf-typegen` — generates Cloudflare Worker types if Cloudflare bindings are added or changed. Do not hand-edit its generated output.
- `npm run deploy` — deploys to Cloudflare and is intentionally not a routine verification command; run only with explicit authorization.

Do not report a command as passing unless it actually completed successfully. If a command is known to be unavailable, flaky, environment-dependent, or currently empty, state that clearly.

## Safety Boundaries

Do not read, expose, or commit secret values.

Do not modify secret-bearing `.env` files. Public environment templates such as `.env.example` may be updated when the public configuration contract changes.

Do not weaken tests, lint rules, type checks, or validation gates to make a change pass.

Do not rewrite Git history or run destructive commands unless explicitly requested.

Do not commit, push, merge, deploy, publish, or release unless explicitly asked.

Ask before adding production dependencies or running destructive database or infrastructure commands.

## Commits

Commit messages must be specific, detailed, and production-level.

Use a precise Conventional Commit subject. Add a body when the change needs context, including the intent, affected behavior or scope, important implementation decisions, and verification.

Avoid generic messages such as `update docs`, `fix stuff`, or `misc changes`.

## Final Response Expectations

When work is complete, report:

- what changed
- which files changed
- which checks were run
- any checks that could not be run
- any residual risks or follow-up work

Keep the summary concise and grounded in the actual diff.
