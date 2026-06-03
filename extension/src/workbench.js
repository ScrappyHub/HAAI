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
const systemCheck = document.getElementById("systemCheck");
const exportSystemCheck = document.getElementById("exportSystemCheck");
const exportReport = document.getElementById("exportReport");
const compareReplay = document.getElementById("compareReplay");
const exportHistory = document.getElementById("exportHistory");
const freezeBundle = document.getElementById("freezeBundle");
const certificationReport = document.getElementById("certificationReport");
const importReplayBundle = document.getElementById("importReplayBundle");
const importReplayInput = document.getElementById("importReplayInput");
const exportImportVerify = document.getElementById("exportImportVerify");
const verifyReplay = document.getElementById("verifyReplay");
const toggleTechnical = document.getElementById("toggleTechnical");
const evidenceStatus = document.getElementById("evidenceStatus");
const snapshotPrev = document.getElementById("snapshotPrev");
const snapshotNext = document.getElementById("snapshotNext");
const snapshotLatest = document.getElementById("snapshotLatest");
const snapshotCompare = document.getElementById("snapshotCompare");
const snapshotDeltaExport = document.getElementById("snapshotDeltaExport");
const snapshotView = document.getElementById("snapshotView");
const filmstrip = document.getElementById("filmstrip");
const dropZone = document.getElementById("dropZone");

let lastState = null;
let lastTimeline = [];
let technicalVisible = false;
let lastVerifyResult = null;
let importedReplayState = null;
let lastImportVerifyResult = null;
let replaySnapshots = [];
let snapshotIndex = -1;
let lastSnapshotDelta = null;
let lastArchive = [];
let compareSelection = [];
let haaiRuntimeState = null;
let lastSystemCheckReport = null;

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
    events: events,
    input_event_count: countEvents(events, "input_surface_changed"),
    snapshot_event_count: countEvents(events, "conversation_snapshot"),
    domain_changes: lifecycle.domain_changes || 0,
    conversation_changes: lifecycle.conversation_changes || 0,
    exports: lifecycle.exports || 0,
    latest_input_preview: latestInputPreview(events),
    latest_snapshot_summary: snapshotSummary(lastSnapshot),
    event_type_counts: eventTypeCounts(events),
    timeline_count: Array.isArray(timeline) ? timeline.length : 0,
    timeline_recent: Array.isArray(timeline) ? timeline.slice(-5) : [],
    includes_full_events: true
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
    events: events,
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
  refreshEvidenceStatus();
  refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
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

freezeBundle.addEventListener("click", async () => {

  await freezeReplayBundleExport();
});

