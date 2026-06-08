"use strict";

const openRuntime = document.getElementById("openRuntime");
const openReplayReport = document.getElementById("openReplayReport");
const openPacketBundle = document.getElementById("openPacketBundle");
const systemCheck = document.getElementById("systemCheck");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const summary = document.getElementById("summary");
const details = document.getElementById("details");

let lastLoadedArtifact = null;
let lastRuntimeState = null;

function readJsonFile(file) {
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

function runtimeFromArtifact(artifact) {
  if (!artifact) {
    return null;
  }

  if (artifact.schema === "haai.runtime_state_export.v1" && artifact.runtime_state) {
    return artifact.runtime_state;
  }

  if (artifact.schema === "haai.runtime_state.v1") {
    return artifact;
  }

  if (artifact.schema === "haai.replay_report.v1") {
    const state = {
      session_id: artifact.session_id || "",
      session_started_utc: artifact.session_started_utc || "",
      session_stopped_utc: artifact.session_stopped_utc || "",
      last_activity_utc: artifact.last_activity_utc || "",
      active_capture: false,
      surface: {
        provider: artifact.provider || "unknown",
        domain: artifact.domain || "",
        title: artifact.title || "",
        url: artifact.url || ""
      },
      lifecycle: {
        domain_changes: artifact.domain_changes || 0,
        conversation_changes: artifact.conversation_changes || 0,
        exports: artifact.exports || 0
      },
      events: Array.isArray(artifact.events) ? artifact.events : []
    };

    return window.HAAIRuntimeCore.buildRuntimeState(state, {
      mode: "imported",
      source: "runtime_viewer",
      imported: true,
      timeline: Array.isArray(artifact.timeline_recent) ? artifact.timeline_recent : []
    });
  }

  if (artifact.schema === "haai.replay_certification_export.v1" && artifact.certification) {
    return {
      schema: "haai.runtime_state.v1",
      runtime_core_version: window.HAAIRuntimeCore.version,
      created_utc: new Date().toISOString(),
      mode: "certification",
      source: "runtime_viewer",
      imported: true,
      verified: artifact.certification.verification_result === "PASS",
      import_verified: false,
      session_id: "",
      provider: "certification",
      domain: "",
      title: "Replay Certification",
      active_capture: false,
      session_started_utc: "",
      session_stopped_utc: "",
      last_activity_utc: "",
      event_count: artifact.certification.reviewed_event_count || 0,
      snapshot_count: artifact.certification.reviewed_snapshot_count || 0,
      input_event_count: artifact.certification.reviewed_input_event_count || 0,
      timeline_count: 0,
      current_snapshot_index: -1,
      current_packet_id: artifact.certification.source_packet_id || "",
      surface: {},
      lifecycle: {},
      snapshots: [],
      input_events: [],
      timeline: []
    };
  }

  return null;
}

function runtimeSummaryText(runtime) {
  if (!runtime) {
    return "No supported HAAI runtime artifact detected.";
  }

  return [
    "HAAI Runtime Viewer",
    "",
    "Schema: " + (runtime.schema || "-"),
    "Core Version: " + (runtime.runtime_core_version || "-"),
    "Mode: " + (runtime.mode || "-"),
    "Source: " + (runtime.source || "-"),
    "Provider: " + (runtime.provider || "unknown"),
    "Domain: " + (runtime.domain || "-"),
    "Title: " + (runtime.title || "Untitled"),
    "Session: " + (runtime.session_id || "-"),
    "",
    "Events: " + (runtime.event_count || 0),
    "Snapshots: " + (runtime.snapshot_count || 0),
    "Input Changes: " + (runtime.input_event_count || 0),
    "Timeline Captures: " + (runtime.timeline_count || 0),
    "",
    "Replay Verified: " + (runtime.verified ? "yes" : "not yet"),
    "Import Verified: " + (runtime.import_verified ? "yes" : "not yet")
  ].join("\n");
}

async function loadArtifactFile(file) {
  const artifact = await readJsonFile(file);
  const runtime = runtimeFromArtifact(artifact);

  lastLoadedArtifact = artifact;
  lastRuntimeState = runtime;

  summary.textContent = runtimeSummaryText(runtime);
  details.textContent = JSON.stringify({
    artifact_name: file.name,
    artifact_schema: artifact.schema || "",
    runtime_state: runtime,
    artifact: artifact
  }, null, 2);
}

async function runSystemCheck() {
  const checks = [
    {
      name: "Runtime core loaded",
      ok: Boolean(window.HAAIRuntimeCore && window.HAAIRuntimeCore.version),
      detail: window.HAAIRuntimeCore ? window.HAAIRuntimeCore.version : "missing"
    },
    {
      name: "Runtime builder available",
      ok: Boolean(window.HAAIRuntimeCore && typeof window.HAAIRuntimeCore.buildRuntimeState === "function"),
      detail: "buildRuntimeState"
    },
    {
      name: "Snapshot compare available",
      ok: Boolean(window.HAAIRuntimeCore && typeof window.HAAIRuntimeCore.compareSnapshots === "function"),
      detail: "compareSnapshots"
    },
    {
      name: "Artifact loaded",
      ok: Boolean(lastLoadedArtifact),
      detail: lastLoadedArtifact ? (lastLoadedArtifact.schema || "unknown schema") : "none"
    }
  ];

  const passed = checks.filter((row) => row.ok).length;

  const report = {
    schema: "haai.runtime_viewer_system_check.v1",
    created_utc: new Date().toISOString(),
    ok: passed === checks.length,
    passed: passed,
    total: checks.length,
    checks: checks
  };

  summary.textContent =
    "HAAI Runtime Viewer System Check\n\n" +
    "Status: " + (report.ok ? "PASS" : "REVIEW") + "\n" +
    "Passed: " + report.passed + " / " + report.total;

  details.textContent = JSON.stringify(report, null, 2);
}

openRuntime.addEventListener("click", () => {
  fileInput.click();
});

openReplayReport.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);

  if (files.length === 0) {
    return;
  }

  try {
    if (files.length > 1 || fileByName(files, "manifest.json")) {
      await loadPacketBundleFiles(files);
    } else {
      await loadArtifactFile(files[0]);
    }
  } catch (err) {
    summary.textContent = "Artifact load failed.\n\n" + String(err && err.message ? err.message : err);
  }
});

