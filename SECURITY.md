# Security Policy — Market-Metrics

## Supported versions

Only the latest commit on `main` is supported with security updates. There
are no maintained release branches at this time.

| Version       | Supported          |
| ------------- | ------------------ |
| `main` (HEAD) | :white_check_mark: |
| Older commits | :x:                |

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion for a security
report.** Public disclosure before a fix puts every deployment at risk.

Report privately to the maintainer via the repository owner's GitHub profile
(@721189) — for example, by opening a **private vulnerability report**
(Security tab → Report a vulnerability) or another private channel linked
from that profile.

Include, at minimum:

1. A description of the vulnerability and its potential impact
2. Steps to reproduce (commands, request shapes, minimal configuration)
3. The commit SHA you tested against (`git rev-parse HEAD`)
4. Any relevant logs, redacted of secrets (never send real credentials,
   tokens, or private keys)

You can expect:

- Acknowledgement as soon as the report is seen
- A good-faith assessment of severity and scope
- A fix committed to `main` (or an explanation if the report is not accepted
  as a vulnerability)
- No public disclosure timeline imposed on you, and credit if you want it

## Non-negotiable rules for contributors

These are blocking review findings — a PR violating any of them is rejected:

1. **Tenant isolation is absolute.** Every Firestore read/write path filters by
   the authenticated owner's UID. Cross-tenant access must return null/deny,
   never data. `user_id` (document field) and `userId` (auth token claim) live
   in different namespaces — do not "unify" them without proving both read and
   write paths still isolate.
2. **SSRF boundary is a hard perimeter.** Outbound fetch validates the URL
   scheme, resolves DNS, rejects private/link-local/reserved ranges (IPv4 and
   IPv6), re-validates redirect targets, caps response size, enforces the MIME
   allowlist, and applies per-host budgets. Any change that weakens a check or
   skips re-validation on redirect is rejected.
3. **No secrets in code, logs, or artifacts.** Credentials live in the
   environment (see `.env.example`), never in source, tests, fixtures, or
   committed config. Structured logs must not contain tokens, keys, or PII.
4. **Admin gating is server-side.** Administrative paths (`/system/*`,
   `/admin/*`, `/metrics`, `/errors`, `/backup`, `/restore`) are blocked by
   middleware keyed on `ADMIN_UIDS`. Frontend visibility is not authorization.
5. **Dependencies are deliberate.** Do not reintroduce the removed stacks
   (`bullmq`, `ioredis`, `pg`, `drizzle-orm`, `drizzle-kit`, `@types/pg`) and
   do not add network or crypto dependencies without justification in the PR.
   CI's dependency-hygiene guard enforces this mechanically.

## Scope notes

- The Firestore test harness is an in-memory mock. It proves application-level
  isolation logic deterministically, but it does **not** execute the real
  Firestore rules engine — rule changes additionally require verification
  against the live emulator before release.
- Rate limiting is cost control, not a security boundary. It fails open by
  design; authorization is enforced separately.
- Reports about third-party dependencies should include the advisory ID (e.g.
  GHSA-xxxx) and the affected version range where known.