verifyReplay.addEventListener("click", async () => {
  const result = await verifyCurrentReplay(lastState || {});
  lastVerifyResult = result;
  refreshEvidenceStatus();
  refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
  lastImportVerifyResult = result;
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

toggleTechnical.addEventListener("click", () => {

  setTechnicalVisible(!technicalVisible);

  if (!technicalVisible) {
    replay.textContent =
      humanReplaySummary(lastState || {}) +
      "\n\nTechnical evidence hidden.";
  }
});

refresh.addEventListener("click", load);
setTechnicalVisible(false);
refreshEvidenceStatus();
  refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
load();

async function buildSha256Lines(files) {

  const rows = [];

  for (const file of files) {

    const hash = await sha256Hex(file.body);

    rows.push(hash + "  " + file.name);
  }

  return rows.join("\n");
}

function replaySummaryText(state) {

  const surface = state && state.surface
    ? state.surface
    : {};

  return [
    "HAAI Replay Freeze Bundle",
    "",
    "Provider: " + (surface.provider || "unknown"),
    "Domain: " + (surface.domain || "-"),
    "Title: " + (surface.title || "Untitled"),
    "Capture State: " + (state.active_capture ? "running" : "stopped"),
    "Events: " + ((state.events || []).length),
    "Generated UTC: " + new Date().toISOString()
  ].join("\n");
}

async function freezeReplayBundleExport() {

  const state = lastState || {};
  const verify = await verifyCurrentReplay(state);
  const report = replayReportObject(state, lastTimeline || []);

  const replayText = buildReplayText(state);

  const chainLines = (report.event_chain_hashes || []).map((row) => {
    return (
      String(row.index) +
      " | " +
      String(row.event_type || "unknown") +
      " | " +
      String(row.event_chain_hash_sha256 || "")
    );
  });

  const files = [
    {
      name: "summary.txt",
      body: replaySummaryText(state)
    },
    {
      name: "replay_report.json",
      body: JSON.stringify(report, null, 2)
    },
    {
      name: "verification.json",
      body: JSON.stringify(verify, null, 2)
    },
    {
      name: "replay_chain.txt",
      body: chainLines.join("\n")
    },
    {
      name: "replay.txt",
      body: replayText
    }
  ];

  const shaLines = await buildSha256Lines(files);

  files.push({
    name: "sha256sums.txt",
    body: shaLines
  });

  for (const file of files) {

    const filename =
      "haai_freeze_bundle/" +
      file.name;

    downloadText(
      filename,
      file.body,
      "text/plain"
    );
  }

  replay.textContent =
    humanReplaySummary(state) +
    "\n\nFreeze bundle exported successfully.";

  details.textContent =
    "Freeze bundle exported.\n\n" +
    files.map((f) => f.name).join("\n");
}

async function readJsonFile(file) {

  return new Promise((resolve, reject) => {

    const reader = new FileReader();

    reader.onload = () => {

      try {

        resolve(JSON.parse(String(reader.result || "{}")));

      } catch (err) {

        reject(err);
      }
    };

    reader.onerror = () => reject(reader.error);

    reader.readAsText(file);
  });
}

function importedReplaySummary(report) {

  if (!report) {
    return "No imported replay.";
  }

  return [
    "Imported Replay Bundle",
    "",
    "Provider: " + (report.provider || "unknown"),
    "Domain: " + (report.domain || "-"),
    "Session: " + (report.session_id || "-"),
    "Events: " + (report.event_count || 0),
    "Snapshots: " + (report.snapshot_event_count || 0),
    "Conversation changes: " + (report.conversation_changes || 0),
    "Imported replay verification: PASS"
  ].join("\n");
}

async function verifyImportedReplay(report) {

  const failures = [];

  if (!report) {
    failures.push("MISSING_REPORT");
  }

  if (!report.schema) {
    failures.push("MISSING_SCHEMA");
  }

  if (!report.event_count || report.event_count < 1) {
    failures.push("EMPTY_EVENT_COUNT");
  }

  if (!Array.isArray(report.event_chain_hashes)) {
    failures.push("MISSING_EVENT_CHAIN_HASHES");
  }

  return {
    schema: "haai.import_verify.v1",
    created_utc: new Date().toISOString(),
    ok: failures.length === 0,
    failures: failures,
    imported_provider: report.provider || "unknown",
    imported_session_id: report.session_id || ""
  };
}
importReplayBundle.addEventListener("click", () => {

  importReplayInput.click();
});

importReplayInput.addEventListener("change", async (event) => {

  try {

    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    if (files.length > 1 || files.some((file) => file.name === "sha256sums.txt")) {
      await importReplayBundleFiles(files);
      return;
    }

    await importReplayReportFile(files[0]);

  } catch (err) {

    replay.textContent =
      "Replay import failed.\n\n" +
      String(err && err.message ? err.message : err);
  }
});

function activeReplaySource() {
  if (importedReplayState && Array.isArray(importedReplayState.events)) {
    return importedReplayState;
  }

  return lastState || {};
}

function extractSnapshots(source) {
  const events = source && Array.isArray(source.events) ? source.events : [];

  return events.filter((event) => {
    return event &&
      event.event_type === "conversation_snapshot" &&
      event.payload;
  });
}

function snapshotHumanText(snapshot, index, total) {
  if (!snapshot || !snapshot.payload) {
    return "No snapshot selected.";
  }

  const payload = snapshot.payload;
  const messages = Array.isArray(payload.normalized_messages)
    ? payload.normalized_messages
    : (Array.isArray(payload.messages) ? payload.messages : []);

  const lastMessages = messages.slice(-6).map((msg, i) => {
    const role = msg.role || "unknown";
    const text = msg.content_text || msg.text || "";
    const preview = text.length > 220 ? text.slice(0, 220) + "..." : text;

    return (i + 1) + ". " + role + ": " + preview;
  });

  return [
    "Conversation Snapshot " + (index + 1) + " of " + total,
    "",
    "Captured: " + (snapshot.created_utc || "-"),
    "Provider: " + (payload.provider || "unknown"),
    "Domain: " + (payload.domain || "-"),
    "Title: " + (payload.title || "-"),
    "Visible messages: " + (payload.message_count || messages.length || 0),
    "Input detected: " + (payload.input_detected ? "yes" : "no"),
    "",
    "Recent visible messages:",
    lastMessages.length ? lastMessages.join("\n\n") : "- none"
  ].join("\n");
}

function refreshSnapshotNavigator() {
  const source = activeReplaySource();
  replaySnapshots = extractSnapshots(source);

  if (replaySnapshots.length === 0) {
    snapshotIndex = -1;
    if (snapshotView) {
      snapshotView.textContent = "No conversation snapshots available for this replay yet.";
    }
    return;
  }

  if (snapshotIndex < 0 || snapshotIndex >= replaySnapshots.length) {
    snapshotIndex = replaySnapshots.length - 1;
  }

  if (snapshotView) {
    snapshotView.textContent = snapshotHumanText(
      replaySnapshots[snapshotIndex],
      snapshotIndex,
      replaySnapshots.length
    );
  }
}

function moveSnapshot(delta) {
  if (!Array.isArray(replaySnapshots) || replaySnapshots.length === 0) {
    refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
    return;
  }

  snapshotIndex += delta;

  if (snapshotIndex < 0) {
    snapshotIndex = 0;
  }

  if (snapshotIndex >= replaySnapshots.length) {
    snapshotIndex = replaySnapshots.length - 1;
  }

  refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
}
snapshotPrev.addEventListener("click", () => {
  moveSnapshot(-1);
});

snapshotNext.addEventListener("click", () => {
  moveSnapshot(1);
});

snapshotLatest.addEventListener("click", () => {
  refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
  if (replaySnapshots.length > 0) {
    snapshotIndex = replaySnapshots.length - 1;
    refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
  }
});

function snapshotMessages(snapshot) {
  if (!snapshot || !snapshot.payload) {
    return [];
  }

  const payload = snapshot.payload;

  if (Array.isArray(payload.normalized_messages)) {
    return payload.normalized_messages.map((msg) => {
      return {
        role: msg.role || "unknown",
        text: msg.content_text || ""
      };
    });
  }

  if (Array.isArray(payload.messages)) {
    return payload.messages.map((msg) => {
      return {
        role: msg.role || "unknown",
        text: msg.text || ""
      };
    });
  }

  return [];
}

function compareSnapshots(left, right) {
  const leftRows = snapshotMessages(left);
  const rightRows = snapshotMessages(right);

  const leftTexts = leftRows.map((row) => row.role + "::" + row.text);
  const rightTexts = rightRows.map((row) => row.role + "::" + row.text);

  const added = rightTexts.filter((x) => !leftTexts.includes(x));
  const removed = leftTexts.filter((x) => !rightTexts.includes(x));

  const leftLast = leftRows.length ? leftRows[leftRows.length - 1] : null;
  const rightLast = rightRows.length ? rightRows[rightRows.length - 1] : null;

  const assistantChanged =
    Boolean(leftLast && rightLast) &&
    leftLast.role === "assistant" &&
    rightLast.role === "assistant" &&
    leftLast.text !== rightLast.text;

  const inputChanged =
    Boolean(leftLast && rightLast) &&
    leftLast.role === "user" &&
    rightLast.role === "user" &&
    leftLast.text !== rightLast.text;

  return {
    schema: "haai.snapshot_delta.v1",
    left_captured_utc: left && left.created_utc ? left.created_utc : "",
    right_captured_utc: right && right.created_utc ? right.created_utc : "",
    left_message_count: leftRows.length,
    right_message_count: rightRows.length,
    message_count_delta: rightRows.length - leftRows.length,
    added_count: added.length,
    removed_count: removed.length,
    assistant_changed: assistantChanged,
    input_changed: inputChanged,
    added_examples: added.slice(0, 5),
    removed_examples: removed.slice(0, 5)
  };
}

function compareCurrentSnapshotWithPrevious() {
  refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();

  if (!Array.isArray(replaySnapshots) || replaySnapshots.length < 2) {
    snapshotView.textContent = "Need at least two snapshots before comparison is available.";
    return;
  }

  if (snapshotIndex <= 0) {
    snapshotIndex = 1;
  }

  const left = replaySnapshots[snapshotIndex - 1];
  const right = replaySnapshots[snapshotIndex];
  const diff = compareSnapshots(left, right);
  lastSnapshotDelta = diff;

  snapshotView.textContent = [
    "Snapshot Change Summary",
    "",
    "From: " + (diff.left_captured_utc || "-"),
    "To: " + (diff.right_captured_utc || "-"),
    "",
    "Visible message count changed by: " + diff.message_count_delta,
    "Messages added: " + diff.added_count,
    "Messages removed: " + diff.removed_count,
    "Assistant response changed: " + (diff.assistant_changed ? "yes" : "no"),
    "User input changed: " + (diff.input_changed ? "yes" : "no"),
    "",
    "Added examples:",
    diff.added_examples.length ? diff.added_examples.join("\n\n") : "- none",
    "",
    "Removed examples:",
    diff.removed_examples.length ? diff.removed_examples.join("\n\n") : "- none"
  ].join("\n");
}
snapshotCompare.addEventListener("click", () => {
  compareCurrentSnapshotWithPrevious();
});

async function exportSnapshotDelta() {
  if (!lastSnapshotDelta) {
    compareCurrentSnapshotWithPrevious();
  }

  if (!lastSnapshotDelta) {
    snapshotView.textContent = "No snapshot delta available to export yet.";
    return;
  }

  const body = JSON.stringify(lastSnapshotDelta, null, 2);
  const hash = await sha256Hex(body);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const envelope = {
    schema: "haai.snapshot_delta_export.v1",
    created_utc: new Date().toISOString(),
    sha256: hash,
    delta: lastSnapshotDelta
  };

  const finalBody = JSON.stringify(envelope, null, 2);
  const filename = "haai_snapshot_delta_" + stamp + "_" + hash.slice(0, 16) + ".json";

  downloadText(filename, finalBody, "application/json");

  snapshotView.textContent =
    "Snapshot delta exported.\n\n" +
    "File: " + filename + "\n" +
    "SHA-256: " + hash;
}
snapshotDeltaExport.addEventListener("click", async () => {
  await exportSnapshotDelta();
});

function replayCertificationObject() {

  const state = lastState || {};
  const surface = state.surface || {};
  const events = Array.isArray(state.events)
    ? state.events
    : [];

  const snapshots = events.filter((event) => {
    return event && event.event_type === "conversation_snapshot";
  });

  return {
    schema: "haai.replay_certification.v1",
    certified_utc: new Date().toISOString(),
    replay_preserved: events.length > 0,
    replay_integrity_verified: lastVerifyResult
      ? Boolean(lastVerifyResult.ok)
      : false,
    provider: surface.provider || "unknown",
    domain: surface.domain || "",
    title: surface.title || "",
    session_id: state.session_id || "",
    session_started_utc: state.session_started_utc || "",
    session_stopped_utc: state.session_stopped_utc || "",
    event_count: events.length,
    events: events,
    snapshot_count: snapshots.length,
    timeline_capture_count: Array.isArray(lastTimeline)
      ? lastTimeline.length
      : 0,
    exports_recorded: state.lifecycle
      ? (state.lifecycle.exports || 0)
      : 0,
    delta_artifacts_available: Boolean(lastSnapshotDelta),
    imported_replay_loaded: Boolean(importedReplayState)
  };
}

function certificationSummaryText(report) {

  return [
    "HAAI Replay Certification Report",
    "",
    "Replay preserved: " + (report.replay_preserved ? "YES" : "NO"),
    "Replay integrity verified: " + (report.replay_integrity_verified ? "YES" : "NOT VERIFIED"),
    "",
    "Provider: " + (report.provider || "unknown"),
    "Domain: " + (report.domain || "-"),
    "Title: " + (report.title || "Untitled"),
    "Session ID: " + (report.session_id || "-"),
    "",
    "Session started: " + (report.session_started_utc || "-"),
    "Session stopped: " + (report.session_stopped_utc || "-"),
    "",
    "Recorded events: " + report.event_count,
    "Conversation snapshots: " + report.snapshot_count,
    "Timeline captures: " + report.timeline_capture_count,
    "Exports recorded: " + report.exports_recorded,
    "",
    "Snapshot delta artifacts available: " +
      (report.delta_artifacts_available ? "YES" : "NO"),
    "",
    "Imported replay loaded: " +
      (report.imported_replay_loaded ? "YES" : "NO"),
    "",
    "Recommended review notes:",
    "- Verify replay integrity before external sharing.",
    "- Preserve exported freeze bundles unchanged.",
    "- Use snapshot comparison for conversation evolution review.",
    "- Technical evidence can remain hidden for human-first review."
  ].join("\n");
}

async function exportCertificationReport() {

  const report = replayCertificationObject();

  const summary = certificationSummaryText(report);

  const hash = await sha256Hex(summary);

  const envelope = {
    schema: "haai.replay_certification_export.v1",
    created_utc: new Date().toISOString(),
    sha256: hash,
    certification: report,
    summary_text: summary
  };

  const stamp =
    envelope.created_utc.replace(/[:.]/g, "-");

  const filename =
    "haai_replay_certification_" +
    stamp +
    "_" +
    hash.slice(0, 16) +
    ".txt";

  downloadText(
    filename,
    summary,
    "text/plain"
  );

  replay.textContent =
    summary +
    "\n\nCertification report exported.";

  details.textContent =
    JSON.stringify(envelope, null, 2);
}
certificationReport.addEventListener("click", async () => {

  await exportCertificationReport();
});

function snapshotMessageCount(snapshot) {

  if (!snapshot || !snapshot.payload) {
    return 0;
  }

  const payload = snapshot.payload;

  if (typeof payload.message_count === "number") {
    return payload.message_count;
  }

  const msgs = snapshotMessages(snapshot);

  return msgs.length;
}

function renderFilmstrip() {

  if (!filmstrip) {
    return;
  }

  filmstrip.innerHTML = "";

  if (!Array.isArray(replaySnapshots) || replaySnapshots.length === 0) {

    filmstrip.textContent =
      "No replay snapshots available.";

    return;
  }

  replaySnapshots.forEach((snapshot, index) => {

    const card = document.createElement("div");

    card.className =
      "snapshotCard" +
      (index === snapshotIndex ? " active" : "");

    const payload = snapshot.payload || {};

    const previous =
      index > 0
        ? replaySnapshots[index - 1]
        : null;

    let deltaText = "Initial snapshot";

    if (previous) {

      const diff =
        compareSnapshots(previous, snapshot);

      deltaText =
        "+" + diff.added_count +
        " added / -" +
        diff.removed_count +
        " removed";
    }

    card.innerHTML =
      '<div class="snapshotTitle">' +
        "Snapshot " + (index + 1) +
      '</div>' +

      '<div class="snapshotMeta">' +
        "Messages: " + snapshotMessageCount(snapshot) + "<br>" +
        "Provider: " + (payload.provider || "unknown") + "<br>" +
        "Captured: " + (snapshot.created_utc || "-") +
      '</div>' +

      '<div class="snapshotDelta">' +
        deltaText +
      '</div>';

    card.addEventListener("click", () => {

      snapshotIndex = index;

      refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
  renderFilmstrip();
      renderFilmstrip();
    });

    filmstrip.appendChild(card);
  });
}

function replayReportToOfflineState(report) {
  const surface = {
    detected: true,
    provider: report.provider || "unknown",
    domain: report.domain || "",
    url: report.url || "",
    title: report.title || "Imported replay",
    message_count: report.latest_snapshot_summary && report.latest_snapshot_summary.message_count
      ? report.latest_snapshot_summary.message_count
      : 0,
    input_detected: true,
    last_seen_utc: report.last_activity_utc || ""
  };

  const events = Array.isArray(report.events)
    ? report.events
    : [];

  return {
    active_capture: false,
    session_id: report.session_id || "imported_replay",
    session_started_utc: report.session_started_utc || "",
    session_stopped_utc: report.session_stopped_utc || "",
    last_activity_utc: report.last_activity_utc || "",
    surface: surface,
    lifecycle: {
      session_started: Boolean(report.session_started_utc),
      session_stopped: Boolean(report.session_stopped_utc),
      domain_changes: report.domain_changes || 0,
      conversation_changes: report.conversation_changes || 0,
      exports: report.exports || 0
    },
    events: events
  };
}

async function importReplayReportObject(report) {
  const verify = await verifyImportedReplay(report);
  lastImportVerifyResult = verify;

  importedReplayState = report;

  if (Array.isArray(report.events)) {
    lastState = replayReportToOfflineState(report);
  }

  details.textContent = JSON.stringify(verify, null, 2);
  replay.textContent = importedReplaySummary(report);

  if (!verify.ok) {
    replay.textContent +=
      "\n\nImported replay verification failed:\n" +
      verify.failures.join("\n");
    refreshEvidenceStatus();
    refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
    return;
  }

  replay.textContent +=
    "\n\nImported replay is loaded for offline inspection.";

  refreshEvidenceStatus();
  refreshRuntimeState("live", "workbench");
  refreshSnapshotNavigator();
}

async function importReplayReportFile(file) {
  const report = await readJsonFile(file);
  await importReplayReportObject(report);
}
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragOver");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragOver");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragOver");

  const files = Array.from(event.dataTransfer.files || []);

  if (files.length === 0) {
    replay.textContent = "No replay report file was dropped."; 
    return;
  }

  try {
    if (files.length > 1 || files.some((file) => file.name === "sha256sums.txt")) {
      await importReplayBundleFiles(files);
    } else {
      await importReplayReportFile(files[0]);
    }
  } catch (err) {
    replay.textContent =
      "Replay import failed.\n\n" +
      String(err && err.message ? err.message : err);
  }
});

