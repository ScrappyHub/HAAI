"use strict";

if (!window.__HAAI_CONTENT_SCRIPT_LOADED__) {
  window.__HAAI_CONTENT_SCRIPT_LOADED__ = true;

  let haaiLastFingerprint = "";

  function haaiNormalizeText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(/\s+/g, " ").trim();
  }

  function haaiDetectProvider() {
    const host = String(location.hostname || "").toLowerCase();

    if (host.includes("chatgpt.com") || host.includes("openai.com")) {
      return "chatgpt";
    }

    if (host.includes("claude.ai")) {
      return "claude";
    }

    if (host.includes("gemini.google.com")) {
      return "gemini";
    }

    if (host.includes("perplexity.ai")) {
      return "perplexity";
    }

    if (host.includes("grok.com") || host.includes("x.ai")) {
      return "grok";
    }

    return "unknown";
  }

  function haaiCollectRecentMessages() {
    const selectors = [
      "[data-message-author-role]",
      "[data-testid]",
      ".markdown",
      ".message",
      "article",
      "main"
    ];

    const seen = new Set();
    const collected = [];

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);

      for (const node of nodes) {
        const text = haaiNormalizeText(node.innerText || node.textContent || "");

        if (!text || text.length < 8) {
          continue;
        }

        if (seen.has(text)) {
          continue;
        }

        seen.add(text);
        collected.push(text);

        if (collected.length >= 16) {
          return collected.slice(-16);
        }
      }
    }

    return collected.slice(-16);
  }

  function haaiFingerprint(messages) {
    return messages.join("\n---\n").slice(-6000);
  }

  function haaiBuildRecoveryPrompt(messages) {
    const joined = messages.join("\n\n---\n\n");

    return [
      "HAAI CONTEXT RECOVERY REQUEST",
      "",
      "I started an AI evidence recorder in the middle of this conversation.",
      "Please reconstruct the current work context from the visible recent conversation evidence.",
      "",
      "Return:",
      "1. What we are working on.",
      "2. The most recent decisions.",
      "3. Current blockers or errors.",
      "4. What should happen next.",
      "5. A copyable continuation prompt.",
      "6. Confidence and uncertainty for each major claim.",
      "",
      "Detected provider: " + haaiDetectProvider(),
      "Page title: " + document.title,
      "Page URL: " + location.href,
      "",
      "Visible recent conversation evidence:",
      joined
    ].join("\n");
  }

  function haaiEmitEvent(eventType, payload) {
    chrome.runtime.sendMessage({
      type: "haai_record_event",
      event: {
        schema: "haai.extension_event.v1",
        event_type: eventType,
        created_utc: new Date().toISOString(),
        source: "content_script",
        provider: haaiDetectProvider(),
        page_url: location.href,
        page_title: document.title,
        payload: payload || {}
      }
    });
  }

  function haaiScan() {
    const messages = haaiCollectRecentMessages();
    const fingerprint = haaiFingerprint(messages);

    if (!fingerprint || fingerprint === haaiLastFingerprint) {
      return;
    }

    haaiLastFingerprint = fingerprint;

    haaiEmitEvent("conversation_snapshot", {
      message_count: messages.length,
      recent_messages: messages
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, reason: "INVALID_MESSAGE" });
      return true;
    }

    if (message.type === "haai_build_context_prompt") {
      const messages = haaiCollectRecentMessages();
      const prompt = haaiBuildRecoveryPrompt(messages);

      sendResponse({
        ok: true,
        provider: haaiDetectProvider(),
        message_count: messages.length,
        prompt: prompt
      });

      return true;
    }

    if (message.type === "haai_force_scan") {
      haaiScan();
      sendResponse({ ok: true, result: "scan_completed" });
      return true;
    }

    sendResponse({ ok: false, reason: "UNKNOWN_CONTENT_MESSAGE" });
    return true;
  });

  haaiEmitEvent("content_script_loaded", {
    provider: haaiDetectProvider()
  });

  setInterval(haaiScan, 2000);
  haaiScan();
}
