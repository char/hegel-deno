set ignore-comments := true

# Download the host's published libhegel artifact into .hegel/ (if missing) and
# print its path. Used to run tests offline against the real native library.
fetch-libhegel:
    #!/usr/bin/env bash
    set -euo pipefail
    version="$(sed -n 's/^export const LIBHEGEL_VERSION = "\([^"]*\)";/\1/p' src/checksums.ts)"
    case "$(uname -s)" in
      Linux) os=linux; ext=so;;
      Darwin) os=darwin; ext=dylib;;
      *) os=windows; ext=dll;;
    esac
    case "$(uname -m)" in
      x86_64|amd64) arch=amd64;;
      aarch64|arm64) arch=arm64;;
      *) echo "unsupported arch $(uname -m)" >&2; exit 1;;
    esac
    asset="libhegel-${os}-${arch}.${ext}"
    mkdir -p .hegel
    if [ ! -f ".hegel/${asset}" ]; then
      curl -fsSL "https://github.com/hegeldev/hegel-rust/releases/download/v${version}/${asset}" \
        -o ".hegel/${asset}"
    fi
    echo "${PWD}/.hegel/${asset}"

# Build libhegel from a sibling ../hegel-rust checkout (for local development
# against an unreleased engine). Prints the path to export as
# HEGEL_LIBHEGEL_PATH.
build-libhegel:
    #!/usr/bin/env bash
    set -euo pipefail
    cargo build --release -p hegeltest-c --manifest-path ../hegel-rust/Cargo.toml
    echo "../hegel-rust/target/release/libhegel_c.so"

# Regenerate src/checksums.ts from a hegel-rust release. Targets the latest
# release; pass a version (e.g. `just update-checksums 0.20.1`) to pin an exact
# one.
update-checksums version="":
    node scripts/update-checksums.mjs {{version}}
    npx prettier --write src/checksums.ts

check-test:
    #!/usr/bin/env bash
    set -euo pipefail
    export HEGEL_LIBHEGEL_PATH="$(just fetch-libhegel)"
    npx vitest run --coverage
    python3 scripts/check-coverage.py

format:
    npx prettier --write .

check-format:
    npx prettier --check .

check-lint:
    npx eslint .
    npx tsc --noEmit

check-docs:
    npx typedoc

docs:
    npx typedoc
    open docs/index.html

# these aliases are provided as ux improvements for local developers. CI should use the longer
# forms.
test: check-test
lint: check-format check-lint
check: lint check-docs check-test
