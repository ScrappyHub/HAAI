"use strict";

const promptBox = document.getElementById("promptBox");
const pingButton = document.getElementById("ping");
const beginButton = document.getElementById("begin");
const stopButton = document.getElementById("stop");
const buildPromptButton = document.getElementById("buildPrompt");
const copyPromptButton = document.getElementById("copyPrompt");

function setText(value) {
  promptBox.value = value;
}

pingButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_ping" }, (response) => {
    setText(JSON.stringify(response, null, 2));
  });
});

beginButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_begin_capture" }, (response) => {
    setText(JSON.stringify(response, null, 2));
  });
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "haai_stop_capture" }, (response) => {
    setText(JSON.stringify(response, null, 2));
  });
});

buildPromptButton.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tabs || tabs.length === 0 || !tabs[0].id) {
    setText("HAAI_NO_ACTIVE_TAB");
    return;
  }

  chrome.tabs.sendMessage(tabs[0].id, { type: "haai_build_context_prompt" }, (response) => {
    if (chrome.runtime.lastError) {
      setText("HAAI_CONTENT_SCRIPT_ERROR: " + chrome.runtime.lastError.message);
      return;
    }

    if (!response || !response.ok) {
      setText("HAAI_CONTEXT_PROMPT_FAILED");
      return;
    }

    setText(response.prompt);
  });
});

copyPromptButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(promptBox.value || "");
});
