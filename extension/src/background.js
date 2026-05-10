"use strict";

const HAAI_KEY = "haai_state_v1";

const DEFAULT_STATE = {
  extension_version: "0.1.0",
  active_capture: false,
  session_id: "",
  surface: {
    detected: false,
    provider: "unknown",
    domain: "",
    url: "",
    title: "",
    message_count: 0,
    input_detected: false,
    last_seen_utc: ""
  },
  events: []
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

async function loadState() {
  const data = await chrome.storage.local.get(HAAI_KEY);
  return data[HAAI_KEY] || cloneDefault();
}

async function saveState(state) {
  await chrome.storage.local.set({ [HAAI_KEY]: state });
}

function addEvent(state, event) {
  state.events.push(event);
  if (state.events.length > 2000) {
    state.events = state.events.slice(-2000);
  }
}

function updateSurface(state, event) {
  if (!event || !event.payload) { return; }

  if (event.event_type === "page_probe" || event.event_type === "conversation_snapshot" || event.event_type === "input_surface_changed") {
    state.surface.detected = Boolean(event.payload.detected);
    state.surface.provider = event.payload.provider || "unknown";
    state.surface.domain = event.payload.domain || "";
    state.surface.url = event.payload.url || "";
    state.surface.title = event.payload.title || "";
    state.surface.message_count = event.payload.message_count || 0;
    state.surface.input_detected = Boolean(event.payload.input_detected);
    state.surface.last_seen_utc = event.created_utc || "";
  }
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, reason: "Invalid HAAI message." });
      return;
    }

    const state = await loadState();

    if (message.type === "haai_get_state") {
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === "haai_begin_capture") {
      state.active_capture = true;
      state.session_id = state.session_id || ("session_" + new Date().toISOString().replace(/[:.]/g, "-"));
      addEvent(state, {
        schema: "haai.extension_event.v1",
        event_type: "capture_started",
        created_utc: new Date().toISOString(),
        source: "background",
        session_id: state.session_id
      });
      await saveState(state);
      sendResponse({ ok: true, message: "Capture started.", state });
      return;
    }

    if (message.type === "haai_stop_capture") {
      state.active_capture = false;
      addEvent(state, {
        schema: "haai.extension_event.v1",
        event_type: "capture_stopped",
        created_utc: new Date().toISOString(),
        source: "background",
        session_id: state.session_id
      });
      await saveState(state);
      sendResponse({ ok: true, message: "Capture stopped.", state });
      return;
    }

    if (message.type === "haai_record_event") {
      const event = message.event || {};
      event.session_id = state.session_id || "";
      updateSurface(state, event);
      addEvent(state, event);
      await saveState(state);
      sendResponse({ ok: true, message: "Event recorded.", state });
      return;
    }

    if (message.type === "haai_export_session") {
      const createdUtc = new Date().toISOString();
      const body = JSON.stringify({
        schema: "haai.extension_session_export.v1",
        created_utc: createdUtc,
        session_id: state.session_id,
        surface: state.surface,
        event_count: state.events.length,
        events: state.events
      }, null, 2);

      const hash = await sha256Hex(body);

      sendResponse({
        ok: true,
        message: "Session export ready.",
        sha256: hash,
        filename: "haai_session_" + createdUtc.replace(/[:.]/g, "-") + "_" + hash.slice(0, 16) + ".json",
        body
      });
      return;
    }

    sendResponse({ ok: false, reason: "Unknown HAAI message." });
  })();

  return true;
});