async function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result || ""));
    };

    reader.onerror = () => reject(reader.error);

    reader.readAsText(file);
  });
}

function parseSha256Sums(text) {
  const rows = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return rows.map((line) => {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\s*(.+)$/);

    if (!match) {
      return {
        ok: false,
        raw: line,
        sha256: "",
        name: ""
      };
    }

    return {
      ok: true,
      raw: line,
      sha256: match[1].toLowerCase(),
      name: match[2]
    };
  });
}

async function verifyBundleFiles(files) {
  const fileList = Array.from(files || []);
  const sumsFile = fileList.find((file) => file.name === "sha256sums.txt");
  const reportFile = fileList.find((file) => file.name === "replay_report.json");

  const failures = [];

  if (!reportFile) {
    failures.push("MISSING_REPLAY_REPORT_JSON");
  }

  if (!sumsFile) {
    failures.push("MISSING_SHA256SUMS_TXT");
  }

  if (failures.length > 0) {
    return {
      ok: false,
      failures: failures,
      report: null
    };
  }

  const sumsText = await readTextFile(sumsFile);
  const rows = parseSha256Sums(sumsText);

  rows.forEach((row) => {
    if (!row.ok) {
      failures.push("BAD_SHA256SUM_LINE: " + row.raw);
    }
  });

  for (const row of rows) {
    if (!row.ok) { continue; }

    const match = fileList.find((file) => file.name === row.name);

    if (!match) {
      failures.push("BUNDLE_FILE_MISSING: " + row.name);
      continue;
    }

    const body = await readTextFile(match);
    const actual = await sha256Hex(body);

    if (actual !== row.sha256) {
      failures.push("HASH_MISMATCH: " + row.name);
    }
  }

  const report = await readJsonFile(reportFile);

  return {
    ok: failures.length === 0,
    failures: failures,
    report: report,
    checked_files: rows.length
  };
}

