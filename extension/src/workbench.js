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
const exportReport = document.getElementById("exportReport");
const compareReplay = document.getElementById("compareReplay");
const exportHistory = document.getElementById("exportHistory");
const verifyReplay = document.getElementById("verifyReplay");

let lastState = null;
let lastTimeline = [];
let lastArchive = [];
let compareSelection = [];

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
  }

  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

async function hashEvents(events) {
  const out = [];
  let previousHash = "GENESIS";

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i] || {};
    const canonical = stableStringify(event);
    const eventHash = await sha256Hex(canonical);
    const chainInput = previousHash + "\n" + canonical;
    const chainHash = await sha256Hex(chainInput);

    out.push({
      index: i,
      event_type: event.event_type || "unknown",
      created_utc: event.created_utc || "",
      previous_event_chain_hash_sha256: previousHash,
      event_hash_sha256: eventHash,
      event_chain_hash_sha256: chainHash
    });

    previousHash = chainHash;
  }

  return out;
}

function downloadText(filename, body, mimeType) {
  const blob = new Blob([body], { type: mimeType || "application/json" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
}

function replayStateFromArchive(replay) {
  if (!replay) {
    return null;
  }

  return {
    active_capture: false,
    session_id: replay.session_id || "",
    session_started_utc: replay.session_started_utc || "",
    session_stopped_utc: replay.session_stopped_utc || "",
    last_activity_utc: replay.session_stopped_utc || replay.frozen_utc || "",
    surface: replay.surface || {},
    lifecycle: replay.lifecycle || {},
    events: Array.isArray(replay.events) ? replay.events : []
  };
}

function findArchiveReplay(sessionId) {
  for (let i = lastArchive.length - 1; i >= 0; i -= 1) {
    if (lastArchive[i] && lastArchive[i].session_id === sessionId) {
      return lastArchive[i];
    }
  }
  return null;
}

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

function comparableMessages(events) {
  return (events || []).filter((event) => {
    return event &&
      event.event_type === "conversation_snapshot" &&
      event.payload &&
      Array.isArray(event.payload.messages);
  });
}

function flattenReplayMessages(replay) {
  const rows = [];
  const snapshots = comparableMessages(replay && replay.events ? replay.events : []);

  snapshots.forEach((snapshot) => {
    (snapshot.payload.messages || []).forEach((msg) => {
      rows.push({
        role: msg.role || "unknown",
        text: (msg.text || "").trim()
      });
    });
  });

  return rows;
}

function uniqueTexts(rows) {
  const seen = {};
  const out = [];

  rows.forEach((row) => {
    const text = (row.text || "").trim();

    if (!text) {
      return;
    }

    if (!seen[text]) {
      seen[text] = true;
      out.push(text);
    }
  });

  return out;
}

function compareReplayObjects(a, b) {
  const aRows = flattenReplayMessages(a);
  const bRows = flattenReplayMessages(b);

  const aTexts = uniqueTexts(aRows);
  const bTexts = uniqueTexts(bRows);

  const onlyA = aTexts.filter((x) => !bTexts.includes(x));
  const onlyB = bTexts.filter((x) => !aTexts.includes(x));

  const overlap = aTexts.filter((x) => bTexts.includes(x));

  const overlapRatio =
    (aTexts.length + bTexts.length) === 0
      ? 1
      : (overlap.length * 2) / (aTexts.length + bTexts.length);

  return {
    schema: "haai.replay_diff.v1",
    created_utc: new Date().toISOString(),

    left_session_id: a && a.session_id ? a.session_id : "",
    right_session_id: b && b.session_id ? b.session_id : "",

    left_provider: a && a.surface ? (a.surface.provider || "") : "",
    right_provider: b && b.surface ? (b.surface.provider || "") : "",

    left_message_count: aRows.length,
    right_message_count: bRows.length,

    overlap_count: overlap.length,
    left_only_count: onlyA.length,
    right_only_count: onlyB.length,

    stability_ratio: overlapRatio,

    left_only_examples: onlyA.slice(0, 10),
    right_only_examples: onlyB.slice(0, 10),

    overlap_examples: overlap.slice(0, 10)
  };
}

function latestInputPreview(events) {
  const inputs = events.filter((event) => event && event.event_type === "input_surface_changed");
  if (inputs.length === 0) { return ""; }
  const last = inputs[inputs.length - 1];
  return last && last.payload ? (last.payload.input_preview || "") : "";
}

function replayReportObject(state, timeline) {
  const events = state && Array.isArray(state.events) ? state.events : [];
  const surface = state && state.surface ? state.surface : {};
  const lifecycle = state && state.lifecycle ? state.lifecycle : {};
  const lastSnapshot = latestEvent(events, "conversation_snapshot");

  return {
    schema: "haai.replay_report.v1",
    created_utc: new Date().toISOString(),
    session_id: state.session_id || "",
    capture_state: state.active_capture ? "running" : "stopped",
    provider: surface.provider || "unknown",
    domain: surface.domain || "",
    title: surface.title || "",
    url: surface.url || "",
    session_started_utc: state.session_started_utc || "",
    session_stopped_utc: state.session_stopped_utc || "",
    last_activity_utc: state.last_activity_utc || "",
    event_count: events.length,
    input_event_count: countEvents(events, "input_surface_changed"),
    snapshot_event_count: countEvents(events, "conversation_snapshot"),
    domain_changes: lifecycle.domain_changes || 0,
    conversation_changes: lifecycle.conversation_changes || 0,
    exports: lifecycle.exports || 0,
    latest_input_preview: latestInputPreview(events),
    latest_snapshot_summary: snapshotSummary(lastSnapshot),
    event_type_counts: eventTypeCounts(events),
    timeline_count: Array.isArray(timeline) ? timeline.length : 0,
    timeline_recent: Array.isArray(timeline) ? timeline.slice(-5) : []
  };
}

async function verifyCurrentReplay(state) {
  const events = state && Array.isArray(state.events) ? state.events : [];
  const hashes = await hashEvents(events);
  const chainHead = hashes.length ? hashes[hashes.length - 1].event_chain_hash_sha256 : "GENESIS";

  const failures = [];

  if (events.length !== hashes.length) {
    failures.push("EVENT_HASH_COUNT_MISMATCH");
  }

  for (let i = 0; i < hashes.length; i += 1) {
    const row = hashes[i];

    if (row.index !== i) {
      failures.push("BAD_INDEX_AT_" + i);
    }

    if (i === 0 && row.previous_event_chain_hash_sha256 !== "GENESIS") {
      failures.push("BAD_GENESIS_PREVIOUS_HASH");
    }

    if (i > 0 && row.previous_event_chain_hash_sha256 !== hashes[i - 1].event_chain_hash_sha256) {
      failures.push("CHAIN_LINK_MISMATCH_AT_" + i);
    }

    if (!row.event_hash_sha256 || row.event_hash_sha256.length !== 64) {
      failures.push("BAD_EVENT_HASH_AT_" + i);
    }

    if (!row.event_chain_hash_sha256 || row.event_chain_hash_sha256.length !== 64) {
      failures.push("BAD_CHAIN_HASH_AT_" + i);
    }
  }

  return {
    schema: "haai.replay_verify.v1",
    created_utc: new Date().toISOString(),
    ok: failures.length === 0,
    failure_count: failures.length,
    failures: failures,
    session_id: state.session_id || "",
    event_count: events.length,
    event_hash_count: hashes.length,
    event_chain_head_sha256: chainHead,
    first_event_type: events.length && events[0] ? (events[0].event_type || "unknown") : "",
    last_event_type: events.length && events[events.length - 1] ? (events[events.length - 1].event_type || "unknown") : ""
  };
}

function humanReplaySummary(state) {

  if (!state) {
    return "No replay available.";
  }

  const surface = state.surface || {};
  const provider = surface.provider || "unknown";
  const domain = surface.domain || "-";
  const title = surface.title || "Untitled conversation";

  const active = state.active_capture === true
    ? "Capture Active"
    : "Capture Stopped";

  const events = Array.isArray(state.events)
    ? state.events.length
    : 0;

  const snapshots = countEvents(state.events || [], "conversation_snapshot");

  return (
    "Conversation Replay Summary\n\n" +
    "Title: " + title + "\n" +
    "Provider: " + provider + "\n" +
    "Domain: " + domain + "\n" +
    "State: " + active + "\n" +
    "Recorded events: " + events + "\n" +
    "Conversation snapshots: " + snapshots + "\n\n" +
    "This replay archive can be exported, verified, and reviewed later."
  );
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
  lastArchive = Array.isArray(data.archive) ? data.archive : [];

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
      const replayObj = findArchiveReplay(item.session_id);
      const frozenState = replayStateFromArchive(replayObj);

      if (replayObj) {
        compareSelection.push(replayObj);

        if (compareSelection.length > 2) {
          compareSelection = compareSelection.slice(-2);
        }
      }

      details.textContent = JSON.stringify({
        timeline: item,
        frozen_replay_available: Boolean(replayObj),
        frozen_event_count: replayObj && Array.isArray(replayObj.events) ? replayObj.events.length : 0,
        compare_selection_size: compareSelection.length
      }, null, 2);

      if (frozenState) {
        replay.textContent = buildReplayText(frozenState);
      } else {
        replay.textContent = "No frozen replay archive found for this capture yet.";
      }
    });

    timelineEl.appendChild(div);
  });

  if (lastTimeline.length > 0) {
    const latest = lastTimeline[lastTimeline.length - 1];
    const latestReplay = findArchiveReplay(latest.session_id);
    details.textContent = JSON.stringify({ timeline: latest, frozen_replay_available: Boolean(latestReplay) }, null, 2);
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

exportHistory.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_export_full_history" }, (response) => {
    if (chrome.runtime.lastError) {
      details.textContent = "Full history export failed: " + chrome.runtime.lastError.message;
      return;
    }

    if (!response || !response.ok) {
      details.textContent = "Full history export failed.";
      return;
    }

    downloadText(response.filename, response.body, "application/json");
    details.textContent = "Full history exported.\n\nFile: " + response.filename + "\nSHA-256: " + response.sha256;
  });
});

