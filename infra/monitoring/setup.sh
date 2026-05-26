#!/usr/bin/env bash
# Starfleet 4.0 — Bootstrap GCP Cloud Monitoring resources
#
# Usage:
#   export GCP_PROJECT=your-project-id
#   export NOTIFICATION_EMAIL=ops@isomo.tech
#   bash infra/monitoring/setup.sh
#
# Prerequisites: gcloud CLI authenticated with monitoring.admin role

set -euo pipefail

PROJECT="${GCP_PROJECT:?Set GCP_PROJECT}"
EMAIL="${NOTIFICATION_EMAIL:?Set NOTIFICATION_EMAIL}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Creating notification channel (email: $EMAIL)"
CHANNEL_ID=$(gcloud alpha monitoring channels create \
  --project="$PROJECT" \
  --type=email \
  --display-name="Starfleet Ops" \
  --channel-labels="email_address=$EMAIL" \
  --format='value(name)' 2>/dev/null || true)

if [ -z "$CHANNEL_ID" ]; then
  echo "    Channel may already exist. Listing existing channels..."
  CHANNEL_ID=$(gcloud alpha monitoring channels list \
    --project="$PROJECT" \
    --filter="displayName='Starfleet Ops'" \
    --format='value(name)' | head -1)
fi
echo "    Channel: $CHANNEL_ID"

echo "==> Creating log-based metrics"
for METRIC_FILE in "$DIR"/log-metrics.yaml; do
  echo "    Applying $METRIC_FILE (manual — use gcloud logging metrics create)"
done

echo "==> Substituting project/channel in alerts"
ALERTS_TEMP=$(mktemp)
sed -e "s|projects/PROJECT_ID/notificationChannels/NOTIFICATION_CHANNEL_ID|$CHANNEL_ID|g" \
    -e "s|PROJECT_ID|$PROJECT|g" \
    "$DIR/alerts.yaml" > "$ALERTS_TEMP"

echo "==> Creating alert policies"
# Split multi-document YAML and apply each policy
csplit -s -z "$ALERTS_TEMP" '/^---$/' '{*}'
for PART in xx*; do
  POLICY_NAME=$(grep 'displayName:' "$PART" | head -1 | sed 's/.*: "//' | sed 's/"//')
  if [ -n "$POLICY_NAME" ]; then
    echo "    Creating policy: $POLICY_NAME"
    gcloud alpha monitoring policies create \
      --project="$PROJECT" \
      --policy-from-file="$PART" 2>/dev/null || echo "    (may already exist)"
  fi
  rm -f "$PART"
done
rm -f "$ALERTS_TEMP"

echo "==> Creating uptime check"
UPTIME_TEMP=$(mktemp)
sed "s|PROJECT_ID|$PROJECT|g" "$DIR/uptime-check.yaml" > "$UPTIME_TEMP"
gcloud monitoring uptime create \
  --project="$PROJECT" \
  --config-from-file="$UPTIME_TEMP" 2>/dev/null || echo "    (may already exist)"
rm -f "$UPTIME_TEMP"

echo "==> Done. Verify at: https://console.cloud.google.com/monitoring/alerting?project=$PROJECT"