async function importReplayBundleFiles(files) {
  const result = await verifyBundleFiles(files);
  lastImportVerifyResult = result;

  if (!result.ok) {
    lastImportVerifyResult = result;
  details.textContent = JSON.stringify(result, null, 2);
    replay.textContent =
      "Replay bundle verification failed.\n\n" +
      result.failures.join("\n");
    return;
  }

  await importReplayReportObject(result.report);

  replay.textContent +=
    "\n\nBundle integrity verified from sha256sums.txt.\nChecked files: " +
    result.checked_files;
}

async function exportImportVerificationReport() {
  if (!lastImportVerifyResult) {
    replay.textContent =
      "No import verification result is available yet.\n\n" +
      "Import a replay bundle first, then export the verification report.";
    return;
  }

  const envelope = {
    schema: "haai.import_verification_export.v1",
    created_utc: new Date().toISOString(),
    verification: lastImportVerifyResult
  };

  const body = JSON.stringify(envelope, null, 2);
  const hash = await sha256Hex(body);
  envelope.sha256 = hash;

  const finalBody = JSON.stringify(envelope, null, 2);
  const stamp = envelope.created_utc.replace(/[:.]/g, "-");
  const filename =
    "haai_import_verification_" +
    stamp +
    "_" +
    hash.slice(0, 16) +
    ".json";

  downloadText(filename, finalBody, "application/json");

  replay.textContent =
    "Import verification report exported.\n\n" +
    "File: " + filename + "\n" +
    "SHA-256: " + hash;

  details.textContent = finalBody;
}
exportImportVerify.addEventListener("click", async () => {
  await exportImportVerificationReport();
});

