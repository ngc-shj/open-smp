#!/usr/bin/env bash
# SC69. Asserts that the jobs and steps this repository's CI is supposed to run
# actually RAN, by asking GitHub what executed rather than by reading ci.yml.
#
# WHY NOT READ THE WORKFLOW. SC68 records the closed form: nothing in the
# repository reads ci.yml's structure, so any edit to it that changes what runs
# is unobserved. Revision 5 of the parity plan tried to close that with a
# substring read and it passed on a commented-out step, on `if: false`, and on
# `continue-on-error: true` — inference from dialect-bearing text. The jobs API
# returns a record of what executed, produced by GitHub.
#
# WHAT IT CATCHES: a step commented out, `if: false` at step or job level, a job
# deleted or renamed (the `needs:` on this job stops resolving, which invalidates
# the workflow — louder than this script), a narrowed matrix.
#
# WHAT IT DOES NOT: its own deletion, the workflow's deletion, or SC68's `on:`
# narrowing. SC56 applies to the observer, and saying so is the point — an
# observer that claimed to close its own class would be the overstatement this
# plan spends its length on.
#
# WHEN IT ASSERTS. Only on a run whose gate jobs all succeeded, which is what
# `needs:` without `if: always()` already guarantees. A failing gate leaves its
# later steps `skipped`, indistinguishable from `if: false` — so on a red run
# this would report the failure twice under a misleading name, and the real red
# is already visible on the job that failed. The question it answers is narrower
# and is the one worth asking: **when CI is green, is it green because
# everything ran?**
set -euo pipefail

MANIFEST="${1:-.github/ci-executed-manifest.json}"
: "${GH_REPO:?GH_REPO is required (owner/name)}"
: "${GH_RUN_ID:?GH_RUN_ID is required}"

if [ ! -f "$MANIFEST" ]; then
  echo "assert-ci-executed: manifest not found: $MANIFEST" >&2
  exit 1
fi

executed="$(mktemp)"
trap 'rm -f "$executed"' EXIT

# `--paginate`: a run with enough jobs pages, and a truncated second page would
# read as "these steps never ran" — a false red, which is the safe direction but
# a confusing one.
gh api "repos/${GH_REPO}/actions/runs/${GH_RUN_ID}/jobs" --paginate \
  --jq '.jobs[] | .name as $job | .steps[]? | select(.conclusion == "success") | "\($job)\t\(.name)"' \
  | sort -u > "$executed"

# Non-empty, or every membership test below passes against nothing — the
# vacuous-pass shape this repository has now recorded eighteen instances of.
if [ ! -s "$executed" ]; then
  echo "assert-ci-executed: the jobs API returned no successful step at all" >&2
  exit 1
fi

# The JOB set, by equality rather than by containment. Step coverage is
# one-directional by necessity — a step added and not listed is simply not
# asserted — but a whole job added and not listed would be a gate nobody
# observes, and that is worth a false red until the manifest names it. This job
# is excluded: it cannot observe itself, and SC56 says so rather than pretending
# otherwise.
observed_jobs="$(cut -f1 "$executed" | sort -u | grep -vxF 'audit' || true)"
expected_jobs="$(jq -r 'keys[]' "$MANIFEST" | sort -u)"
if [ "$observed_jobs" != "$expected_jobs" ]; then
  echo "assert-ci-executed: the run's job set is not the manifest's" >&2
  diff <(echo "$expected_jobs") <(echo "$observed_jobs") | sed 's/^/  /' >&2 || true
  exit 1
fi

missing=0
while IFS=$'\t' read -r job step; do
  [ -n "$job" ] || continue
  if ! grep -qxF "${job}	${step}" "$executed"; then
    echo "assert-ci-executed: ${job} / ${step} did not run" >&2
    missing=1
  fi
done < <(jq -r 'to_entries[] | .key as $job | .value[] | "\($job)\t\(.)"' "$MANIFEST")

if [ "$missing" -ne 0 ]; then
  echo "assert-ci-executed: the run is green but did not execute every gate" >&2
  exit 1
fi

echo "assert-ci-executed: every gate in $MANIFEST executed"
