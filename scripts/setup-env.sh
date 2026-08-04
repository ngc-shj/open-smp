#!/usr/bin/env sh
# Writes the gitignored `.env` that `docker compose` loads, with an
# ENCRYPTION_KEYS generated on this machine.
#
# NFR1 wants `docker compose up` to boot a working demo stack; NFR4 forbids a
# usable key in the repository. Those two were reconciled by committing a fixed
# demo key into docker-compose.yml, which meant any deployment inheriting that
# file had every tenant's credentials decryptable from a public clone. This
# script is the other reconciliation: the key exists before the stack boots, but
# it is generated per machine and never tracked.
#
# Idempotent by refusing to overwrite. Re-running it must not mint a second key,
# because the first one is already what `saas_apps.credentials_enc` in the
# postgres-data volume was encrypted under — a silent regeneration would leave
# every stored credential undecryptable with no error until the first sync.
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file="$repo_root/.env"
example_file="$repo_root/.env.example"

if [ -f "$env_file" ]; then
  echo "$env_file already exists — leaving it alone."
  exit 0
fi

[ -f "$example_file" ] || { echo "missing $example_file" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl not found; needed to generate ENCRYPTION_KEYS" >&2; exit 1; }

key=$(openssl rand -base64 32)

# `|` as the sed delimiter: base64's alphabet is A-Za-z0-9+/=, so the generated
# key can contain `/` and `+` but never `|`.
sed "s|^ENCRYPTION_KEYS=.*|ENCRYPTION_KEYS=1:$key|" "$example_file" > "$env_file"

# The substitution is verified rather than assumed. `sed` exits 0 when its
# pattern matches nothing, so a renamed key in .env.example would otherwise
# produce a .env carrying the placeholder — and compose would boot with a
# 22-byte "key" that parseEncryptionKeys rejects at startup, blaming the
# operator's environment instead of this script.
written=$(grep '^ENCRYPTION_KEYS=' "$env_file" || true)
encoded=${written#ENCRYPTION_KEYS=1:}
# 32 bytes is 44 base64 characters (43 + one `=` of padding). Measured rather
# than matched against a run of `?` wildcards, where an off-by-one in the
# literal is invisible to a reader and silently widens the check.
if [ "$encoded" = "$written" ] || [ "${#encoded}" -ne 44 ]; then
  rm -f "$env_file"
  echo "failed to write a 32-byte ENCRYPTION_KEYS into $env_file (got: ${written:-none})" >&2
  exit 1
fi

echo "wrote $env_file with a freshly generated ENCRYPTION_KEYS."
echo "It is gitignored. Keep it: the demo stack's stored credentials are encrypted under it."
