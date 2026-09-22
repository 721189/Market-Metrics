# Contributing to Market-Metrics

This is an **evidence-first** research engine. Every contribution is judged
against the two project invariants:

> **Invariant 1 — The LLM may reason over evidence, but it must never become the evidence.**
>
> **Invariant 2 — LLMs explain. Code calculates.**

If your change lets a number reach a reader without a resolvable citation, or
moves arithmetic into a prompt, it will be rejected no matter how good it looks.

This repository is **proprietary** ([LICENSE](./LICENSE)). Contributing does
not transfer any ownership in the project and does not grant any license beyond
what the LICENSE states. By submitting a change, you confirm you have the
right to submit it.

---

## 1. Ground rules

1. **No fabricated data, ever.** Unknown titles, publishers, dates, hashes, or
   HTTP statuses stay `null` (or the source is skipped) — see Sections 4–5 of
   the README. `new Date().toISOString()` as a stand-in for an unknown
   publication date is a blocking defect.
2. **Quotes are verbatim slices.** Any `quote` persisted on an `Evidence` must
   equal `document_text[start:end]` at the stored offsets. Re-typed or
   re-phrased quotes fail citation-graph validation.
3. **Claims earn SUPPORTED.** New claims start at `UNVERIFIED` and advance rung
   by rung (README Section 5). Relevance scoring is deterministic code, not a
   model call; relevance-from-count heuristics are not accepted.
4. **Contradictions compare propositions, not numbers.** Two claims contradict
   only when their comparison key matches (entity, metric, geography, period,
   population, unit, methodology, source context).
5. **Provenance is a hard invariant.** Every numeric value is `OBSERVED`,
   `CALCULATED` (with formula), `INFERRED`, or `ASSUMED`, and the UI must never
   render these categories as visually equivalent.

---

## 2. Development setup

Prerequisites: **Node >= 22** (`firebase-admin@14` requires it — Node 20
installs produce a partial peer graph and the suite aborts at import time),
npm, Git.

```bash
git clone https://github.com/721189/Market-Metrics.git
cd Market-Metrics
npm ci --no-audit --no-fund
npm run lint        # tsc --noEmit — must exit 0
npm test            # all 15 suites — must report ALL TESTS PASSED
```

Development and test fall back to `firebase-applet-config.json`, so a fresh
checkout runs with no Firebase setup. Production credentials come from the
environment (see README Section 15 and `.env.example`).

Useful commands:

```bash
npm run dev                   # tsx server.ts — API + Vite middleware
npm run build                 # vite build + esbuild -> dist/ and dist/server.cjs
npm start                     # node dist/server.cjs (production bundle)
npm run test:load             # load test only
```
---

## 3. How to contribute

1. **Open an issue first** for anything beyond a typo: what is broken, what is
   the evidence (failing test, log excerpt, run URL), and what you propose.
   Small, scoped proposals merge; redesigns need discussion before code.
2. **Work on a branch** from `main`: `feat/<topic>`, `fix/<topic>`,
   `docs/<topic>`. One concern per branch.
3. **Keep the diff reviewable.** Prefer small commits in the established style
   (`feat(scope): ...`, `fix(ci): ...`, `chore: ...`). A commit that mixes a
   behaviour change with a refactor will be asked to split.
4. **Add or extend tests** for every behaviour change. New pipeline logic needs
   fixture/corpus coverage; new middleware needs harness coverage; new stores
   need cross-instance tests.
5. **Update docs** when behaviour changes: README sections, `.env.example`,
   and `docs/` runbooks where applicable.

### Pull-request checklist

Before requesting review, confirm all of these:

- [ ] `npm run lint` exits 0 (`tsc --noEmit`)
- [ ] `npm test` reports `ALL TESTS PASSED`
- [ ] No new `console.*` calls in `src/server/**` (structured `logger` only —
      CI's no-console guard fails the build otherwise)
- [ ] No abandoned-architecture dependencies reintroduced (`bullmq`,
      `ioredis`, `pg`, `drizzle-orm`, `drizzle-kit`, `@types/pg` — CI's
      dependency-hygiene guard fails otherwise)
- [ ] Exactly one lockfile (`package-lock.json`); `npm ci --dry-run` exits 0
- [ ] Node >= 22 (the suite does not support Node 20)
- [ ] Evidence/claim changes include provenance offsets and verification
      lifecycle coverage; no hardcoded `clm-*` references
- [ ] Docs updated (README / `.env.example` / `docs/` as applicable)

---

## 4. Code style and architecture

- **TypeScript, strict.** No `any` without a comment explaining why. Prefer
  narrow types and exhaustive switches over defensive fallbacks.
- **Deterministic over clever.** Financial math, relevance scoring, lease
  transitions, and citation validation are code with tests — never prompts.
- **Fail closed on security, fail open on availability.** Auth, tenant
  isolation, and admin gating deny by default; rate limiting and caching
  degrade gracefully (see README Sections 10–11).
- **Lease semantics are sacred.** Heartbeat, completion, and recovery prove
  `(worker_id, lease_id, lease_version)` transactionally. A change that lets a
  stale worker write after losing its lease is a data-corruption bug.
- **Events: UUID for identity, sequence for order.** `ResearchEvent.id` is a
  UUID string; `sequence` drives SSE replay. Never coerce between them.

---

## 5. Security

Do **not** open public issues for vulnerabilities — see
[SECURITY.md](./SECURITY.md) for the private reporting path, what to include,
and response expectations. The same file documents the non-negotiable security
rules for contributors (tenant isolation, SSRF boundary, no secrets in code or
logs).

---

## 6. Code of Conduct

All participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
By participating you agree to uphold it. Reports are handled as described in
that document.

---

## 7. Review process and licensing

- Maintainer review is required for every merge to `main`.
- CI must be green: typecheck, the full test matrix, dependency hygiene, the
  no-console guard, and the build. A red build is not a review candidate.
- **Licensing:** this project is proprietary — see [LICENSE](./LICENSE). Your
  contribution is accepted under the repository's license terms; you retain no
  additional rights by contributing, and you must only submit work you have
  the right to submit.