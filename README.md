# HAAI

Hash Access Artificial Interface

HAAI is a deterministic AI evidence capture, hashing, packetization, verification, and diff instrument.

Its purpose is to produce independently verifiable evidence packets for AI interactions, including prompts, inputs, attachments, tool IO, outputs, and run metadata, without relying on trust in the builder machine or runtime.

## What HAAI is

HAAI is a deterministic evidence instrument focused on AI runs.

HAAI Core does not judge truth, quality, usefulness, or policy correctness of the AI output.
HAAI Core only captures, canonicalizes, hashes, packages, verifies, and diffs evidence.

The canonical artifact is a run envelope plus content-addressed blobs packed as a deterministic directory evidence packet directory packet.

## Canonical responsibilities

HAAI Core is responsible for:

- deterministic capture of AI interaction evidence
- canonical JSON serialization
- content-addressed blob storage
- PacketId derivation from canonical manifest bytes
- sha256sums verification over exact on-disk bytes
- packet verification
- packet-to-packet diff support
- append-only receipt emission

HAAI Packs, policies, labels, scoring, or interpretation layers are separate and are not part of HAAI Core.

## Repository surface

Current primary scripts:

- scripts\haai_capture_v1.ps1
- scripts\haai_build_packet_optionA_v1.ps1
- scripts\haai_verify_packet_optionA_v1.ps1
- scripts\haai_diff_v1.ps1
- scripts\haai_selftest_v1.ps1

Current working directories:

- test_vectors\
- proofs\receipts\
- scripts\_patch\
- scripts\_scratch\

## Deterministic rules

- Windows PowerShell 5.1
- Set-StrictMode -Version Latest
- UTF-8 no BOM + LF
- SHA-256 over exact bytes
- canonical JSON with stable ordering
- append-only receipts
- no interactive session dependence
- write to disk, parse-gate, run via child powershell.exe -File

## Dedicated runtime isolation

HAAI is locked to its own dedicated local bind and project namespace:

- bind: 127.0.0.1
- port: 54170
- compose project: haai
- docker network: haai_net

HAAI must not share containers or ports with unrelated projects.

## Current status

The repository now has the canonical repo surface files, but the runtime still needs final stabilization around selftest behavior and any real container image or Dockerfile.

At the moment, docker-compose.haai.yml is policy surface only unless a real Dockerfile and runtime image are added.

## Definition of Done for the standalone instrument

HAAI reaches full standalone readiness when one deterministic command can:

- parse-gate product scripts
- capture a run into canonical blobs
- build a valid Option-A packet
- verify the packet from exact on-disk bytes
- prove at least one negative vector fails for the correct reason
- emit reproducible receipts and evidence
- re-run deterministically with stable outputs

## GitHub About

Use the text in .github\ABOUT_HAAI.txt for the GitHub repo description field.
