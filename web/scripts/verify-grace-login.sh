#!/usr/bin/env bash
# t_450d02f0 verification helper: log in as Grace via curl, save cookie jar
# and access token for the deactivation check. Throwaway verification script.
set -euo pipefail
DIR="$(mktemp -d)"
JAR="$DIR/grace.jar"
BODY='{"email":"grace@example.com","password":"temporal1"}'
curl -s -c "$JAR" -H 'Content-Type: application/json' -d "$BODY" \
  http://localhost:3101/api/v1/auth/login > "$DIR/login.json"
python3 - "$DIR/login.json" "$DIR/grace_access" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))["data"]
print("role:", data["user"]["role"], "| must_change_password:", data["user"]["must_change_password"])
open(sys.argv[2], "w").write(data["access_token"])
PY
mkdir -p "$TMPDIR/qalm-verify"
echo "$DIR" > "$TMPDIR/qalm-verify/grace_dir"
echo "$JAR" > "$TMPDIR/qalm-verify/grace_jar_path"
cp "$DIR/grace_access" "$TMPDIR/qalm-verify/grace_access"
grep -c qalm_refresh "$JAR"