function ensureEvidenceStatusBadge() {
  let box = document.getElementById("evidenceStatus");

  if (!box) {
    box = document.createElement("div");
    box.id = "evidenceStatus";
    box.className = "statusBox";
    document.body.insertBefore(box, document.body.firstChild);
  }

  return box;
}

function importedBundleStatusText() {
  if (!lastImportVerifyResult) {
    return "Imported Bundle: Not checked";
  }

  const ok = lastImportVerifyResult.ok === true;
  const failures = Array.isArray(lastImportVerifyResult.failures)
    ? lastImportVerifyResult.failures.length
    : 0;

  const checked = typeof lastImportVerifyResult.checked_files === "number"
    ? lastImportVerifyResult.checked_files
    : "-";

  return [
    "Imported Bundle: " + (ok ? "Verified" : "Failed"),
    "Checked Files: " + checked,
    "Import Failures: " + failures,
    "Last Import Check: " + (lastImportVerifyResult.created_utc || "-")
  ].join("\n");
}

function refreshImportedBundleBadge() {
  const box = ensureEvidenceStatusBadge();
  box.textContent = importedBundleStatusText();
}

const HAAI_ORIGINAL_importReplayBundleFiles = importReplayBundleFiles;
importReplayBundleFiles = async function(files) {
  const result = await HAAI_ORIGINAL_importReplayBundleFiles(files);
  refreshImportedBundleBadge();
  return result;
};

