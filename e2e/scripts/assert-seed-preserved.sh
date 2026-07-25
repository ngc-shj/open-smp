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

orphan_label="$(echo "$accounts_json" | jq -r \
  '.items[] | select(.email == "unknown.contractor@demo.example") | .label')"
if [ "$orphan_label" != "null" ]; then
  echo "assert-seed-preserved: orphan account expected label=null, got '${orphan_label}'" >&2
  exit 1
fi
echo "assert-seed-preserved: orphan label -> null (ok)"

echo "assert-seed-preserved: seed acceptance bar intact"
