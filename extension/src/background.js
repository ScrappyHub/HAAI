"use strict";

const HAAI_KEY = "haai_state_v1";

const DEFAULT_STATE = {
  extension_version: "0.1.0",
  active_capture: false,
  session_id: "",
  session_started_utc: "",
  session_stopped_utc: "",
  current_domain: "",
  current_conversation_id: "",
  last_activity_utc: "",
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
  lifecycle: {
    session_started: false,
    session_stopped: false,
    domain_changes: 0,
    conversation_changes: 0,
    exports: 0
  },
  events: []
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

async function loadState() {
  const data = await chrome.storage.local.get(HAAI_KEY);
  const state = data[HAAI_KEY] || cloneDefault();

  if (!state.lifecycle) {
    state.lifecycle = cloneDefault().lifecycle;
  }

  return state;
}

async function saveState(state) {
  await chrome.storage.local.set({ [HAAI_KEY]: state });
}

function addEvent(state, event) {
  state.events.push(event);
  state.last_activity_utc = event.created_utc || new Date().toISOString();

  if (state.events.length > 2000) {
    state.events = state.events.slice(-2000);
  }
}

function makeEvent(type, source, extra) {
  return Object.assign({
    schema: "haai.extension_event.v1",
    event_type: type,
    created_utc: new Date().toISOString(),
    source: source
  }, extra || {});
}

function updateSurfaceAndLifecycle(state, event) {
  if (!event || !event.payload) {
    return;
  }

  const payload = event.payload;

  if (
    event.event_type !== "page_probe" &&
    event.event_type !== "conversation_snapshot" &&
    event.event_type !== "input_surface_changed"
  ) {
    return;
  }

  const newDomain = payload.domain || "";
  const newConversation = payload.conversation_id || payload.url || "";

  if (newDomain && state.current_domain && newDomain !== state.current_domain) {
    state.lifecycle.domain_changes += 1;

    addEvent(state, makeEvent("domain_changed", "background", {
      from_domain: state.current_domain,
      to_domain: newDomain,
      session_id: state.session_id
    }));
  }

  if (newConversation && state.current_conversation_id && newConversation !== state.current_conversation_id) {
    state.lifecycle.conversation_changes += 1;

    addEvent(state, makeEvent("conversation_changed", "background", {
      from_conversation_id: state.current_conversation_id,
      to_conversation_id: newConversation,
      session_id: state.session_id
    }));
  }

  if (newDomain) {
    state.current_domain = newDomain;
  }

  if (newConversation) {
    state.current_conversation_id = newConversation;
  }

  state.surface.detected = Boolean(payload.detected);
  state.surface.provider = payload.provider || "unknown";
  state.surface.domain = payload.domain || "";
  state.surface.url = payload.url || "";
  state.surface.title = payload.title || "";
  state.surface.message_count = payload.message_count || 0;
  state.surface.input_detected = Boolean(payload.input_detected);
  state.surface.last_seen_utc = event.created_utc || "";
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
      sendResponse({ ok: true, state: state });
      return;
    }

    if (message.type === "haai_begin_capture") {
      const now = new Date().toISOString();

      state.active_capture = true;
      state.session_id = state.session_id || ("session_" + now.replace(/[:.]/g, "-"));
      state.session_started_utc = state.session_started_utc || now;
      state.session_stopped_utc = "";
      state.lifecycle.session_started = true;
      state.lifecycle.session_stopped = false;

      addEvent(state, makeEvent("session_started", "background", {
        session_id: state.session_id
      }));

      await saveState(state);

      sendResponse({
        ok: true,
        message: "Capture started.",
        state: state
      });

      return;
    }

    if (message.type === "haai_stop_capture") {
      const now = new Date().toISOString();

      state.active_capture = false;
      state.session_stopped_utc = now;
      state.lifecycle.session_stopped = true;

      addEvent(state, makeEvent("session_stopped", "background", {
        session_id: state.session_id
      }));

      await saveState(state);

      sendResponse({
        ok: true,
        message: "Capture stopped.",
        state: state
      });

      return;
    }

    if (message.type === "haai_record_event") {
      const event = message.event || {};
      event.session_id = state.session_id || "";

      updateSurfaceAndLifecycle(state, event);
      addEvent(state, event);

      await saveState(state);

      sendResponse({
        ok: true,
        message: "Event recorded.",
        state: state
      });

      return;
    }

    if (message.type === "haai_export_session") {
      const createdUtc = new Date().toISOString();

      const envelope = {
        schema: "haai.extension_session_export.v1",
        created_utc: createdUtc,
        session_id: state.session_id,
        session_started_utc: state.session_started_utc,
        session_stopped_utc: state.session_stopped_utc,
        surface: state.surface,
        lifecycle: state.lifecycle,
        event_count: state.events.length,
        events: state.events
      };

      const body = JSON.stringify(envelope, null, 2);
      const hash = await sha256Hex(body);

      state.lifecycle.exports += 1;

      addEvent(state, makeEvent("session_exported", "background", {
        session_id: state.session_id,
        sha256: hash
      }));

      await saveState(state);

      sendResponse({
        ok: true,
        message: "Session export ready.",
        sha256: hash,
        filename: "haai_session_" + createdUtc.replace(/[:.]/g, "-") + "_" + hash.slice(0, 16) + ".json",
        body: body,
        state: state
      });

      return;
    }

    sendResponse({ ok: false, reason: "Unknown HAAI message." });
  })();

  return true;
});