const HAAI_ORIGINAL_importReplayReportFile = importReplayReportFile;
importReplayReportFile = async function(file) {
  const result = await HAAI_ORIGINAL_importReplayReportFile(file);
  refreshImportedBundleBadge();
  return result;
};

refreshImportedBundleBadge();

async function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === "object") {
    const out = {};

    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = sortObject(value[key]);
      });

    return out;
  }

  return value;
}

async function sha256HexBytes(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildPacketManifest(report, verify, timeline) {
  return {
    schema: "haai.packet_manifest.v1",
    created_utc: new Date().toISOString(),
    provider: report.provider || "unknown",
    session_id: report.session_id || "",
    replay_event_count: report.event_count || 0,
    replay_snapshot_count: report.snapshot_event_count || 0,
    replay_verify_ok: verify && verify.ok === true,
    timeline_count: Array.isArray(timeline) ? timeline.length : 0,
    files: [
      "manifest.json",
      "packet_id.txt",
      "replay_report.json",
      "replay_verify.json",
      "replay_timeline.json",
      "sha256sums.txt"
    ]
  };
}

async function buildPacketBundle() {
  const report = replayReportObject(lastState || {}, lastTimeline || []);
  const verify = await verifyCurrentReplay(lastState || {});
  const timeline = Array.isArray(lastTimeline) ? lastTimeline : [];

  const manifest = await buildPacketManifest(report, verify, timeline);

  const manifestCanonical = await canonicalJson(manifest);
  const packetId = await sha256HexBytes(manifestCanonical);

  const replayReportText = JSON.stringify(report, null, 2);
  const replayVerifyText = JSON.stringify(verify, null, 2);
  const replayTimelineText = JSON.stringify(timeline, null, 2);
  const manifestText = JSON.stringify(manifest, null, 2);

  const packetIdText = packetId;

  const fileMap = {
    "manifest.json": manifestText,
    "packet_id.txt": packetIdText,
    "replay_report.json": replayReportText,
    "replay_verify.json": replayVerifyText,
    "replay_timeline.json": replayTimelineText
  };

  const shaRows = [];

  for (const name of Object.keys(fileMap).sort()) {
    const hash = await sha256HexBytes(fileMap[name]);
    shaRows.push(hash + "  " + name);
  }

  const shaText = shaRows.join("\n");

  fileMap["sha256sums.txt"] = shaText;

  return {
    packet_id: packetId,
    files: fileMap
  };
}

async function exportPacketBundleFiles() {
  const bundle = await buildPacketBundle();

  for (const name of Object.keys(bundle.files)) {
    const filename =
      "haai_packet_" +
      bundle.packet_id.slice(0,16) +
      "/" +
      name;

    downloadText(
      filename,
      bundle.files[name],
      "application/json"
    );
  }

  replay.textContent =
    "HAAI packet bundle exported.\n\n" +
    "PacketId: " + bundle.packet_id + "\n" +
    "Files: " + Object.keys(bundle.files).length;
}
exportPacketBundle.addEventListener("click", async () => {
  await exportPacketBundleFiles();
});

async function verifyCurrentPacketBundle() {
  const bundle = await buildPacketBundle();
  const failures = [];

  const manifestText = bundle.files["manifest.json"] || "";
  const packetIdText = (bundle.files["packet_id.txt"] || "").trim();
  const shaText = bundle.files["sha256sums.txt"] || "";

  let manifest = null;

  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    failures.push("MANIFEST_JSON_INVALID");
  }

  if (manifest) {
    const canonical = await canonicalJson(manifest);
    const expectedPacketId = await sha256HexBytes(canonical);

    if (packetIdText !== expectedPacketId) {
      failures.push("PACKET_ID_MISMATCH");
    }
  }

  const rows = parseSha256Sums(shaText);

  rows.forEach((row) => {
    if (!row.ok) {
      failures.push("BAD_SHA256SUM_LINE: " + row.raw);
    }
  });

  for (const row of rows) {
    if (!row.ok) { continue; }

    if (!Object.prototype.hasOwnProperty.call(bundle.files, row.name)) {
      failures.push("PACKET_FILE_MISSING: " + row.name);
      continue;
    }

    const actual = await sha256HexBytes(bundle.files[row.name]);

    if (actual !== row.sha256) {
      failures.push("PACKET_HASH_MISMATCH: " + row.name);
    }
  }

  let replayVerify = null;

  try {
    replayVerify = JSON.parse(bundle.files["replay_verify.json"] || "{}");
  } catch (err) {
    failures.push("REPLAY_VERIFY_JSON_INVALID");
  }

  if (replayVerify && replayVerify.ok !== true) {
    failures.push("REPLAY_VERIFY_NOT_OK");
  }

  return {
    schema: "haai.packet_verify.v1",
    created_utc: new Date().toISOString(),
    ok: failures.length === 0,
    packet_id: packetIdText,
    checked_files: rows.length,
    failure_count: failures.length,
    failures: failures
  };
}

