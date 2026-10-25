#!/usr/bin/env bash
# Firestore export/import helper for the DR drill (docs/DISASTER_RECOVERY.md).
#   BACKUP_BUCKET=gs://your-backups ./scripts/firestore_dr.sh export
#   BACKUP_BUCKET=gs://your-backups ./scripts/firestore_dr.sh import <path>
set -euo pipefail
PROJECT="${FIREBASE_PROJECT_ID:?FIREBASE_PROJECT_ID is required}"
BUCKET="${BACKUP_BUCKET:?BACKUP_BUCKET is required (gs://...)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
case "${1:-}" in
  export)
    gcloud firestore export "${BUCKET}/firestore/${STAMP}" --project "${PROJECT}" --collection-ids=jobs,job_queue --async ;;
  import)
    SRC="${2:?import requires a source path}"
    read -r -p "Import ${SRC} into ${PROJECT}? OVERWRITES documents. [yes/no] " ok
    [ "${ok}" = "yes" ] || { echo "aborted"; exit 1; }
    gcloud firestore import "${SRC}" --project "${PROJECT}" --async ;;
  list) gcloud storage ls "${BUCKET}/firestore/" --project "${PROJECT}" ;;
  *) echo "usage: $0 export|import <path>|list"; exit 1 ;;
esac