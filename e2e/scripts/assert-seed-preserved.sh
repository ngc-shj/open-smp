#!/usr/bin/env bash
# Automated N6 gate (round-1 TEST-F-6): asserts the seed acceptance bar is
# still intact after a full e2e suite run — the 4 seeded emails carry their
# original link statuses AND the orphan account has "label":null. Runs
# locally as part of the Phase-3 gate and in CI immediately after
# `pnpm test:e2e`, mirroring the curl-gate idiom ci.yml already uses.
set -euo pipefail

API_URL="${E2E_API_URL:-http://localhost:3001}"
APP_ORIGIN="${E2E_APP_ORIGIN:-http://localhost:3000}"
TENANT_SLUG="${E2E_TENANT_SLUG:-demo}"
DEMO_EMAIL="${E2E_DEMO_EMAIL:-admin@demo.example}"
DEMO_PASSWORD="${E2E_DEMO_PASSWORD:-demo-admin-password}"

# mktemp cookie jar + login-response scratch file, both removed on exit via
# trap (success AND failure paths — round-2 SEC-E9).
COOKIE_JAR="$(mktemp)"
LOGIN_RESPONSE="$(mktemp)"
trap 'rm -f "$COOKIE_JAR" "$LOGIN_RESPONSE"' EXIT

login_status="$(curl -sS -o "$LOGIN_RESPONSE" -w '%{http_code}' \
  -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: ${APP_ORIGIN}" \
  -d "{\"tenantSlug\":\"${TENANT_SLUG}\",\"email\":\"${DEMO_EMAIL}\",\"password\":\"${DEMO_PASSWORD}\"}" \
  "${API_URL}/api/auth/login")"

if [ "$login_status" != "200" ]; then
  echo "assert-seed-preserved: login did not return 200 (got ${login_status})" >&2
  cat "$LOGIN_RESPONSE" >&2 || true
  exit 1
fi

accounts_json="$(curl -sS -b "$COOKIE_JAR" "${API_URL}/api/accounts")"

assert_status() {
  local email="$1"
  local expected_status="$2"
  local actual
  actual="$(echo "$accounts_json" | jq -r --arg email "$email" \
    '.items[] | select(.email == $email) | .link.status')"
  if [ "$actual" != "$expected_status" ]; then
    echo "assert-seed-preserved: ${email} expected link.status=${expected_status}, got '${actual}'" >&2
    exit 1
  fi
  echo "assert-seed-preserved: ${email} -> ${actual} (ok)"
}

assert_status 'alice.tanaka@demo.example' 'matched'
assert_status 'bob.suzuki@demo.example' 'ghost'
assert_status 'shared.mailbox@demo.example' 'ambiguous'
assert_status 'unknown.contractor@demo.example' 'orphan'

# Labels are checked on ALL FOUR seeded accounts, not just the orphan: a
# bulk-labeling spec touches several of them, and a teardown that misses one
# leaves the shared stack poisoned for every later run — silently, if the gate
# only ever inspected the orphan.
assert_label_null() {
  local email="$1"
  local actual
  actual="$(echo "$accounts_json" | jq -r --arg email "$email" \
    '.items[] | select(.email == $email) | .label')"
  if [ "$actual" != "null" ]; then
    echo "assert-seed-preserved: ${email} expected label=null, got '${actual}'" >&2
    exit 1
  fi
  echo "assert-seed-preserved: ${email} label -> null (ok)"
}

assert_label_null 'alice.tanaka@demo.example'
assert_label_null 'bob.suzuki@demo.example'
assert_label_null 'shared.mailbox@demo.example'
assert_label_null 'unknown.contractor@demo.example'

# The seeded app's displayName. apps.spec.ts renames it and restores in
# afterEach — which does not run when a spec crashes mid-test. This leak is
# worse than a leaked label because the seeder never repairs it: seed.ts looks
# up (tenant_id, key) and returns the existing id on a hit without re-applying
# display_name, so a leaked rename survives every `docker compose up` forever.
apps_json="$(curl -sS -b "$COOKIE_JAR" "${API_URL}/api/saas-apps")"
app_display_name="$(echo "$apps_json" | jq -r \
  '.items[] | select(.key == "google-workspace") | .displayName')"
if [ "$app_display_name" != "Google Workspace" ]; then
  echo "assert-seed-preserved: seeded app expected displayName='Google Workspace', got '${app_display_name}'" >&2
  exit 1
fi
echo "assert-seed-preserved: seeded app displayName -> ${app_display_name} (ok)"

# C6's contracts. The licences spec uploads a CSV, which is the first e2e path
# that can write saas_contracts and saas_apps — so the seeded figures now have
# a way to be overwritten, and a seeded fact no gate inspects is a leak nobody
# finds. Read from /api/licenses rather than the table, because the derived
# figures (unassigned, reclaimable) are what the demo's argument rests on and
# only the rollup produces them.
licenses_json="$(curl -sS -b "$COOKIE_JAR" "${API_URL}/api/licenses")"

assert_license() {
  local app_key="$1"
  local field="$2"
  local expected="$3"
  local actual
  actual="$(echo "$licenses_json" | jq -r --arg key "$app_key" --arg field "$field" \
    '.items[] | select(.appKey == $key) | .[$field] | tostring')"
  if [ "$actual" != "$expected" ]; then
    echo "assert-seed-preserved: ${app_key}.${field} expected ${expected}, got '${actual}'" >&2
    exit 1
  fi
  echo "assert-seed-preserved: ${app_key}.${field} -> ${actual} (ok)"
}

# Three purchased against four assigned. The negative `unassigned` is the whole
# point of the demo seed and the one figure a clamp would silently erase.
assert_license 'google-workspace' 'purchased' '3'
assert_license 'google-workspace' 'assigned' '4'
assert_license 'google-workspace' 'unassigned' '-1'
assert_license 'google-workspace' 'unitPrice' '12.00'

# The application the connectors do not sync: a contract, no connector, no
# accounts.
assert_license 'notion' 'purchased' '25'
assert_license 'notion' 'assigned' '0'
assert_license 'notion' 'hasConnector' 'false'
assert_license 'notion' 'billingCycle' 'annual'

echo "assert-seed-preserved: seed acceptance bar intact"
