"use strict";

const q = (id) => document.getElementById(id);

let lastState = {};
let lastTimeline = [];
let lastArchive = [];

function set(id, value) {
  const el = q(id);
  if (el) { el.textContent = String(value ?? ""); }
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response returned." });
    });
  });
}

function stateSummary(state) {
  const surface = state.surface || {};
  const lifecycle = state.lifecycle || {};
  const events = Array.isArray(state.events) ? state.events : [];

  return [
    "Current Replay",
    "",
    "Capture: " + (state.active_capture ? "recording" : "stopped"),
    "Provider: " + (surface.provider || "unknown"),
    "Domain: " + (surface.domain || "-"),
    "Title: " + (surface.title || "-"),
    "Messages: " + (surface.message_count || 0),
    "Input detected: " + (surface.input_detected ? "yes" : "no"),
    "Events: " + events.length,
    "Domain changes: " + (lifecycle.domain_changes || 0),
    "Conversation changes: " + (lifecycle.conversation_changes || 0),
    "Exports: " + (lifecycle.exports || 0)
  ].join("\n");
}

function renderTimeline(events) {
  const box = q("timeline");
  if (!box) { return; }

  const rows = (events || []).slice(-12).reverse();

  if (!rows.length) {
    box.innerHTML = '<div class="event"><b>No events</b><span>-</span></div>';
    return;
  }

  box.innerHTML = rows.map((event) => {
    return '<div class="event"><b>' +
      escapeHtml(event.event_type || "event") +
      '</b><span>' +
      escapeHtml(event.created_utc || event.utc || "-") +
      '</span></div>';
  }).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");
}

function renderSessions() {
  const box = q("sessions");
  if (!box) { return; }

  if (!lastTimeline.length) {
    box.textContent = "No saved sessions yet. Export or stop a capture to save one.";
    return;
  }

  box.innerHTML = lastTimeline.slice().reverse().slice(0, 20).map((item, index) => {
    const title = escapeHtml(item.title || item.domain || "Untitled capture");
    const meta = "provider=" + escapeHtml(item.provider || "unknown") +
      " | events=" + escapeHtml(item.event_count || 0) +
      " | messages=" + escapeHtml(item.message_count || 0);
    const time = escapeHtml(item.stopped_utc || item.started_utc || "-");
    return '<div class="session" data-index="' + index + '"><b>' + title + '</b><span>' + meta + '</span><span>' + time + '</span></div>';
  }).join("");

  Array.from(box.querySelectorAll(".session")).forEach((el) => {
    el.addEventListener("click", () => {
      const reversed = lastTimeline.slice().reverse().slice(0, 20);
      const item = reversed[Number(el.dataset.index)];
      set("detail", JSON.stringify(item, null, 2));
    });
  });
}

function render(data) {
  lastState = data.state || {};
  lastTimeline = Array.isArray(data.timeline) ? data.timeline : [];
  lastArchive = Array.isArray(data.archive) ? data.archive : [];

  const surface = lastState.surface || {};
  const events = Array.isArray(lastState.events) ? lastState.events : [];

  set("stateValue", lastState.active_capture ? "Recording" : "Stopped");
  set("providerValue", surface.provider || "unknown");
  set("eventsValue", events.length);
  set("savedValue", lastTimeline.length);
  set("detail", stateSummary(lastState));

  renderTimeline(events);
  renderSessions();
}

async function load() {
  set("detail", "Loading HAAI replay state...");
  const response = await send({ type: "haai_get_workbench_data" });

  if (!response || !response.ok) {
    set("detail", "Replay Center failed.\n\n" + ((response && response.error) || "No state returned."));
    return;
  }

  render(response);
}

q("refresh").addEventListener("click", load);

q("openEvidenceLab").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/workbench.html") });
});

q("openArtifactViewer").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/haai_runtime_viewer.html") });
});

q("exportCurrent").addEventListener("click", async () => {
  set("detail", "Exporting current session...");
  const response = await send({ type: "haai_export_session" });

  if (!response || !response.ok) {
    set("detail", "Export failed.\n\n" + ((response && response.error) || "No response returned."));
    return;
  }

  set("detail",
    "Export created.\n\nFile: " +
    (response.filename || "-") +
    "\nSHA-256: " +
    (response.sha256 || "-") +
    "\n\nCheck browser downloads."
  );
});

load();