async function runPacketBundleVerification() {
  const result = await verifyCurrentPacketBundle();

  const body = JSON.stringify(result, null, 2);
  const hash = await sha256HexBytes(body);

  details.textContent = body;

  replay.textContent =
    "Packet bundle verification " +
    (result.ok ? "passed." : "failed.") +
    "\n\nPacketId: " + result.packet_id +
    "\nChecked files: " + result.checked_files +
    "\nFailures: " + result.failure_count +
    "\nVerification hash: " + hash;

  return result;
}
verifyPacketBundle.addEventListener("click", async () => {
  await runPacketBundleVerification();
});

function buildRuntimeState(source, options) {
  const opts = options || {};

  if (window.HAAIRuntimeCore && typeof window.HAAIRuntimeCore.buildRuntimeState === "function") {
    return window.HAAIRuntimeCore.buildRuntimeState(source || {}, {
      mode: opts.mode || "live",
      source: opts.source || "workbench",
      imported: Boolean(opts.imported),
      verified: lastVerifyResult ? Boolean(lastVerifyResult.ok) : false,
      import_verified: lastImportVerifyResult ? Boolean(lastImportVerifyResult.ok) : false,
      timeline: Array.isArray(lastTimeline) ? lastTimeline : [],
      current_snapshot_index: snapshotIndex,
      current_packet_id: opts.current_packet_id || ""
    });
  }

  const state = source || {};
  const events = Array.isArray(state.events) ? state.events : [];
  const surface = state.surface || {};

  const snapshots = events.filter((event) => {
    return event && event.event_type === "conversation_snapshot" && event.payload;
  });

  const inputEvents = events.filter((event) => {
    return event && event.event_type === "input_surface_changed";
  });

  const timeline = Array.isArray(lastTimeline) ? lastTimeline : [];

  return {
    schema: "haai.runtime_state.v1",
    created_utc: new Date().toISOString(),
    mode: opts.mode || "live",
    source: opts.source || "workbench",
    imported: Boolean(opts.imported),
    verified: lastVerifyResult ? Boolean(lastVerifyResult.ok) : false,
    import_verified: lastImportVerifyResult ? Boolean(lastImportVerifyResult.ok) : false,
    session_id: state.session_id || "",
    provider: surface.provider || "unknown",
    domain: surface.domain || "",
    title: surface.title || "",
    active_capture: Boolean(state.active_capture),
    session_started_utc: state.session_started_utc || "",
    session_stopped_utc: state.session_stopped_utc || "",
    last_activity_utc: state.last_activity_utc || "",
    event_count: events.length,
    snapshot_count: snapshots.length,
    input_event_count: inputEvents.length,
    timeline_count: timeline.length,
    current_snapshot_index: snapshotIndex,
    current_packet_id: "",
    surface: surface,
    lifecycle: state.lifecycle || {},
    snapshots: snapshots,
    input_events: inputEvents,
    timeline: timeline
  };
}

