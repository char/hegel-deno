set ignore-comments := true

# Download the host's published libhegel artifact into native/ (if missing,
# verified against the pinned checksum) and print its path. Used to run tests
# against the real native library; the same script with --all bundles every
# platform's artifact at npm pack time (see package.json `prepack`).
@fetch-libhegel:
    node scripts/fetch-libhegel.mjs

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
    node scripts/fetch-libhegel.mjs > /dev/null
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
