#!/usr/bin/env bash
set -euo pipefail
base="${BASE_URL:-http://localhost:3000}"

echo "==== 1 extract ===="
curl -s -X POST "$base/api/v1/extract" \
  -H "Content-Type: application/json" \
  -d '{"text":"Book dentist next Friday at 3pm","reference_date":"2025-09-19"}'
echo

echo "==== 2 entities ===="
curl -s -X POST "$base/api/v1/entities" \
  -H "Content-Type: application/json" \
  -d '{"text":"Book dentist next Friday at 3pm","reference_date":"2025-09-19"}'
echo

echo "==== 3 normalize ===="
curl -s -X POST "$base/api/v1/normalize" \
  -H "Content-Type: application/json" \
  -d '{"entities":{"date_phrase":"next Friday","time_phrase":"3pm","department":"dentist"},"reference_date":"2025-09-19"}'
echo

echo "==== 4 appointment ===="
curl -s -X POST "$base/api/v1/appointments" \
  -H "Content-Type: application/json" \
  -d '{"text":"Book dentist next Friday at 3pm","reference_date":"2025-09-19"}'
echo

echo "==== noisy text ===="
curl -s -X POST "$base/api/v1/pipeline" \
  -H "Content-Type: application/json" \
  -d '{"text":"book dentist nxt Friday @ 3 pm","reference_date":"2025-09-19"}'
echo

echo "==== guardrail ===="
curl -s -X POST "$base/api/v1/appointments" \
  -H "Content-Type: application/json" \
  -d '{"text":"Book dentist Friday or Monday at 3pm","reference_date":"2025-09-19"}'
echo

if [[ -f samples/ocr-note.png ]]; then
  echo "==== image ===="
  curl -s -X POST "$base/api/v1/pipeline" \
    -F "reference_date=2025-09-19" \
    -F "image=@samples/ocr-note.png"
  echo
fi
