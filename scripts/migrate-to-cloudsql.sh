#!/usr/bin/env bash
# =============================================================================
# Starfleet: Neon → Cloud SQL migration script
# Run AFTER GCP billing account is cleared.
#
# Prerequisites:
#   brew install libpq      (provides pg_dump)
#   gcloud auth login
#   gcloud config set project isomobrain
#
# Usage:
#   chmod +x scripts/migrate-to-cloudsql.sh
#   ./scripts/migrate-to-cloudsql.sh
# =============================================================================
set -euo pipefail

PROJECT="isomobrain"
REGION="us-central1"
INSTANCE="starfleet-db"
DB_NAME="starfleet"
DB_USER="starfleet"
GCS_BUCKET="isomobrain-sql-imports"
DUMP_FILE="/tmp/starfleet-neon-dump.sql"
DUMP_FILE_GZ="${DUMP_FILE}.gz"
NEON_URL="postgresql://neondb_owner:npg_zy96EgxobHem@ep-lucky-band-amd5pxrn.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require"

# Detect pg_dump (brew install libpq puts it in opt/)
PG_DUMP=""
for p in \
  /opt/homebrew/opt/libpq/bin/pg_dump \
  /usr/local/opt/libpq/bin/pg_dump \
  /usr/bin/pg_dump \
  /usr/local/bin/pg_dump; do
  [ -x "$p" ] && PG_DUMP="$p" && break
done
[ -z "$PG_DUMP" ] && echo "❌  pg_dump not found. Run: brew install libpq" && exit 1
echo "  pg_dump: $PG_DUMP ($($PG_DUMP --version))"

banner() {
  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ── 1. Create Cloud SQL instance ──────────────────────────────────────────────
banner "1/8  Creating Cloud SQL Postgres 15 instance (~5 min)"
if gcloud sql instances describe "$INSTANCE" --project="$PROJECT" &>/dev/null; then
  echo "  ✓  Instance already exists — skipping"
else
  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_15 \
    --tier=db-g1-small \
    --region="$REGION" \
    --project="$PROJECT" \
    --storage-type=SSD \
    --storage-size=10GB \
    --storage-auto-increase \
    --backup-start-time=02:00 \
    --availability-type=zonal \
    --no-deletion-protection \
    --database-flags=max_connections=100
  echo "  ✓  Instance created"
fi

# ── 2. Create DB + user ───────────────────────────────────────────────────────
banner "2/8  Creating database and user"
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
echo "DB_USER=$DB_USER"                              >  /tmp/starfleet-db-creds.txt
echo "DB_PASSWORD=$DB_PASS"                          >> /tmp/starfleet-db-creds.txt
echo "DB_NAME=$DB_NAME"                              >> /tmp/starfleet-db-creds.txt
echo "INSTANCE_CONNECTION_NAME=$PROJECT:$REGION:$INSTANCE" >> /tmp/starfleet-db-creds.txt
echo "  Credentials saved to /tmp/starfleet-db-creds.txt"

gcloud sql databases create "$DB_NAME" \
  --instance="$INSTANCE" --project="$PROJECT" 2>/dev/null \
  || echo "  (database already exists)"

if gcloud sql users describe "$DB_USER" --instance="$INSTANCE" --project="$PROJECT" &>/dev/null; then
  gcloud sql users set-password "$DB_USER" \
    --instance="$INSTANCE" --password="$DB_PASS" --project="$PROJECT"
  echo "  ✓  Reset password for existing user $DB_USER"
else
  gcloud sql users create "$DB_USER" \
    --instance="$INSTANCE" --password="$DB_PASS" --project="$PROJECT"
  echo "  ✓  Created user $DB_USER"
fi

# ── 3. GCS bucket ─────────────────────────────────────────────────────────────
banner "3/8  Creating GCS staging bucket"
gcloud storage buckets create "gs://$GCS_BUCKET" \
  --project="$PROJECT" \
  --location="$REGION" \
  --uniform-bucket-level-access 2>/dev/null \
  || echo "  (bucket already exists)"
echo "  ✓  gs://$GCS_BUCKET"

# ── 4. Dump Neon ──────────────────────────────────────────────────────────────
banner "4/8  Dumping Neon (may take a few minutes)"
"$PG_DUMP" \
  --no-acl --no-owner --clean --if-exists \
  --format=plain \
  --no-password \
  "$NEON_URL" > "$DUMP_FILE"
gzip -f "$DUMP_FILE"
echo "  ✓  Dump: $DUMP_FILE_GZ ($(du -sh "$DUMP_FILE_GZ" | cut -f1))"

# ── 5. Upload to GCS ──────────────────────────────────────────────────────────
banner "5/8  Uploading dump to GCS"
gcloud storage cp "$DUMP_FILE_GZ" "gs://$GCS_BUCKET/starfleet-dump.sql.gz"
SQL_SA=$(gcloud sql instances describe "$INSTANCE" \
  --project="$PROJECT" \
  --format="value(serviceAccountEmailAddress)")
gcloud storage buckets add-iam-policy-binding "gs://$GCS_BUCKET" \
  --member="serviceAccount:$SQL_SA" \
  --role=roles/storage.objectViewer \
  --project="$PROJECT" 2>/dev/null || true
echo "  ✓  Uploaded; granted Cloud SQL SA ($SQL_SA) reader access"

# ── 6. Import into Cloud SQL ──────────────────────────────────────────────────
banner "6/8  Importing into Cloud SQL (may take a few minutes)"
gcloud sql import sql "$INSTANCE" \
  "gs://$GCS_BUCKET/starfleet-dump.sql.gz" \
  --database="$DB_NAME" \
  --project="$PROJECT" \
  --quiet
echo "  ✓  Import complete"

# ── 7. Store secrets ──────────────────────────────────────────────────────────
banner "7/8  Storing secrets in Secret Manager"

store_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT" &>/dev/null; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT"
  else
    printf '%s' "$value" | gcloud secrets create "$name" \
      --data-file=- --replication-policy=automatic --project="$PROJECT"
  fi
  echo "  ✓  $name"
}

store_secret "INSTANCE_CONNECTION_NAME" "$PROJECT:$REGION:$INSTANCE"
store_secret "DB_USER"                  "$DB_USER"
store_secret "DB_PASSWORD"              "$DB_PASS"
store_secret "DB_NAME"                  "$DB_NAME"

# ── 8. Grant Cloud SQL Client role ────────────────────────────────────────────
banner "8/8  Granting Cloud Run SA the Cloud SQL Client role"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$COMPUTE_SA" \
  --role=roles/cloudsql.client \
  --quiet 2>/dev/null || true
echo "  ✓  Granted roles/cloudsql.client → $COMPUTE_SA"

# ── Done ──────────────────────────────────────────────────────────────────────
banner "✅  Migration complete!"
echo
echo "  Credentials: /tmp/starfleet-db-creds.txt"
echo "  Connection:  $PROJECT:$REGION:$INSTANCE"
echo
echo "  Push to main (or manually trigger the deploy workflow)"
echo "  then verify:"
echo "    curl https://api.starfleet.icircles.rw/health"
echo "    curl https://api.starfleet.icircles.rw/health/db"
echo