compareReplay.addEventListener("click", async () => {

  if (compareSelection.length < 2) {
    details.textContent = "Select two replay captures from the timeline first.";
    return;
  }

  const left = compareSelection[compareSelection.length - 2];
  const right = compareSelection[compareSelection.length - 1];

  const diff = compareReplayObjects(left, right);

  details.textContent = JSON.stringify(diff, null, 2);

  replay.textContent =
    "Replay Comparison\n\n" +
    "Left Provider: " + diff.left_provider + "\n" +
    "Right Provider: " + diff.right_provider + "\n\n" +
    "Overlap Count: " + diff.overlap_count + "\n" +
    "Left Only: " + diff.left_only_count + "\n" +
    "Right Only: " + diff.right_only_count + "\n" +
    "Stability Ratio: " + diff.stability_ratio;
});

verifyReplay.addEventListener("click", async () => {
  const result = await verifyCurrentReplay(lastState || {});
  details.textContent = JSON.stringify(result, null, 2);

  if (result.ok) {
    replay.textContent = buildReplayText(lastState || {}) + "\n\nVERIFY CURRENT REPLAY: PASS\nEVENT CHAIN HEAD: " + result.event_chain_head_sha256;
  } else {
    replay.textContent = buildReplayText(lastState || {}) + "\n\nVERIFY CURRENT REPLAY: FAIL\nFAILURES: " + result.failures.join(", ");
  }
});

