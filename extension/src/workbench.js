"use strict";

const weekCount = document.getElementById("weekCount");
const allCount = document.getElementById("allCount");
const currentSession = document.getElementById("currentSession");
const timelineEl = document.getElementById("timeline");
const details = document.getElementById("details");
const replay = document.getElementById("replay");
const eventCount = document.getElementById("eventCount");
const inputCount = document.getElementById("inputCount");
const snapshotCount = document.getElementById("snapshotCount");
const refresh = document.getElementById("refresh");

let lastState = null;
let lastTimeline = [];

function withinWeek(item) {
  const t = Date.parse(item.stopped_utc || item.started_utc || "");
  if (!Number.isFinite(t)) { return false; }
  return (Date.now() - t) <= (7 * 24 * 60 * 60 * 1000);
}

function countEvents(events, type) {
  return events.filter((event) => event && event.event_type === type).length;
}

function latestEvent(events, type) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i] && events[i].event_type === type) {
      return events[i];
    }
  }
  return null;
}

function eventTypeCounts(events) {
  const counts = {};
  events.forEach((event) => {
    const type = event && event.event_type ? event.event_type : "unknown";
    counts[type] = (counts[type] || 0) + 1;
  });

  return Object.keys(counts).sort().map((key) => {
    return "- " + key + ": " + counts[key];
  }).join("\n");
}

function inputEvolution(events) {
  const inputs = events.filter((event) => event && event.event_type === "input_surface_changed");
  const selected = inputs.slice(-8);

  if (selected.length === 0) {
    return "- No input evolution captured.";
  }

  return selected.map((event) => {
    const payload = event.payload || {};
    const preview = payload.input_preview || "";
    return "- " + (event.created_utc || "-") + " | len=" + (payload.input_length || 0) + " | " + preview;
  }).join("\n");
}

function snapshotSummary(event) {
  if (!event || !event.payload) {
    return "No conversation snapshot captured.";
  }

  const payload = event.payload;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lines = [];

  lines.push("Provider: " + (payload.provider || "unknown"));
  lines.push("Domain: " + (payload.domain || "-"));
  lines.push("Title: " + (payload.title || "-"));
  lines.push("Conversation ID: " + (payload.conversation_id || payload.url || "-"));
  lines.push("Visible messages: " + messages.length);
  lines.push("");

  messages.slice(-5).forEach((message, index) => {
    const text = message.text || "";
    lines.push("Message " + (index + 1) + " [" + (message.role || "unknown") + "] len=" + text.length);
    lines.push(text.slice(0, 700));
    lines.push("");
  });

  return lines.join("\n");
}

function buildReplayText(state) {
  const events = state && Array.isArray(state.events) ? state.events : [];
  const surface = state && state.surface ? state.surface : {};
  const lifecycle = state && state.lifecycle ? state.lifecycle : {};
  const first = events.length ? events[0] : null;
  const last = events.length ? events[events.length - 1] : null;
  const lastSnapshot = latestEvent(events, "conversation_snapshot");

  eventCount.textContent = String(events.length);
  inputCount.textContent = String(countEvents(events, "input_surface_changed"));
  snapshotCount.textContent = String(countEvents(events, "conversation_snapshot"));

  return [
    "HAAI replay inspector",
    "",
    "Session: " + (state.session_id || "-"),
    "Capture: " + (state.active_capture ? "running" : "stopped"),
    "Provider: " + (surface.provider || "unknown"),
    "Domain: " + (surface.domain || "-"),
    "Title: " + (surface.title || "-"),
    "Started: " + (state.session_started_utc || "-"),
    "Stopped: " + (state.session_stopped_utc || "-"),
    "Last activity: " + (state.last_activity_utc || "-"),
    "Domain changes: " + (lifecycle.domain_changes || 0),
    "Conversation changes: " + (lifecycle.conversation_changes || 0),
    "Exports: " + (lifecycle.exports || 0),
    "",
    "First event: " + (first ? first.event_type + " @ " + first.created_utc : "-"),
    "Last event: " + (last ? last.event_type + " @ " + last.created_utc : "-"),
    "",
    "Event type counts:",
    eventTypeCounts(events) || "- No events.",
    "",
    "Recent input evolution:",
    inputEvolution(events),
    "",
    "Latest conversation snapshot:",
    snapshotSummary(lastSnapshot)
  ].join("\n");
}

function render(data) {
  lastState = data.state || {};
  lastTimeline = Array.isArray(data.timeline) ? data.timeline : [];

  weekCount.textContent = String(lastTimeline.filter(withinWeek).length);
  allCount.textContent = String(lastTimeline.length);

  const s = lastState.surface || {};
  currentSession.textContent =
    (lastState.active_capture ? "Capturing" : "Stopped") +
    " | " + (s.provider || "unknown") +
    " | " + (s.domain || "-") +
    " | events=" + (Array.isArray(lastState.events) ? lastState.events.length : 0);

  timelineEl.innerHTML = "";
  details.textContent = "Select a capture to inspect it.";
  replay.textContent = buildReplayText(lastState);

  if (lastTimeline.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent = "No saved captures yet. Stop or export a session to add it here.";
    timelineEl.appendChild(empty);
    return;
  }

  lastTimeline.slice().reverse().slice(0, 25).forEach((item) => {
    const div = document.createElement("div");
    div.className = "item";

    const title = item.title || item.domain || "Untitled capture";
    const mark = item.exported ? "exported" : "ready";

    div.innerHTML =
      "<strong>" + title + "</strong><br>" +
      "provider=" + (item.provider || "unknown") + " | " +
      "events=" + (item.event_count || 0) + " | " +
      "messages=" + (item.message_count || 0) + " | " +
      mark + "<br>" +
      (item.stopped_utc || item.started_utc || "-");

    div.addEventListener("click", () => {
      details.textContent = JSON.stringify(item, null, 2);
    });

    timelineEl.appendChild(div);
  });

  if (lastTimeline.length > 0) {
    details.textContent = JSON.stringify(lastTimeline[lastTimeline.length - 1], null, 2);
  }
}

function load() {
  chrome.runtime.sendMessage({ type: "haai_get_workbench_data" }, (response) => {
    if (chrome.runtime.lastError) {
      details.textContent = "Workbench failed: " + chrome.runtime.lastError.message;
      return;
    }

    if (!response || !response.ok) {
      details.textContent = "Workbench failed: no state returned.";
      return;
    }

    render(response);
  });
}

refresh.addEventListener("click", load);
load();