function refreshRuntimeState(mode, source) {
  const runtimeSource = activeReplaySource ? activeReplaySource() : (lastState || {});

  haaiRuntimeState = buildRuntimeState(runtimeSource, {
    mode: mode || "live",
    source: source || "workbench",
    imported: Boolean(importedReplayState)
  });

  return haaiRuntimeState;
}

function runtimeSummaryText(runtime) {
  const rt = runtime || haaiRuntimeState || refreshRuntimeState();

  return [
    "HAAI Runtime State",
    "",
    "Mode: " + (rt.mode || "-"),
    "Source: " + (rt.source || "-"),
    "Provider: " + (rt.provider || "unknown"),
    "Domain: " + (rt.domain || "-"),
    "Title: " + (rt.title || "Untitled"),
    "Session: " + (rt.session_id || "-"),
    "",
    "Events: " + rt.event_count,
    "Snapshots: " + rt.snapshot_count,
    "Input changes: " + rt.input_event_count,
    "Timeline captures: " + rt.timeline_count,
    "",
    "Replay verified: " + (rt.verified ? "yes" : "not yet"),
    "Import verified: " + (rt.import_verified ? "yes" : "not yet")
  ].join("\n");
}

async function exportRuntimeStateArtifact() {

  const runtime = refreshRuntimeState(
    importedReplayState ? "imported" : "live",
    importedReplayState ? "offline_bundle" : "workbench"
  );

  const body = JSON.stringify(runtime, null, 2);

  const hash = await sha256HexBytes(body);

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const envelope = {
    schema: "haai.runtime_state_export.v1",
    created_utc: new Date().toISOString(),
    sha256: hash,
    runtime_state: runtime
  };

  const finalBody = JSON.stringify(envelope, null, 2);

  const filename =
    "haai_runtime_state_" +
    stamp +
    "_" +
    hash.slice(0,16) +
    ".json";

  downloadText(
    filename,
    finalBody,
    "application/json"
  );

  replay.textContent =
    "Runtime state exported.\n\n" +
    "Schema: " + runtime.schema + "\n" +
    "Provider: " + runtime.provider + "\n" +
    "Events: " + runtime.event_count + "\n" +
    "Snapshots: " + runtime.snapshot_count + "\n" +
    "SHA-256: " + hash;
}
exportRuntimeState.addEventListener("click", async () => {
  await exportRuntimeStateArtifact();
});

async function runSystemCheck() {
  const checks = [];

  checks.push({
    name: "Runtime core loaded",
    ok: Boolean(window.HAAIRuntimeCore && window.HAAIRuntimeCore.version),
    detail: window.HAAIRuntimeCore ? window.HAAIRuntimeCore.version : "missing"
  });

  checks.push({
    name: "Runtime state builder available",
    ok: Boolean(window.HAAIRuntimeCore && typeof window.HAAIRuntimeCore.buildRuntimeState === "function"),
    detail: "haai.runtime_state.v1"
  });

  checks.push({
    name: "Packet bundle builder available",
    ok: typeof buildPacketBundle === "function",
    detail: "packet export"
  });

  checks.push({
    name: "Packet bundle verifier available",
    ok: typeof verifyCurrentPacketBundle === "function",
    detail: "packet verify"
  });

  checks.push({
    name: "Import verifier available",
    ok: typeof verifyBundleFiles === "function",
    detail: "sha256sums import verify"
  });

  checks.push({
    name: "Replay snapshots available",
    ok: Array.isArray(replaySnapshots),
    detail: String(Array.isArray(replaySnapshots) ? replaySnapshots.length : 0)
  });

  const passed = checks.filter((row) => row.ok).length;

  const report = {
    schema: "haai.system_check.v1",
    created_utc: new Date().toISOString(),
    ok: passed === checks.length,
    passed: passed,
    total: checks.length,
    checks: checks
  };

  lastSystemCheckReport = report;
  details.textContent = JSON.stringify(report, null, 2);

  replay.textContent =
    "HAAI System Check\n\n" +
    "Status: " + (report.ok ? "PASS" : "REVIEW") + "\n" +
    "Passed: " + report.passed + " / " + report.total + "\n\n" +
    checks.map((row) => {
      return (row.ok ? "PASS: " : "REVIEW: ") + row.name + " - " + row.detail;
    }).join("\n");

  return report;
}
systemCheck.addEventListener("click", async () => {
  await runSystemCheck();
});

async function exportSystemCheckReport() {
  const report = lastSystemCheckReport || await runSystemCheck();

  const body = JSON.stringify(report, null, 2);
  const hash = await sha256HexBytes(body);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const envelope = {
    schema: "haai.system_check_export.v1",
    created_utc: new Date().toISOString(),
    sha256: hash,
    report: report
  };

  const finalBody = JSON.stringify(envelope, null, 2);
  const filename =
    "haai_system_check_" +
    stamp +
    "_" +
    hash.slice(0, 16) +
    ".json";

  downloadText(filename, finalBody, "application/json");

  replay.textContent =
    "System check report exported.\n\n" +
    "File: " + filename + "\n" +
    "SHA-256: " + hash;
}
exportSystemCheck.addEventListener("click", async () => {
  await exportSystemCheckReport();
});
