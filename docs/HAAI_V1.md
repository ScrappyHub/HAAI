# HAAI v1

Hash Access Artificial Interface

## What this project is to spec

HAAI is a standalone deterministic AI evidence capture, hashing, packetization, verification, and diff instrument.

It exists to turn AI interactions into independently verifiable artifacts.

HAAI Core captures prompts, messages, attachments, tool IO, outputs, and run metadata, canonicalizes them into stable bytes, stores large values as content-addressed blobs, packages them as deterministic directory evidence packet directory packets, verifies those packets from exact bytes on disk, and supports deterministic diff between runs.

HAAI Core is not an oracle.
It does not determine whether an answer is true.
It does not score quality.
It does not decide safety policy.
It does not interpret meaning.
It only produces and verifies evidence.

## Canonical boundaries

Core:
- capture
- canonicalize
- hash
- blob store
- packet build
- packet verify
- diff
- receipt emission

Not Core:
- evaluation
- labeling
- policy scoring
- ranking
- interpretation
- product analytics
- compliance conclusions

Those belong in higher layers or packs.

## Canonical artifact shape

HAAI produces a run envelope and content-addressed blobs.

Expected packet shape:

- manifest.json
- packet_id.txt
- sha256sums.txt
- payload\
  - run_envelope.json
  - blobs\<sha256>\content

PacketId is derived from canonical manifest bytes without packet_id embedded in the manifest body.

## Environment

- Windows PowerShell 5.1
- Set-StrictMode -Version Latest
- UTF-8 no BOM + LF discipline
- SHA-256 over exact bytes
- deterministic child powershell.exe -File execution
- no interactive dependence
- append-only receipts

## Dedicated isolation policy

HAAI must run on a dedicated port and must not share containers with unrelated projects.

Locked values:

- bind = 127.0.0.1
- port = 54170
- compose project = haai
- network = haai_net

## Current repo state

Present:
- capture script
- packet build script
- packet verify script
- diff script
- selftest script
- receipts path
- vectors path
- docker compose policy file
- repo surface documentation

Missing or incomplete:
- final selftest stabilization
- release-quality full runner
- Dockerfile or real runtime image
- sealed evidence pack proving repeatable green runs
- stronger docs for receipts and vector contract

## Standalone Definition of Done

HAAI is complete only when the repo can prove end-to-end deterministic AI evidence handling with:

1. positive capture -> build -> verify path green
2. negative vector proven to fail for the correct token
3. exact-byte verification over payload files
4. stable receipts and transcripts
5. standalone reproducibility on a clean machine
