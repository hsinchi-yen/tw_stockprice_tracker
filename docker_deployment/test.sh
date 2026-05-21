#!/bin/bash
# Two-round smoke test for TW Stock Tracker deployment.
# Run on the remote after deploy.sh succeeds.
set -e

PASS=0; FAIL=0
ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

# ── Round 1: Infrastructure ───────────────────────────────────────────────────
echo ""
echo "=============================="
echo " TEST ROUND 1 — Infrastructure"
echo "=============================="

# 1-1 Both containers running
docker inspect -f '{{.State.Running}}' twstock-backend  2>/dev/null | grep -q true \
  && ok "twstock-backend container running" || fail "twstock-backend container NOT running"
docker inspect -f '{{.State.Running}}' twstock-frontend 2>/dev/null | grep -q true \
  && ok "twstock-frontend container running" || fail "twstock-frontend container NOT running"

# 1-2 Backend health endpoint
HEALTH=$(curl -sf http://localhost:3000/api/health 2>/dev/null)
echo "$HEALTH" | grep -q '"ok"' \
  && ok "GET /api/health → {status:ok}" || fail "GET /api/health failed (got: $HEALTH)"

# 1-3 Frontend reachable
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8503/ 2>/dev/null)
[ "$HTTP_CODE" = "200" ] \
  && ok "Frontend HTTP 200 on :8503" || fail "Frontend returned HTTP $HTTP_CODE on :8503"

# 1-4 stocks table exists (DB layer)
docker exec twstock-backend sh -c \
  "node -e \"const db=require('better-sqlite3')('/app/data/stocks.db'); console.log(db.prepare('SELECT count(*) as n FROM stocks').get().n)\"" \
  > /dev/null 2>&1 \
  && ok "SQLite stocks table accessible" || fail "SQLite stocks table NOT accessible"

echo ""
echo "Round 1: $PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && { echo "ABORT — fix Round 1 failures before Round 2."; exit 1; }

# ── Round 2: API Functional ───────────────────────────────────────────────────
echo ""
echo "=============================="
echo " TEST ROUND 2 — API Functional"
echo "=============================="

TEST_TICKER="9999.TW"

# 2-1 GET /api/stocks returns JSON array
STOCKS=$(curl -sf http://localhost:3000/api/stocks 2>/dev/null)
echo "$STOCKS" | python3 -c "import sys,json; a=json.load(sys.stdin); assert isinstance(a,list)" 2>/dev/null \
  && ok "GET /api/stocks → JSON array" || fail "GET /api/stocks not a JSON array"

# 2-2 POST add test stock
ADD=$(curl -sf -X POST http://localhost:3000/api/stocks \
  -H "Content-Type: application/json" \
  -d "{\"tickers\":[\"$TEST_TICKER\"]}" 2>/dev/null)
echo "$ADD" | grep -q '"ok":true' \
  && ok "POST /api/stocks add $TEST_TICKER" || fail "POST /api/stocks add failed: $ADD"

# 2-3 Stock appears in list
FOUND=$(curl -sf http://localhost:3000/api/stocks 2>/dev/null | python3 -c \
  "import sys,json; stocks=json.load(sys.stdin); print('yes' if any(s['ticker']=='$TEST_TICKER' for s in stocks) else 'no')" 2>/dev/null)
[ "$FOUND" = "yes" ] \
  && ok "$TEST_TICKER appears in GET /api/stocks" || fail "$TEST_TICKER NOT found in stock list"

# 2-4 PUT update buy_target
UPD=$(curl -sf -X PUT http://localhost:3000/api/stocks/$TEST_TICKER \
  -H "Content-Type: application/json" \
  -d '{"buyTarget":100,"sellTarget":120}' 2>/dev/null)
echo "$UPD" | grep -q '"ok":true' \
  && ok "PUT /api/stocks/$TEST_TICKER set targets" || fail "PUT targets failed: $UPD"

# 2-5 Targets persisted
TARGETS=$(curl -sf http://localhost:3000/api/stocks 2>/dev/null | python3 -c \
  "import sys,json; stocks=json.load(sys.stdin); s=next((x for x in stocks if x['ticker']=='$TEST_TICKER'),None); print(s['buyTarget'],s['sellTarget']) if s else print('none')" 2>/dev/null)
echo "$TARGETS" | grep -q "100" \
  && ok "buyTarget=100 persisted correctly" || fail "buyTarget not persisted: got '$TARGETS'"

# 2-6 Rate-limit guard (>50 symbols should be rejected)
MANY=$(python3 -c "print(','.join([f'{i:04d}.TW' for i in range(51)]))")
RL=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/quotes?symbols=$MANY" 2>/dev/null)
[ "$RL" = "400" ] \
  && ok "Rate-limit: 51 symbols → HTTP 400" || fail "Rate-limit not triggered (got HTTP $RL)"

# 2-7 DELETE test stock
DEL=$(curl -sf -X DELETE http://localhost:3000/api/stocks/$TEST_TICKER 2>/dev/null)
echo "$DEL" | grep -q '"ok":true' \
  && ok "DELETE /api/stocks/$TEST_TICKER" || fail "DELETE failed: $DEL"

# 2-8 Stock gone after delete
AFTER=$(curl -sf http://localhost:3000/api/stocks 2>/dev/null | python3 -c \
  "import sys,json; stocks=json.load(sys.stdin); print('yes' if any(s['ticker']=='$TEST_TICKER' for s in stocks) else 'no')" 2>/dev/null)
[ "$AFTER" = "no" ] \
  && ok "$TEST_TICKER removed from list" || fail "$TEST_TICKER still present after DELETE"

# 2-9 Nginx proxy: /api/health via port 8503
PROXY=$(curl -sf http://localhost:8503/api/health 2>/dev/null)
echo "$PROXY" | grep -q '"ok"' \
  && ok "Nginx proxy: GET :8503/api/health → OK" || fail "Nginx proxy failed: $PROXY"

echo ""
echo "Round 2: $((PASS-4)) passed, $FAIL failed"
echo "=============================="
echo " TOTAL: $PASS passed, $FAIL failed"
echo "=============================="
[ "$FAIL" -gt 0 ] && exit 1 || echo "ALL TESTS PASSED"
