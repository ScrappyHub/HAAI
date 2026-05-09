"use strict";

if (!window.__HAAI_CONTENT_SCRIPT_LOADED__) {
  window.__HAAI_CONTENT_SCRIPT_LOADED__ = true;

  let haaiLastFingerprint = "";

  function norm(value) {
    if (typeof value !== "string") { return ""; }
    return value.replace(/\s+/g, " ").trim();
  }

  function provider() {
    const host = String(location.hostname || "").toLowerCase();
    if (host.includes("chatgpt.com") || host.includes("openai.com")) { return "chatgpt"; }
    if (host.includes("claude.ai")) { return "claude"; }
    if (host.includes("gemini.google.com")) { return "gemini"; }
    if (host.includes("perplexity.ai")) { return "perplexity"; }
    if (host.includes("grok.com") || host.includes("x.ai")) { return "grok"; }
    return "unknown";
  }

  function conversationId() {
    return location.hostname + location.pathname;
  }

  function modelLabel() {
    const text = norm(document.body ? document.body.innerText || "" : "");
    const matches = text.match(/\b(GPT-5|GPT-4o|GPT-4|Claude|Gemini|Grok|Perplexity)\b/gi);
    if (!matches || matches.length === 0) { return "unknown"; }
    return matches[0];
  }

  function roleForNode(node) {
    const attr = node.getAttribute && node.getAttribute("data-message-author-role");
    if (attr) { return attr; }

    const text = norm(node.innerText || node.textContent || "");
    if (text.match(/^(you|user)\b[: ]/i)) { return "user"; }
    if (text.match(/^(assistant|chatgpt|claude|gemini)\b[: ]/i)) { return "assistant"; }

    return "unknown";
  }

  function collectMessages() {
    const selectors = [
      "[data-message-author-role]",
      "article",
      ".markdown",
      ".message"
    ];

    const seen = new Set();
    const out = [];

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);

      for (const node of nodes) {
        const text = norm(node.innerText || node.textContent || "");
        if (!text || text.length < 4) { continue; }
        if (seen.has(text)) { continue; }

        seen.add(text);
        out.push({
          role: roleForNode(node),
          text: text,
          length: text.length
        });
      }
    }

    return out.slice(-24);
  }

  function fingerprint(messages) {
    return JSON.stringify(messages).slice(-12000);
  }

  function emit(eventType, payload) {
    chrome.runtime.sendMessage({
      type: "haai_record_event",
      event: {
        schema: "haai.extension_event.v1",
        event_type: eventType,
        created_utc: new Date().toISOString(),
        source: "content_script",
        provider: provider(),
        model: modelLabel(),
        page_url: location.href,
        page_title: document.title,
        conversation_id: conversationId(),
        payload: payload || {}
      }
    });
  }

  function scan() {
    const messages = collectMessages();
    const fp = fingerprint(messages);

    if (!fp || fp === haaiLastFingerprint) {
      return;
    }

    haaiLastFingerprint = fp;

    emit("conversation_snapshot", {
      message_count: messages.length,
      messages: messages
    });
  }

  function recoveryPrompt(messages) {
    const evidence = messages.map((m) => "[" + m.role + "] " + m.text).join("\n\n---\n\n");

    return [
      "HAAI CONTEXT RECOVERY REQUEST",
      "",
      "Reconstruct the current AI work session from this captured conversation evidence.",
      "",
      "Return:",
      "1. What is being worked on.",
      "2. Recent user instructions.",
      "3. Recent assistant actions.",
      "4. Current blockers or errors.",
      "5. Likely model/provider context.",
      "6. Next best action.",
      "7. Confidence and uncertainty.",
      "",
      "Provider: " + provider(),
      "Model label if visible: " + modelLabel(),
      "Conversation ID: " + conversationId(),
      "URL: " + location.href,
      "",
      "Evidence:",
      evidence
    ].join("\n");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, reason: "INVALID_MESSAGE" });
      return true;
    }

    if (message.type === "haai_build_context_prompt") {
      const messages = collectMessages();
      sendResponse({
        ok: true,
        provider: provider(),
        model: modelLabel(),
        conversation_id: conversationId(),
        message_count: messages.length,
        prompt: recoveryPrompt(messages)
      });
      return true;
    }

    if (message.type === "haai_force_scan") {
      scan();
      sendResponse({ ok: true, result: "scan_completed" });
      return true;
    }

    sendResponse({ ok: false, reason: "UNKNOWN_CONTENT_MESSAGE" });
    return true;
  });

  emit("content_script_loaded", {
    provider: provider(),
    model: modelLabel(),
    conversation_id: conversationId()
  });

  setInterval(scan, 2000);
  scan();
}