systemCheck.addEventListener("click", async () => {
  await runSystemCheck();
});

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
    summary.textContent = "No file dropped.";
    return;
  }

  try {
    if (files.length > 1 || fileByName(files, "manifest.json")) {
      await loadPacketBundleFiles(files);
    } else {
      await loadArtifactFile(files[0]);
    }
  } catch (err) {
    summary.textContent = "Artifact load failed.\n\n" + String(err && err.message ? err.message : err);
  }
});

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);

    reader.readAsText(file);
  });
}

function parseSha256Sums(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
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

function fileByName(files, name) {
  return Array.from(files || []).find((file) => file.name === name) || null;
}

async function loadPacketBundleFiles(files) {
  const fileList = Array.from(files || []);
  const failures = [];

  const manifestFile = fileByName(fileList, "manifest.json");
  const packetIdFile = fileByName(fileList, "packet_id.txt");
  const replayReportFile = fileByName(fileList, "replay_report.json");
  const replayVerifyFile = fileByName(fileList, "replay_verify.json");
  const timelineFile = fileByName(fileList, "replay_timeline.json");
  const sumsFile = fileByName(fileList, "sha256sums.txt");

  [
    ["manifest.json", manifestFile],
    ["packet_id.txt", packetIdFile],
    ["replay_report.json", replayReportFile],
    ["replay_verify.json", replayVerifyFile],
    ["replay_timeline.json", timelineFile],
    ["sha256sums.txt", sumsFile]
  ].forEach((row) => {
    if (!row[1]) {
      failures.push("MISSING_" + row[0]);
    }
  });

  if (failures.length > 0) {
    const result = {
      schema: "haai.runtime_packet_verify.v1",
      created_utc: new Date().toISOString(),
      ok: false,
      failures: failures
    };

    summary.textContent = "Packet bundle verification failed.\n\n" + failures.join("\n");
    details.textContent = JSON.stringify(result, null, 2);
    return;
  }

  const manifestText = await readTextFile(manifestFile);
  const packetIdText = (await readTextFile(packetIdFile)).trim();
  const sumsText = await readTextFile(sumsFile);

  let manifest = null;

  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    failures.push("MANIFEST_JSON_INVALID");
  }

  if (manifest) {
    const canonical = window.HAAIRuntimeCore.canonicalJson(manifest);
    const expectedPacketId = await window.HAAIRuntimeCore.sha256Hex(canonical);

    if (packetIdText !== expectedPacketId) {
      failures.push("PACKET_ID_MISMATCH");
    }
  }

  const rows = parseSha256Sums(sumsText);

  rows.forEach((row) => {
    if (!row.ok) {
      failures.push("BAD_SHA256SUM_LINE: " + row.raw);
    }
  });

  for (const row of rows) {
    if (!row.ok) { continue; }

    const file = fileByName(fileList, row.name);

    if (!file) {
      failures.push("BUNDLE_FILE_MISSING: " + row.name);
      continue;
    }

    const body = await readTextFile(file);
    const actual = await window.HAAIRuntimeCore.sha256Hex(body);

    if (actual !== row.sha256) {
      failures.push("HASH_MISMATCH: " + row.name);
    }
  }

  let replayReport = null;
  let replayVerify = null;
  let replayTimeline = null;

  try {
    replayReport = JSON.parse(await readTextFile(replayReportFile));
  } catch (err) {
    failures.push("REPLAY_REPORT_JSON_INVALID");
  }

  try {
    replayVerify = JSON.parse(await readTextFile(replayVerifyFile));
  } catch (err) {
    failures.push("REPLAY_VERIFY_JSON_INVALID");
  }

  try {
    replayTimeline = JSON.parse(await readTextFile(timelineFile));
  } catch (err) {
    failures.push("REPLAY_TIMELINE_JSON_INVALID");
  }

  if (replayVerify && replayVerify.ok !== true) {
    failures.push("REPLAY_VERIFY_NOT_OK");
  }

  const runtime = replayReport ? runtimeFromArtifact(replayReport) : null;

  if (runtime) {
    runtime.import_verified = failures.length === 0;
    runtime.current_packet_id = packetIdText;
  }

  lastLoadedArtifact = replayReport || manifest;
  lastRuntimeState = runtime;

  const result = {
    schema: "haai.runtime_packet_verify.v1",
    created_utc: new Date().toISOString(),
    ok: failures.length === 0,
    packet_id: packetIdText,
    checked_files: rows.length,
    failures: failures,
    manifest: manifest,
    replay_verify: replayVerify,
    replay_timeline_count: Array.isArray(replayTimeline) ? replayTimeline.length : 0
  };

  summary.textContent =
    "HAAI Packet Bundle\n\n" +
    "Status: " + (result.ok ? "PASS" : "FAIL") + "\n" +
    "PacketId: " + packetIdText + "\n" +
    "Checked files: " + result.checked_files + "\n" +
    "Timeline captures: " + result.replay_timeline_count + "\n\n" +
    runtimeSummaryText(runtime);

  details.textContent = JSON.stringify({
    verification: result,
    runtime_state: runtime
  }, null, 2);
}
openPacketBundle.addEventListener("click", () => {
  fileInput.click();
});
