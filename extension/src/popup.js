"use strict";

function bootPopup() {
  function $(id) {
    return document.getElementById(id);
  }

  const captureBadge = $("captureBadge");
  const surfaceBadge = $("surfaceBadge");
  const metaLine = $("metaLine");
  const promptBox = $("promptBox");
  const note = $("note");

  const checkButton = $("check");
  const probeButton = $("probe");
  const beginButton = $("begin");
  const stopButton = $("stop");
  const buildPromptButton = $("buildPrompt");
  const copyPromptButton = $("copyPrompt");
  const openWorkbenchButton = $("openWorkbench");
  const exportSessionButton = $("exportSession");

  function safeText(node, value) {
    if (node) {
      node.textContent = String(value || "");
    }
  }

  function safeValue(node, value) {
    if (node) {
      node.value = String(value || "");
    }
  }

  function safeClass(node, value) {
    if (node) {
      node.className = value;
    }
  }

  function safeDisabled(node, value) {
    if (node) {
      node.disabled = value === true;
    }
  }

  function safeClick(node, handler) {
    if (node) {
      node.addEventListener("click", handler);
    }
  }

  function say(text) {
    safeValue(promptBox, text);
  }

  function setNote(text) {
    safeText(note, text || "Ready");
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message
          });
          return;
        }

        resolve(response || {
          ok: false,
          error: "No response returned."
        });
      });
    });
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const tab = tabs && tabs[0] ? tabs[0] : null;

        if (!tab || !tab.id) {
          reject(new Error("No active tab found."));
          return;
        }

        resolve(tab);
      });
    });
  }

  async function ensureContentScript(tabId) {
    try {
      if (chrome.scripting && chrome.scripting.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["src/content_script.js"]
        });
      }
    } catch (_) {}
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message
          });
          return;
        }

        resolve(response || {
          ok: false,
          error: "No response returned."
        });
      });
    });
  }

  function renderState(state) {
    const surface = state && state.surface ? state.surface : {};
    const active = Boolean(state && state.active_capture);

    safeText(captureBadge, active ? "Capturing" : "Inactive");
    safeClass(captureBadge, active ? "badge green" : "badge red");
    safeText(surfaceBadge, "AI surface: " + (surface.provider || "unknown"));

    const events = state && Array.isArray(state.events)
      ? state.events.length
      : 0;

    const line =
      "domain=" + (surface.domain || "-") +
      " | messages=" + (surface.message_count || 0) +
      " | input=" + (surface.input_detected ? "yes" : "no") +
      " | events=" + events;

    safeText(metaLine, line);
    safeDisabled(beginButton, active);
    safeDisabled(stopButton, !active);
  }

  function humanSummary(state, timeline) {
    const surface = state && state.surface ? state.surface : {};
    const lifecycle = state && state.lifecycle ? state.lifecycle : {};
    const events = state && Array.isArray(state.events)
      ? state.events.length
      : 0;

    const captures = Array.isArray(timeline)
      ? timeline
      : [];

    return [
      "HAAI session summary",
      "",
      "Capture: " + (state && state.active_capture ? "running" : "stopped"),
      "Provider: " + (surface.provider || "unknown"),
      "Domain: " + (surface.domain || "-"),
      "Title: " + (surface.title || "-"),
      "Visible messages: " + (surface.message_count || 0),
      "Input detected: " + (surface.input_detected ? "yes" : "no"),
      "Recorded events: " + events,
      "Domain changes: " + (lifecycle.domain_changes || 0),
      "Conversation changes: " + (lifecycle.conversation_changes || 0),
      "Exports: " + (lifecycle.exports || 0),
      "",
      "This week captures: " + captures.length,
      "All time captures: " + captures.length,
      "",
      "Use Export Session when ready.",
      "Use Open Workbench for replay, verification, packet export, and certification."
    ].join("\n");
  }

  async function refreshState(showSummary) {
    const response = await sendRuntimeMessage({ type: "haai_get_state" });

    if (!response || response.ok === false) {
      say(
        "State refresh failed.\n\n" +
        ((response && response.error) || "No state returned.")
      );

      setNote("State check failed");
      return;
    }

    const state = response.state || response;
    const timeline = response.timeline || [];

    renderState(state);

    if (showSummary) {
      say(humanSummary(state, timeline));
    }

    setNote("Ready");
  }

  safeClick(checkButton, async () => {
    setNote("Checking...");
    await refreshState(true);
  });

  safeClick(probeButton, async () => {
    setNote("Probing...");

    try {
      const tab = await getActiveTab();

      await ensureContentScript(tab.id);

      const response = await sendTabMessage(tab.id, {
        type: "haai_probe_page"
      });

      if (!response || response.ok === false) {
        await refreshState(true);
        setNote("Probe fallback");
        return;
      }

      say(
        "Page probe complete.\n\n" +
        "Provider: " + (response.provider || "unknown") + "\n" +
        "Domain: " + (response.domain || "-") + "\n" +
        "Messages: " + (response.message_count || 0)
      );

      await refreshState(false);
      setNote("Probe complete");
    } catch (err) {
      say(
        "Probe failed.\n\n" +
        String(err && err.message ? err.message : err)
      );

      setNote("Probe failed");
    }
  });

  safeClick(beginButton, async () => {
    setNote("Starting...");

    const response = await sendRuntimeMessage({
      type: "haai_start_capture"
    });

    if (!response || response.ok === false) {
      say(
        "Capture start failed.\n\n" +
        ((response && response.error) || "No response returned.")
      );

      setNote("Start failed");
      return;
    }

    await refreshState(true);
    setNote("Capture started");
  });

  safeClick(stopButton, async () => {
    setNote("Stopping...");

    const response = await sendRuntimeMessage({
      type: "haai_stop_capture"
    });

    if (!response || response.ok === false) {
      say(
        "Capture stop failed.\n\n" +
        ((response && response.error) || "No response returned.")
      );

      setNote("Stop failed");
      return;
    }

    await refreshState(true);
    setNote("Capture stopped");
  });

  safeClick(buildPromptButton, async () => {
    setNote("Building prompt...");

    try {
      const tab = await getActiveTab();

      await ensureContentScript(tab.id);

      const response = await sendTabMessage(tab.id, {
        type: "haai_build_context_prompt"
      });

      if (!response || response.ok === false) {
        say(
          "Context prompt failed.\n\n" +
          ((response && response.error) || "No response returned.")
        );

        setNote("Prompt failed");
        return;
      }

      say(response.prompt || "No prompt returned.");
      setNote("Prompt ready");
    } catch (err) {
      say(
        "Context prompt failed.\n\n" +
        String(err && err.message ? err.message : err)
      );

      setNote("Prompt failed");
    }
  });

  safeClick(copyPromptButton, async () => {
    try {
      await navigator.clipboard.writeText(promptBox ? promptBox.value || "" : "");
      setNote("Copied");
    } catch (_) {
      setNote("Copy failed");
    }
  });

  safeClick(openWorkbenchButton, () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/workbench.html")
    });
  });

  safeClick(exportSessionButton, async () => {
    setNote("Exporting...");

    const response = await sendRuntimeMessage({
      type: "haai_export_session"
    });

    if (!response || response.ok === false) {
      say(
        "Export failed.\n\n" +
        ((response && response.error) || "No response returned.")
      );

      setNote("Export failed");
      return;
    }

    say(
      "Session export ready.\n\n" +
      "File: " + (response.filename || "-") + "\n" +
      "SHA-256: " + (response.sha256 || "-")
    );

    await refreshState(false);
    setNote("Export ready");
  });

  refreshState(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPopup);
} else {
  bootPopup();
}
