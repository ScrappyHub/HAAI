# HAAI Capture Adapters

HAAI Core is local-first and does not require Docker.

Capture adapters feed evidence into HAAI Core.

Adapters:
- CLI/manual recorder
- repository workflow recorder
- browser extension live recorder
- IDE adapter
- API/proxy adapter

Adapter boundary:
- adapters observe and normalize events
- Core records, hashes, bundles, verifies, diffs, and links
- interpretation belongs to packs, APV, or review tools
