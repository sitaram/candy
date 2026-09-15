#!/usr/bin/env bash
# Start a throwaway Redis for tests if none is on the test port. Never touches 6379.
set -e
PORT="${TEST_REDIS_PORT:-6390}"
if redis-cli -p "$PORT" ping >/dev/null 2>&1; then exit 0; fi
command -v redis-server >/dev/null || { echo "redis-server not found (brew install redis)"; exit 1; }
redis-server --port "$PORT" --save '' --appendonly no --daemonize yes --logfile /dev/null >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do redis-cli -p "$PORT" ping >/dev/null 2>&1 && exit 0; sleep 0.1; done
echo "test redis did not start"; exit 1
