# HAAI Extension Adapter

The HAAI browser extension is an optional live AI interaction recorder.

It works like a ShadowProfile-style deep inspect adapter for AI workflows.

Purpose:
- observe supported AI web UIs
- capture prompts and visible responses
- capture page context and user actions
- emit HAAI event stream records
- export/send records into local HAAI Core

The extension must not replace Core.

Core remains:
capture -> canonicalize -> hash -> bundle -> verify -> diff

Extension safety:
- local-only by default
- user-controlled capture
- domain allowlist
- pause and stop controls
- no silent upload
- redaction before export
