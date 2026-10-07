#!/usr/bin/env bash
# t_450d02f0 final DoD check: Ada deactivates Grace (PATCH /users/:id), then a
# fresh login attempt as Grace must get the contract's uniform 401.
set -euo pipefail
BASE=http://localhost:3101/api/v1
WORK="$TMPDIR/qalm-verify"
mkdir -p "$WORK"

# 1) Ada logs in (current password after the change-password step)
curl -s -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"n3wsecretpw"}' \
  "$BASE/auth/login" > "$WORK/ada_login.json"

python3 - "$WORK/ada_login.json" "$WORK/ada_access" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))["data"]
assert data["user"]["role"] == "admin", data["user"]
open(sys.argv[2], "w").write(data["access_token"])
print("ada login ok, role:", data["user"]["role"])
PY

TOKEN=$(cat "$WORK/ada_access")
GRACE_ID=$(python3 -c "import json;print(json.load(open('$WORK/ada_login.json')) is not None and '')" ; true)
# Grace's id is taken from her earlier /auth/me response saved during this run:
GRACE_ID=$(cat "$WORK/grace_id" 2>/dev/null || echo "06c3fc4c-efea-4041-8e1c-c0cb1c193862")

# 2) Deactivate Grace
echo "--- PATCH /users/$GRACE_ID {\"is_active\": false}"
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"is_active": false}' "$BASE/users/$GRACE_ID" | head -c 300
echo

# 3) Fresh login attempt as Grace must get the uniform 401
echo "--- POST /auth/login as deactivated grace"
curl -s -H 'Content-Type: application/json' \
  -d '{"email":"grace@example.com","password":"temporal1"}' \
  -o "$WORK/grace_401.json" -w "HTTP %{http_code}\n" "$BASE/auth/login"
cat "$WORK/grace_401.json"
echo
# and the byte-identical wrong-password response:
curl -s -H 'Content-Type: application/json' \
  -d '{"email":"grace@example.com","password":"totally-wrong9"}' \
  -o "$WORK/grace_401b.json" "$BASE/auth/login"
cmp "$WORK/grace_401.json" "$WORK/grace_401b.json" && echo "401 bodies byte-identical: yes"
