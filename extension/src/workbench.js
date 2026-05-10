"use strict";

const weekCount = document.getElementById("weekCount");
const allCount = document.getElementById("allCount");
const currentSession = document.getElementById("currentSession");
const timelineEl = document.getElementById("timeline");
const details = document.getElementById("details");
const refresh = document.getElementById("refresh");

let lastState = null;
let lastTimeline = [];

function withinWeek(item) {
  const t = Date.parse(item.stopped_utc || item.started_utc || "");
  if (!Number.isFinite(t)) { return false; }
  return (Date.now() - t) <= (7 * 24 * 60 * 60 * 1000);
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
