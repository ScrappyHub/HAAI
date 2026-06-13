"use strict";

const HAAI_KEY = "haai_state_v1";
const HAAI_TIMELINE_KEY = "haai_capture_timeline_v1";
const HAAI_ARCHIVE_KEY = "haai_replay_archive_v1";

const DEFAULT_STATE = {
  extension_version: "0.1.0",
  active_capture: false,
  session_id: "",
  capture_tab_id: null,
  capture_window_id: null,
  capture_url: "",
  capture_origin: "",
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


function originFromUrl(url) {
  try {
    return new URL(String(url || "")).origin;
  } catch (_) {
    return "";
  }
}

function tabIdFromSender(sender) {
  return sender && sender.tab && Number.isFinite(sender.tab.id) ? sender.tab.id : null;
}

function windowIdFromSender(sender) {
  return sender && sender.tab && Number.isFinite(sender.tab.windowId) ? sender.tab.windowId : null;
}

function eventAllowedForCapture(state, sender) {
  if (!state || !state.active_capture) {
    return false;
  }

  if (state.capture_tab_id === null || typeof state.capture_tab_id === "undefined") {
    return true;
  }

  const senderTabId = tabIdFromSender(sender);
  return senderTabId === state.capture_tab_id;
}

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

async function loadState() {
  const data = await chrome.storage.local.get(HAAI_KEY);
  const state = data[HAAI_KEY] || cloneDefault();

  if (!Array.isArray(state.events)) { state.events = []; }
  if (!state.surface) { state.surface = cloneDefault().surface; }
  if (!state.lifecycle) { state.lifecycle = cloneDefault().lifecycle; }

  return state;
}

async function saveState(state) {
  await chrome.storage.local.set({ [HAAI_KEY]: state });
}

async function loadTimeline() {
  const data = await chrome.storage.local.get(HAAI_TIMELINE_KEY);
  return Array.isArray(data[HAAI_TIMELINE_KEY]) ? data[HAAI_TIMELINE_KEY] : [];
}

async function saveTimeline(items) {
  await chrome.storage.local.set({ [HAAI_TIMELINE_KEY]: items.slice(-200) });
}

async function loadArchive() {
  const data = await chrome.storage.local.get(HAAI_ARCHIVE_KEY);
  return Array.isArray(data[HAAI_ARCHIVE_KEY]) ? data[HAAI_ARCHIVE_KEY] : [];
}

async function saveArchive(items) {
  await chrome.storage.local.set({ [HAAI_ARCHIVE_KEY]: items.slice(-50) });
}

function makeEvent(type, source, extra) {
  return Object.assign({
    schema: "haai.extension_event.v1",
    event_type: type,
    created_utc: new Date().toISOString(),
    source: source
  }, extra || {});
}

function addEvent(state, event) {
  if (!Array.isArray(state.events)) { state.events = []; }
  state.events.push(event);
  state.last_activity_utc = event.created_utc || new Date().toISOString();

  if (state.events.length > 2000) {
    state.events = state.events.slice(-2000);
  }
}

function updateSurfaceAndLifecycle(state, event) {
  if (!event || !event.payload) { return; }

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

  if (newDomain) { state.current_domain = newDomain; }
  if (newConversation) { state.current_conversation_id = newConversation; }

  state.surface.detected = Boolean(payload.detected);
  state.surface.provider = payload.provider || "unknown";
  state.surface.domain = payload.domain || "";
  state.surface.url = payload.url || "";
  state.surface.title = payload.title || "";
  state.surface.message_count = payload.message_count || 0;
  state.surface.input_detected = Boolean(payload.input_detected);
  state.surface.last_seen_utc = event.created_utc || "";
}

function frozenReplayFromState(state) {
  return JSON.parse(JSON.stringify({
    schema: "haai.frozen_replay.v1",
    frozen_utc: new Date().toISOString(),
    session_id: state.session_id || "",
    session_started_utc: state.session_started_utc || "",
    session_stopped_utc: state.session_stopped_utc || "",
    surface: state.surface || {},
    capture_tab_id: state.capture_tab_id || null,
    capture_window_id: state.capture_window_id || null,
    capture_url: state.capture_url || "",
    capture_origin: state.capture_origin || "",
    lifecycle: state.lifecycle || {},
    event_count: Array.isArray(state.events) ? state.events.length : 0,
    events: Array.isArray(state.events) ? state.events : []
  }));
}

async function upsertFrozenReplay(state) {
  if (!state || !state.session_id) { return; }

  const archive = await loadArchive();
  const filtered = archive.filter((item) => item.session_id !== state.session_id);
  filtered.push(frozenReplayFromState(state));
  await saveArchive(filtered);
}

async function findFrozenReplay(sessionId) {
  const archive = await loadArchive();

  for (let i = archive.length - 1; i >= 0; i -= 1) {
    if (archive[i] && archive[i].session_id === sessionId) {
      return archive[i];
    }
  }

  return null;
}

async function appendTimelineItem(item) {
  const items = await loadTimeline();
  const filtered = items.filter((x) => x.session_id !== item.session_id);
  filtered.push(item);
  await saveTimeline(filtered);
}

function timelineItemFromState(state, exported, hash, exportedUtc) {
  return {
    schema: "haai.capture_timeline_item.v1",
    session_id: state.session_id || "",
    provider: state.surface && state.surface.provider ? state.surface.provider : "unknown",
    domain: state.surface && state.surface.domain ? state.surface.domain : "",
    title: state.surface && state.surface.title ? state.surface.title : "",
    started_utc: state.session_started_utc || "",
    stopped_utc: state.session_stopped_utc || "",
    last_activity_utc: state.last_activity_utc || "",
    event_count: Array.isArray(state.events) ? state.events.length : 0,
    message_count: state.surface && state.surface.message_count ? state.surface.message_count : 0,
    exported: Boolean(exported),
    export_sha256: hash || "",
    exported_utc: exportedUtc || ""
  };
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function exportEnvelopeFromReplay(replay, createdUtc) {
  return {
    schema: "haai.extension_session_export.v1",
    created_utc: createdUtc,
    session_id: replay.session_id,
    session_started_utc: replay.session_started_utc,
    session_stopped_utc: replay.session_stopped_utc,
    surface: replay.surface,
    capture_tab_id: replay.capture_tab_id || null,
    capture_window_id: replay.capture_window_id || null,
    capture_url: replay.capture_url || "",
    capture_origin: replay.capture_origin || "",
    lifecycle: replay.lifecycle,
    event_count: Array.isArray(replay.events) ? replay.events.length : 0,
    events: Array.isArray(replay.events) ? replay.events : []
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, reason: "Invalid HAAI message." });
      return;
    }

    const state = await loadState();

    if (message.type === "haai_get_state") {
      sendResponse({ ok: true, state: state, timeline: await loadTimeline(), archive: await loadArchive() });
      return;
    }

    if (message.type === "haai_get_workbench_data") {
      sendResponse({ ok: true, state: state, timeline: await loadTimeline(), archive: await loadArchive() });
      return;
    }

    if (message.type === "haai_get_replay_archive") {
      const sessionId = message.session_id || "";
      const replay = await findFrozenReplay(sessionId);
      sendResponse({ ok: Boolean(replay), replay: replay, reason: replay ? "" : "REPLAY_NOT_FOUND" });
      return;
    }

    if (message.type === "haai_begin_capture") {
      const now = new Date().toISOString();
      const fresh = cloneDefault();

      fresh.active_capture = true;
      fresh.session_id = "session_" + now.replace(/[:.]/g, "-");
      fresh.session_started_utc = now;
      fresh.session_stopped_utc = "";
      fresh.capture_tab_id = Number.isFinite(message.capture_tab_id) ? message.capture_tab_id : null;
      fresh.capture_window_id = Number.isFinite(message.capture_window_id) ? message.capture_window_id : null;
      fresh.capture_url = message.capture_url || "";
      fresh.capture_origin = originFromUrl(message.capture_url || "");
      fresh.lifecycle.session_started = true;
      fresh.lifecycle.session_stopped = false;

      addEvent(fresh, makeEvent("session_started", "background", {
        session_id: fresh.session_id,
        capture_tab_id: fresh.capture_tab_id,
        capture_window_id: fresh.capture_window_id,
        capture_origin: fresh.capture_origin,
        capture_url: fresh.capture_url
      }));

      await saveState(fresh);

      sendResponse({
        ok: true,
        message: "Capture started with a fresh session.",
        state: fresh
      });

      return;
    }

    if (message.type === "haai_stop_capture") {
      if (!state.active_capture) {
        sendResponse({
          ok: true,
          message: "Capture already stopped.",
          state: state
        });
        return;
      }

      const now = new Date().toISOString();

      state.active_capture = false;
      state.session_stopped_utc = now;
      state.lifecycle.session_stopped = true;

      addEvent(state, makeEvent("session_stopped", "background", {
        session_id: state.session_id
      }));

      await saveState(state);
      await upsertFrozenReplay(state);
      await appendTimelineItem(timelineItemFromState(state, false, "", ""));

      sendResponse({
        ok: true,
        message: "Capture stopped and frozen replay archived.",
        state: state
      });

      return;
    }

    if (message.type === "haai_record_event") {
      if (!state.active_capture) {
        sendResponse({
          ok: true,
          message: "Capture is stopped. Event ignored and frozen evidence was not changed.",
          state: state
        });
        return;
      }

      if (!eventAllowedForCapture(state, sender)) {
        sendResponse({
          ok: true,
          message: "Event ignored. Capture is scoped to a different tab.",
          ignored: true,
          reason: "TAB_SCOPE_MISMATCH",
          capture_tab_id: state.capture_tab_id,
          sender_tab_id: tabIdFromSender(sender)
        });
        return;
      }
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

    if (message.type === "haai_export_full_history") {
      const createdUtc = new Date().toISOString();
      const timeline = await loadTimeline();
      const archive = await loadArchive();

      const body = JSON.stringify({
        schema: "haai.full_history_export.v1",
        created_utc: createdUtc,
        capture_count: timeline.length,
        frozen_replay_count: archive.length,
        timeline: timeline,
        archive: archive
      }, null, 2);

      const hash = await sha256Hex(body);

      sendResponse({
        ok: true,
        message: "Full history export ready.",
        sha256: hash,
        filename: "haai_full_history_" + createdUtc.replace(/[:.]/g, "-") + "_" + hash.slice(0, 16) + ".json",
        body: body
      });

      return;
    }

    if (message.type === "haai_export_session") {
      const createdUtc = new Date().toISOString();

      let replay = await findFrozenReplay(state.session_id);

      if (!replay && state.session_id) {
        await upsertFrozenReplay(state);
        replay = await findFrozenReplay(state.session_id);
      }

      if (!replay) {
        replay = frozenReplayFromState(state);
      }

      const body = JSON.stringify(exportEnvelopeFromReplay(replay, createdUtc), null, 2);
      const hash = await sha256Hex(body);

      const timelineItem = timelineItemFromState(state, true, hash, createdUtc);
      timelineItem.event_count = replay.event_count || 0;
      timelineItem.stopped_utc = replay.session_stopped_utc || state.session_stopped_utc || "";
      timelineItem.last_activity_utc = replay.session_stopped_utc || state.last_activity_utc || "";

      await appendTimelineItem(timelineItem);

      sendResponse({
        ok: true,
        message: "Session export ready from frozen replay.",
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