exportReport.addEventListener("click", async () => {
  const report = replayReportObject(lastState || {}, lastTimeline || []);
  const events = lastState && Array.isArray(lastState.events) ? lastState.events : [];

  report.event_hashes = await hashEvents(events);
  report.event_hash_count = report.event_hashes.length;
  report.event_chain_head_sha256 = report.event_hashes.length ? report.event_hashes[report.event_hashes.length - 1].event_chain_hash_sha256 : "GENESIS";

  const bodyWithoutReportHash = JSON.stringify(report, null, 2);
  const hash = await sha256Hex(bodyWithoutReportHash);

  report.report_sha256 = hash;

  const finalBody = JSON.stringify(report, null, 2);
  const finalHash = await sha256Hex(finalBody);

  report.final_report_sha256 = finalHash;

  const exportedBody = JSON.stringify(report, null, 2);
  const stamp = report.created_utc.replace(/[:.]/g, "-");
  const filename = "haai_replay_report_" + stamp + "_" + finalHash.slice(0, 16) + ".json";

  downloadText(filename, exportedBody, "application/json");

  details.textContent = "Replay report exported.\n\nFile: " + filename + "\nReport SHA-256: " + finalHash + "\nEvent hashes: " + report.event_hash_count + "\nEvent chain head: " + report.event_chain_head_sha256;
});

refresh.addEventListener("click", load);
load();
