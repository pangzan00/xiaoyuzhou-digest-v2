#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
build_root="$repo_root/dist"
[[ -d "$build_root" ]] || { printf 'Release check failed: dist/ is missing; run npm run build first\n' >&2; exit 1; }
cd "$build_root"

mode="${1:-}"
if [[ -n "$mode" && "$mode" != "--print-files" ]]; then
  printf 'Usage: %s [--print-files]\n' "$0" >&2
  exit 2
fi

log() {
  printf '%s\n' "$*" >&2
}

fail() {
  printf 'Release check failed: %s\n' "$*" >&2
  exit 1
}

# Package the exact CRXJS build output. CRXJS hashes JavaScript and CSS chunks,
# so a fixed filename allowlist would incorrectly omit required runtime modules.
# Source maps and development-only Vite metadata are excluded from the public ZIP.
required_public_files=("manifest.json" "sidepanel.html" "options.html")
for file in "${required_public_files[@]}"; do
  [[ -f "$file" ]] || fail "required public file is missing: $file"
done

release_files=()
while IFS= read -r -d '' file; do
  relative_file="${file#./}"
  [[ "$relative_file" != *.map ]] || continue
  [[ "$relative_file" != .vite/* ]] || continue
  [[ "$relative_file" != .xiaoyuzhou-digest-v2-package.*/* ]] || continue
  [[ -f "$relative_file" ]] || fail "publishable path is not a regular file: $relative_file"
  [[ ! -L "$relative_file" ]] || fail "publishable path must not be a symbolic link: $relative_file"
  release_files+=("$relative_file")
done < <(find . -type f -print0 | sort -z)

((${#release_files[@]} > 0)) || fail "no publishable extension files found"

for forbidden in "config.js" ".DS_Store" ".git"; do
  for file in "${release_files[@]}"; do
    if [[ "$file" == "$forbidden" || "$file" == "$forbidden/"* || "$file" == */"$forbidden" ]]; then
      fail "private path entered the release list: $file"
    fi
  done
done

command -v node >/dev/null 2>&1 || fail "Node.js is required"

credential_scan_files=("${release_files[@]}")
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  while IFS= read -r -d '' file; do
    [[ -f "$file" && ! -L "$file" ]] || continue
    credential_scan_files+=("$file")
  done < <(git ls-files -z --cached --others --exclude-standard)
fi

node - "${release_files[@]}" <<'NODE'
const fs = require("fs");
const path = require("path");

const releaseFiles = process.argv.slice(2);
const allowlisted = new Set(releaseFiles);
let manifest;

try {
  manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
} catch (error) {
  console.error(`manifest.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  console.error("manifest.json must declare manifest_version 3");
  process.exit(1);
}

for (const field of ["name", "version", "description"]) {
  if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
    console.error(`manifest.json must include a non-empty ${field}`);
    process.exit(1);
  }
}

if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
  console.error("manifest.json version must contain three or four numeric components");
  process.exit(1);
}

const referenced = new Set();
const add = (value) => {
  if (typeof value === "string" && value) referenced.add(value);
};
const addIconMap = (icons) => {
  if (icons && typeof icons === "object") Object.values(icons).forEach(add);
};

add(manifest.background?.service_worker);
add(manifest.side_panel?.default_path);
add(manifest.options_page);
add(manifest.options_ui?.page);
add(manifest.action?.default_popup);
addIconMap(manifest.icons);
addIconMap(manifest.action?.default_icon);

for (const script of manifest.content_scripts || []) {
  (script.js || []).forEach(add);
  (script.css || []).forEach(add);
}

for (const item of manifest.web_accessible_resources || []) {
  (item.resources || []).forEach((resource) => {
    if (!resource.includes("*")) add(resource);
  });
}

// Manifest V3 does not list importScripts() dependencies or assets referenced
// by extension HTML, so validate those local references too.
for (const file of releaseFiles) {
  if (file.endsWith(".js")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /\bimportScripts\s*\(\s*["']([^"']+)["']\s*\)/g,
    )) {
      if (!/^[a-z]+:/i.test(match[1])) {
        referenced.add(path.posix.join(path.posix.dirname(file), match[1]));
      }
    }
    for (const match of source.matchAll(
      /\bloadPromptSection\s*\(\s*["']([^"']+)["']/g,
    )) {
      referenced.add(path.posix.join("prompts", match[1]));
    }
  }

  if (file.endsWith(".html")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
    )) {
      const value = match[1];
      if (
        value.startsWith("#") ||
        value.startsWith("//") ||
        /^[a-z]+:/i.test(value)
      ) {
        continue;
      }
      referenced.add(path.posix.join(path.posix.dirname(file), value));
    }
  }
}

for (const file of referenced) {
  const normalized = path.posix.normalize(file.replaceAll("\\", "/"));
  if (
    path.isAbsolute(file) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    console.error(`manifest references an unsafe path: ${file}`);
    process.exit(1);
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    console.error(`manifest references a missing file: ${file}`);
    process.exit(1);
  }
  if (!allowlisted.has(file)) {
    console.error(`manifest references a file outside the public allowlist: ${file}`);
    process.exit(1);
  }
}
NODE

javascript_files=()
for file in "${release_files[@]}"; do
  if [[ "$file" == *.js ]]; then
    javascript_files+=("$file")
  fi
done

for file in "${javascript_files[@]}"; do
  node --check "$file"
done

if compgen -G "tests/*.test.js" >/dev/null; then
  node --test tests/*.test.js
fi

if ((${#javascript_files[@]} > 0)); then
  if grep -En \
    'importScripts[[:space:]]*\([[:space:]]*["'\'']config\.js|(^|[^[:alnum:]_])CONFIG\.' \
    "${javascript_files[@]}" >&2; then
    fail "public JavaScript still depends on config.js/CONFIG; use Options-page storage"
  fi
fi

node - "${credential_scan_files[@]}" <<'NODE'
const fs = require("fs");

const patterns = [
  ["private key block", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["Supadata-style key", /\bsd_[A-Za-z0-9_-]{16,}\b/g],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  [
    "credential assignment",
    /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][^"'\s]{16,}["']/gi,
  ],
];

let found = false;
for (const file of process.argv.slice(2)) {
  if (!/\.(?:js|json|html|css|md|txt|yml|yaml|sh)$/i.test(file) && file !== "LICENSE") {
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      console.error(`possible ${label} found in publishable repository file: ${file}`);
      found = true;
    }
  }
}

if (found) process.exit(1);
NODE

log "Release checks passed (${#release_files[@]} allowlisted files)."

if [[ "$mode" == "--print-files" ]]; then
  printf '%s\n' "${release_files[@]}"
fi
