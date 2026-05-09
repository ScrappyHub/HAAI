"use strict";

const HAAI_STATE = {
  extension_version: "0.1.0",
  recorder_mode: "idle",
  active_capture: false,
  events: []
};

function pushEvent(event) {
  HAAI_STATE.events.push(event);

  if (HAAI_STATE.events.length > 500) {
    HAAI_STATE.events = HAAI_STATE.events.slice(-500);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("HAAI_BACKGROUND_READY");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, reason: "INVALID_MESSAGE" });
    return true;
  }

  if (message.type === "haai_ping") {
    sendResponse({ ok: true, result: "pong", state: HAAI_STATE });
    return true;
  }

  if (message.type === "haai_begin_capture") {
    if (HAAI_STATE.active_capture) {
      sendResponse({ ok: true, result: "already_capturing", state: HAAI_STATE });
      return true;
    }

    HAAI_STATE.active_capture = true;
    HAAI_STATE.recorder_mode = "capture";
    pushEvent({
      schema: "haai.extension_event.v1",
      event_type: "capture_started",
      created_utc: new Date().toISOString(),
      source: "background"
    });

    sendResponse({ ok: true, result: "capture_started", state: HAAI_STATE });
    return true;
  }

  if (message.type === "haai_stop_capture") {
    HAAI_STATE.active_capture = false;
    HAAI_STATE.recorder_mode = "idle";
    pushEvent({
      schema: "haai.extension_event.v1",
      event_type: "capture_stopped",
      created_utc: new Date().toISOString(),
      source: "background"
    });

    sendResponse({ ok: true, result: "capture_stopped", state: HAAI_STATE });
    return true;
  }

  if (message.type === "haai_record_event") {
    pushEvent(message.event || {});
    sendResponse({ ok: true, result: "event_recorded", count: HAAI_STATE.events.length });
    return true;
  }

  if (message.type === "haai_get_events") {
    sendResponse({ ok: true, events: HAAI_STATE.events, state: HAAI_STATE });
    return true;
  }

  sendResponse({ ok: false, reason: "UNKNOWN_MESSAGE_TYPE" });
  return true;
});
