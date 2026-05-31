"use strict";

/*
  HAAI Runtime Core v1

  Stable replay/evidence primitives.
  UI shells and capture adapters should call this layer instead of owning
  replay, packet, and verification rules directly.
*/

const HAAI_RUNTIME_CORE_VERSION = "0.1.0";

function haaiSortObject(value) {
  if (Array.isArray(value)) {
    return value.map(haaiSortObject);
  }

  if (value && typeof value === "object") {
    const out = {};

    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = haaiSortObject(value[key]);
      });

    return out;
  }

  return value;
}

function haaiCanonicalJson(value) {
  return JSON.stringify(haaiSortObject(value));
}

async function haaiSha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function haaiExtractSnapshots(state) {
  const events = state && Array.isArray(state.events) ? state.events : [];

  return events.filter((event) => {
    return event &&
      event.event_type === "conversation_snapshot" &&
      event.payload;
  });
}

function haaiExtractInputEvents(state) {
  const events = state && Array.isArray(state.events) ? state.events : [];

  return events.filter((event) => {
    return event &&
      event.event_type === "input_surface_changed";
  });
}

function haaiSnapshotMessages(snapshot) {
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

function haaiCompareSnapshots(left, right) {
  const leftRows = haaiSnapshotMessages(left);
  const rightRows = haaiSnapshotMessages(right);

  const leftTexts = leftRows.map((row) => row.role + "::" + row.text);
  const rightTexts = rightRows.map((row) => row.role + "::" + row.text);

  const added = rightTexts.filter((x) => !leftTexts.includes(x));
  const removed = leftTexts.filter((x) => !rightTexts.includes(x));

  return {
    schema: "haai.snapshot_delta.v1",
    left_captured_utc: left && left.created_utc ? left.created_utc : "",
    right_captured_utc: right && right.created_utc ? right.created_utc : "",
    left_message_count: leftRows.length,
    right_message_count: rightRows.length,
    message_count_delta: rightRows.length - leftRows.length,
    added_count: added.length,
    removed_count: removed.length,
    added_examples: added.slice(0, 5),
    removed_examples: removed.slice(0, 5)
  };
}

function haaiBuildRuntimeState(source, options) {
  const opts = options || {};
  const state = source || {};
  const events = Array.isArray(state.events) ? state.events : [];
  const surface = state.surface || {};
  const snapshots = haaiExtractSnapshots(state);
  const inputEvents = haaiExtractInputEvents(state);
  const timeline = Array.isArray(opts.timeline) ? opts.timeline : [];

  return {
    schema: "haai.runtime_state.v1",
    runtime_core_version: HAAI_RUNTIME_CORE_VERSION,
    created_utc: new Date().toISOString(),
    mode: opts.mode || "live",
    source: opts.source || "runtime_core",
    imported: Boolean(opts.imported),
    verified: Boolean(opts.verified),
    import_verified: Boolean(opts.import_verified),
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
    current_snapshot_index: typeof opts.current_snapshot_index === "number"
      ? opts.current_snapshot_index
      : -1,
    current_packet_id: opts.current_packet_id || "",
    surface: surface,
    lifecycle: state.lifecycle || {},
    snapshots: snapshots,
    input_events: inputEvents,
    timeline: timeline
  };
}

if (typeof window !== "undefined") {
  window.HAAIRuntimeCore = {
    version: HAAI_RUNTIME_CORE_VERSION,
    sortObject: haaiSortObject,
    canonicalJson: haaiCanonicalJson,
    sha256Hex: haaiSha256Hex,
    extractSnapshots: haaiExtractSnapshots,
    extractInputEvents: haaiExtractInputEvents,
    snapshotMessages: haaiSnapshotMessages,
    compareSnapshots: haaiCompareSnapshots,
    buildRuntimeState: haaiBuildRuntimeState
  };
}
