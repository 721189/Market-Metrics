# Disaster recovery — Firestore + storage

## Targets (state them, then test them)

| Metric | Target | How it is achieved |
|---|---|---|
| RPO (max data loss) | **15 minutes** | Scheduled Firestore export to GCS every 15 min; Firestore PITR (7 days) as the fast path |
| RTO (time to restore) | **< 2 hours** | Import into a pre-created project, repoint `FIREBASE_PROJECT_ID`, redeploy |
| Backup retention | 30 days daily + 7 days PITR | GCS lifecycle policy on the export bucket |

If you cannot meet these numbers, change them here — do not leave them implied.

## What must be recoverable

- `jobs`, `job_queue` — research documents, events, reports (source of truth).
- Firebase Storage artifacts (exports, PDFs) — use the same bucket/lifecycle policy.
- **Secrets are NOT in the backup**: `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`, `SYNAPSE_*`
  live in the platform's env store. Keep them in a password manager; restoring
  without them yields a running-but-unauthenticated service.

## Drill (run quarterly, record the result)

1. `./scripts/firestore_dr.sh export` — exports to `gs://$BACKUP_BUCKET/firestore/$(date)`.
2. Create a scratch project (or a scratch database in the same project).
3. `./scripts/firestore_dr.sh import <export-path>` against it.
4. Point a staging deploy at the scratch project and sign in.
5. Verify, and record the timings:
   - a completed job renders its report;
   - a queued job is claimed within 30s (worker healthy);
   - `/health` is 200 and `/ready` is 200;
   - row counts match the source (`jobs` and `job_queue` collection counts).
6. Record: export duration, import duration, total wall clock, discrepancies.
7. Destroy the scratch environment.

## Failure modes this covers

- Accidental/buggy bulk delete in `jobs` (app bug or admin mistake).
- Corrupted writes from a bad deploy (restore to the preceding export).
- Region-level outage (restore into a different region/project).

## Failure modes this does NOT cover

- A compromised service account (it can delete backups too) — use a **separate,
  write-only** identity for exports and Object Lock / retention on the bucket.
- Logical corruption discovered after the retention window.
