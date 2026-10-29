#!/usr/bin/env bash
# Post one dashboard section. Never prints BOT_OFFICE_TOKEN.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: report-dashboard.sh <section> <json-file-or-stdin>"
  exit 1
fi

section=$1

trim_line() {
  local line=$1
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  printf '%s' "$line"
}

load_env_file() {
  local file=$1 line key val
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    line=$(trim_line "$line")
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" == export\ * ]]; then
      line=$(trim_line "${line#export }")
    fi
    case "$line" in
      BOT_OFFICE_URL=*|BOT_OFFICE_TOKEN=*)
        key=${line%%=*}
        val=${line#*=}
        if [[ "$val" == \"*\" ]]; then
          val=${val#\"}
          val=${val%\"}
        elif [[ "$val" == \'*\' ]]; then
          val=${val#\'}
          val=${val%\'}
        fi
        if [[ -z "${!key:-}" ]]; then
          printf -v "$key" '%s' "$val"
          export "$key"
        fi
        ;;
    esac
  done < "$file"
}

if [[ -z "${BOT_OFFICE_URL:-}" || -z "${BOT_OFFICE_TOKEN:-}" ]]; then
  load_env_file "${BOT_OFFICE_ENV:-/workspace/bot-office/.env}"
fi

if [[ -z "${BOT_OFFICE_URL:-}" || -z "${BOT_OFFICE_TOKEN:-}" ]]; then
  echo "report failed: set BOT_OFFICE_URL and BOT_OFFICE_TOKEN"
  exit 1
fi

url=$BOT_OFFICE_URL
while [[ "$url" == */ ]]; do
  url=${url%/}
done

read_stdin() {
  if command -v cat >/dev/null 2>&1; then
    cat
    return
  fi
  local line out
  out=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    out+="$line"$'\n'
  done
  printf '%s' "$out"
}

if [[ $# -eq 2 && "$2" != "-" ]]; then
  if [[ ! -f "$2" || ! -r "$2" ]]; then
    echo "report failed: cannot read $2"
    exit 1
  fi
  if ! raw=$(<"$2"); then
    echo "report failed: cannot read $2"
    exit 1
  fi
else
  raw=$(read_stdin)
fi

if [[ -z "${raw//[[:space:]]/}" ]]; then
  echo "report failed: empty JSON"
  exit 1
fi

json_escape() {
  local s i c out hex
  local -i n
  s=$1
  out=""
  n=${#s}
  for ((i = 0; i < n; i++)); do
    c=${s:i:1}
    case "$c" in
      "\\") out+='\\' ;;
      '"') out+='\"' ;;
      $'\n') out+='\n' ;;
      $'\r') out+='\r' ;;
      $'\t') out+='\t' ;;
      [[:cntrl:]])
        printf -v hex '%d' "'$c"
        printf -v out '%s\\u%04x' "$out" "$hex"
        ;;
      *) out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}

build_body() {
  local section=$1 raw=$2
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg section "$section" --argjson data "$raw" '{section:$section,data:$data}'
    return
  fi
  printf '{"section":"%s","data":%s}' "$(json_escape "$section")" "$raw"
}

if ! body=$(build_body "$section" "$raw"); then
  echo "report failed: could not encode JSON"
  exit 1
fi

set +e
resp=$(curl -sS --retry 0 --max-time 8 -w $'\n%{http_code}' \
  -X POST "$url/api/dashboard" \
  -H "Authorization: Bearer ${BOT_OFFICE_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "$body" 2>&1)
code=$?
set -e

if [[ $code -ne 0 ]]; then
  IFS= read -r errline <<< "$resp"
  echo "report failed: ${errline:-could not reach the office}"
  exit 1
fi

http=${resp##*$'\n'}
msg=${resp%$'\n'*}
if [[ "$http" != "200" ]]; then
  echo "report failed: HTTP ${http} ${msg}"
  exit 1
fi

echo "ok ${section}"
