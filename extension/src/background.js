"use strict";

const HAAI_STATE = {
  extension_version: "0.1.0",
  active_capture: false,
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

function addEvent(event) {
  HAAI_STATE.events.push(event);
  if (HAAI_STATE.events.length > 1000) {
    HAAI_STATE.events = HAAI_STATE.events.slice(-1000);
  }
}

function updateSurface(event) {
  if (!event || !event.payload) {
    return;
  }

  if (event.event_type === "page_probe" || event.event_type === "conversation_snapshot") {
    HAAI_STATE.surface.detected = Boolean(event.payload.detected);
    HAAI_STATE.surface.provider = event.payload.provider || "unknown";
    HAAI_STATE.surface.domain = event.payload.domain || "";
    HAAI_STATE.surface.url = event.payload.url || "";
    HAAI_STATE.surface.title = event.payload.title || "";
    HAAI_STATE.surface.message_count = event.payload.message_count || 0;
    HAAI_STATE.surface.input_detected = Boolean(event.payload.input_detected);
    HAAI_STATE.surface.last_seen_utc = event.created_utc || "";
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, reason: "Invalid extension message." });
    return true;
  }

  if (message.type === "haai_get_state") {
    sendResponse({ ok: true, state: HAAI_STATE });
    return true;
  }

  if (message.type === "haai_begin_capture") {
    HAAI_STATE.active_capture = true;
    addEvent({
      schema: "haai.extension_event.v1",
      event_type: "capture_started",
      created_utc: new Date().toISOString(),
      source: "background"
    });
    sendResponse({ ok: true, message: "Capture is now running.", state: HAAI_STATE });
    return true;
  }

  if (message.type === "haai_stop_capture") {
    HAAI_STATE.active_capture = false;
    addEvent({
      schema: "haai.extension_event.v1",
      event_type: "capture_stopped",
      created_utc: new Date().toISOString(),
      source: "background"
    });
    sendResponse({ ok: true, message: "Capture stopped.", state: HAAI_STATE });
    return true;
  }

  if (message.type === "haai_record_event") {
    const event = message.event || {};
    updateSurface(event);
    addEvent(event);
    sendResponse({ ok: true, message: "Event recorded.", state: HAAI_STATE });
    return true;
  }

  sendResponse({ ok: false, reason: "Unknown HAAI message." });
  return true;
});
