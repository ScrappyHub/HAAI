# HAAI

Hash Access Artificial Interface

HAAI is a deterministic AI evidence capture, hashing, packetization, verification, diff, and runtime verification system.

It turns AI interactions into independently verifiable artifacts by capturing run inputs and outputs, canonicalizing them into stable bytes, storing content-addressed blobs, packaging deterministic directory evidence packets, verifying exact on-disk bytes, and emitting reproducible evidence.

## What HAAI does

HAAI Core is responsible for:

- deterministic capture of AI interaction evidence
- canonical JSON serialization
- content-addressed blob storage
- packet build
- packet verify
- packet diff
- append-only receipt emission
- dedicated runtime verification on its own locked local port

HAAI Core does not score truth, quality, usefulness, ranking, or policy correctness.

## Locked runtime isolation

HAAI runs on a dedicated local runtime surface and must not overlap unrelated projects.

Locked values:

- bind: 127.0.0.1
- port: 54170
- compose project: haai
- container: haai_runtime
- network: haai_net

## Primary operator interface

Use haai.ps1 as the canonical entrypoint.

### Show status

powershell -NoProfile -ExecutionPolicy Bypass -File .\haai.ps1 -Cmd status -RepoRoot .

### Run selftest

powershell -NoProfile -ExecutionPolicy Bypass -File .\haai.ps1 -Cmd selftest -RepoRoot .

### Run full green

powershell -NoProfile -ExecutionPolicy Bypass -File .\haai.ps1 -Cmd full-green -RepoRoot .

### Verify runtime surface

powershell -NoProfile -ExecutionPolicy Bypass -File .\haai.ps1 -Cmd runtime-verify -RepoRoot .

### Bring docker runtime up

powershell -NoProfile -ExecutionPolicy Bypass -File .\haai.ps1 -Cmd docker-up -RepoRoot .

### Bring docker runtime down

powershell -NoProfile -ExecutionPolicy Bypass -File .\haai.ps1 -Cmd docker-down -RepoRoot .

## Repository surface

Primary files:

- haai.ps1
- scripts\haai_capture_v1.ps1
- scripts\haai_build_packet_optionA_v1.ps1
- scripts\haai_verify_packet_optionA_v1.ps1
- scripts\haai_diff_v1.ps1
- scripts\haai_selftest_v1.ps1
- scripts\_RUN_haai_full_green_v1.ps1
- scripts\_RUN_haai_runtime_verify_v1.ps1
- docker-compose.haai.yml
- Dockerfile

Primary directories:

- proofs\receipts\
- proofs\receipts\haai_full_green\
- proofs\receipts\haai_runtime_verify\
- runtime\site\
- runtime\nginx\
- test_vectors\

## Current verified behavior

HAAI currently proves:

- selftest green
- full-green runner green
- runtime-verify runner green
- canonical entrypoint green
- dedicated docker runtime reachable at:
  - http://127.0.0.1:54170/healthz
  - http://127.0.0.1:54170/index.json

## Environment rules

- Windows PowerShell 5.1
- Set-StrictMode -Version Latest
- UTF-8 no BOM + LF
- SHA-256 over exact bytes
- deterministic child PowerShell execution
- no interactive-state dependence
- append-only receipts

## Definition of Done

HAAI is complete as a standalone system when it can reproducibly prove:

1. positive capture -> build -> verify
2. negative verification failure with the expected token
3. exact-byte packet verification
4. dedicated runtime verification on locked bind and port
5. stable evidence and receipts across reruns
6. clean operator control through haai.ps1

## Operator entrypoint

HAAI exposes one canonical top-level operator entrypoint:

    .\haai.ps1 -Cmd status -RepoRoot .
    .\haai.ps1 -Cmd selftest -RepoRoot .
    .\haai.ps1 -Cmd full-green -RepoRoot .
    .\haai.ps1 -Cmd runtime-verify -RepoRoot .
    .\haai.ps1 -Cmd docker-up -RepoRoot .
    .\haai.ps1 -Cmd docker-down -RepoRoot .

Supported commands:

- status shows the current local operator surface and runtime state
- selftest runs the deterministic selftest
- ull-green runs the authoritative full-green runner
- 
untime-verify verifies the dedicated runtime surface and writes evidence
- docker-up builds and starts the dedicated HAAI runtime
- docker-down stops and removes the dedicated HAAI runtime

HAAI should be operated through haai.ps1 for normal top-level use.
