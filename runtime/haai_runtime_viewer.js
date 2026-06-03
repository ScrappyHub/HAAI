"use strict";

const openRuntime = document.getElementById("openRuntime");
const openReplayReport = document.getElementById("openReplayReport");
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
  const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;

  if (!file) {
    return;
  }

  try {
    await loadArtifactFile(file);
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

  const file = event.dataTransfer.files && event.dataTransfer.files[0]
    ? event.dataTransfer.files[0]
    : null;

  if (!file) {
    summary.textContent = "No file dropped.";
    return;
  }

  try {
    await loadArtifactFile(file);
  } catch (err) {
    summary.textContent = "Artifact load failed.\n\n" + String(err && err.message ? err.message : err);
  }
});
