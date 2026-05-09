"use strict";

const HAAI_STATE = {
  extension_version: "0.1.0",
  recorder_mode: "idle",
  active_capture: false
};

chrome.runtime.onInstalled.addListener(() => {
  console.log("HAAI_BACKGROUND_READY");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({
      ok: false,
      reason: "INVALID_MESSAGE"
    });

    return;
  }

  if (message.type === "haai_ping") {
    sendResponse({
      ok: true,
      result: "pong",
      state: HAAI_STATE
    });

    return;
  }

  if (message.type === "haai_begin_capture") {
    HAAI_STATE.active_capture = true;
    HAAI_STATE.recorder_mode = "capture";

    sendResponse({
      ok: true,
      result: "capture_started"
    });

    return;
  }

  if (message.type === "haai_stop_capture") {
    HAAI_STATE.active_capture = false;
    HAAI_STATE.recorder_mode = "idle";

    sendResponse({
      ok: true,
      result: "capture_stopped"
    });

    return;
  }

  sendResponse({
    ok: false,
    reason: "UNKNOWN_MESSAGE_TYPE"
  });
});
