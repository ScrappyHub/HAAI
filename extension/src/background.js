"use strict";

const HAAI_STATE = {
  extension_version: "0.1.0",
  recorder_mode: "idle",
  active_capture: false,
  current_domain: "",
  current_conversation_id: "",
  events: []
};

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pushEvent(event) {
  HAAI_STATE.events.push(event);
  if (HAAI_STATE.events.length > 1000) {
    HAAI_STATE.events = HAAI_STATE.events.slice(-1000);
  }
}

function updateAwareness(event) {
  if (!event || !event.page_url) {
    return;
  }

  let domain = "";
  try {
    domain = new URL(event.page_url).hostname;
  } catch (err) {
    domain = "";
  }

  const conversationId = event.conversation_id || event.page_url || "";

  if (domain && HAAI_STATE.current_domain && domain !== HAAI_STATE.current_domain) {
    pushEvent({
      schema: "haai.extension_event.v1",
      event_type: "domain_changed",
      created_utc: new Date().toISOString(),
      source: "background",
      from_domain: HAAI_STATE.current_domain,
      to_domain: domain
    });
  }

  if (conversationId && HAAI_STATE.current_conversation_id && conversationId !== HAAI_STATE.current_conversation_id) {
    pushEvent({
      schema: "haai.extension_event.v1",
      event_type: "conversation_changed",
      created_utc: new Date().toISOString(),
      source: "background",
      from_conversation_id: HAAI_STATE.current_conversation_id,
      to_conversation_id: conversationId
    });
  }

  if (domain) {
    HAAI_STATE.current_domain = domain;
  }

  if (conversationId) {
    HAAI_STATE.current_conversation_id = conversationId;
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
    if (!HAAI_STATE.active_capture) {
      HAAI_STATE.active_capture = true;
      HAAI_STATE.recorder_mode = "capture";
      pushEvent({
        schema: "haai.extension_event.v1",
        event_type: "capture_started",
        created_utc: new Date().toISOString(),
        source: "background"
      });
    }

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
    const event = message.event || {};
    updateAwareness(event);
    pushEvent(event);
    sendResponse({ ok: true, result: "event_recorded", count: HAAI_STATE.events.length });
    return true;
  }

  if (message.type === "haai_get_events") {
    sendResponse({ ok: true, events: HAAI_STATE.events, state: HAAI_STATE });
    return true;
  }

  if (message.type === "haai_export_capture") {
    const createdUtc = new Date().toISOString();
    const envelope = {
      schema: "haai.extension_export.v1",
      created_utc: createdUtc,
      producer: {
        name: "haai-extension",
        version: HAAI_STATE.extension_version
      },
      capture_state: HAAI_STATE
    };

    const body = JSON.stringify(envelope, null, 2);
    sha256Hex(body).then((hash) => {
      sendResponse({
        ok: true,
        sha256: hash,
        created_utc: createdUtc,
        filename: "haai_capture_" + createdUtc.replace(/[:.]/g, "-") + "_" + hash.slice(0, 16) + ".json",
        body: body
      });
    });

    return true;
  }

  sendResponse({ ok: false, reason: "UNKNOWN_MESSAGE_TYPE" });
  return true;
});
