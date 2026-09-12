#!/usr/bin/env bash
# run_bot.sh — launch edgeHunter bot in background, isolate stdin.
# Usage: run_bot.sh <BOT_ID> <UNIVERSE_FILE> <MAX_PAIRS> <INTERVALS>
set -u
BOT_ID="$1"
UNI="$2"
MAX="$3"
INTS="$4"
LOG="bot_${BOT_ID}.log"
node server/crypto/backtest/edgeHunter.mjs "$UNI" "$MAX" < /dev/null > "$LOG" 2>&1
echo "BOT_EXIT=$?" >> "$LOG"
