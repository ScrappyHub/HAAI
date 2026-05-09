# HAAI Browser Targets

HAAI Extension is an optional browser adapter for HAAI Core.

Core remains local-first and Docker-free.

## Targets

- Chrome / Chromium: extension/manifest.json
- Microsoft Edge: extension/manifest.json
- Firefox: extension/manifest.firefox.json

## Browser role

The browser extension observes supported AI web UIs and helps create HAAI evidence records.

Current extension capability:

- loads as a WebExtension
- starts a background worker/script
- injects a content script
- collects visible recent conversation text
- builds a context recovery prompt
- displays a copyable overlay

## Context recovery

If HAAI is started in the middle of a conversation, the extension should not pretend it knows the full history.

Instead, it generates a context recovery prompt asking the AI page to explain:

- what the work appears to be
- recent decisions
- current blockers
- next steps
- uncertainty
- assumptions

## Browser packaging rule

Keep browser-specific manifests separate.

Do not force one manifest to satisfy every browser if browser behavior differs.
