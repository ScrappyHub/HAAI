"use strict";

if (!window.__HAAI_CONTENT_LOADED__) {
  window.__HAAI_CONTENT_LOADED__ = true;

  let lastSnapshot = "";
  let lastInputState = "";

  function canSend() {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage;
  }

  function safeSend(message) {
    try {
      if (!canSend()) { return; }
      chrome.runtime.sendMessage(message, () => {});
    } catch (_err) {}
  }

  function cleanText(value) {
    if (typeof value !== "string") { return ""; }
    return value.replace(/\s+/g, " ").trim();
  }

  function isNoise(text) {
    const t = cleanText(text).toLowerCase();
    if (!t) { return true; }
    if (t.includes("chatgpt can make mistakes")) { return true; }
    if (t.includes("see your privacy choices")) { return true; }
    if (t.includes("sponsored")) { return true; }
    if (t.includes("create an image write or edit look something up")) { return true; }
    return false;
  }

  function googleAiProviderName() {
  const host = location.hostname.toLowerCase();

  if (host.includes("gemini.google.com")) {
    return "gemini";
  }

  if (host.includes("aistudio.google.com")) {
    return "google-ai-studio";
  }

  if (host.includes("bard.google.com")) {
    return "gemini";
  }

  if (host.includes("google.com") && location.pathname.toLowerCase().includes("/search")) {
    return "google-ai-overview";
  }

  return "";
}

function provider() {
    const d = location.hostname.toLowerCase();
    if (d.includes("chatgpt.com") || d.includes("openai.com")) { return "chatgpt"; }
    if (d.includes("claude.ai")) { return "claude"; }
    if (d.includes("gemini.google.com")) { return "gemini"; }
    if (d.includes("perplexity.ai")) { return "perplexity"; }
    if (d.includes("grok.com") || d.includes("x.ai")) { return "grok"; }
    return "unknown";
  }

  function inputText() {
    const el =
      document.querySelector("textarea") ||
      document.querySelector("[contenteditable='true']") ||
      document.querySelector("div[role='textbox']");

    return el ? cleanText(el.value || el.innerText || el.textContent || "") : "";
  }

  function chatgptMessages() {
    const out = [];
    const nodes = document.querySelectorAll("[data-message-author-role]");

    for (const node of nodes) {
      const text = cleanText(node.innerText || node.textContent || "");
      if (!text || text.length < 2 || isNoise(text)) { continue; }

      const role = node.getAttribute("data-message-author-role") || "unknown";
      out.push({ role: role, text: text, length: text.length });
    }

    return out.slice(-32);
  }

function geminiMessages() {
  const selectors = [
    "message-content",
    "div[data-test-id*='conversation-turn']",
    "div[class*='conversation-turn']",
    "div[class*='model-response']",
    "div[class*='query-text']",
    "div.markdown",
    "user-query",
    "model-response"
  ];

  const nodes = [];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (node && node.innerText) {
        nodes.push(node);
      }
    });
  });

  const seen = {};
  const out = [];

  nodes.forEach((node) => {
    const text = cleanText(node.innerText);

    if (!text || text.length < 2) {
      return;
    }

    if (seen[text]) {
      return;
    }

    seen[text] = true;

    const joined = [
      node.getAttribute("data-test-id") || "",
      node.getAttribute("class") || "",
      node.tagName || ""
    ].join(" ").toLowerCase();

    let role = "unknown";

    if (joined.includes("user") || joined.includes("query")) {
      role = "user";
    }

    if (joined.includes("model") || joined.includes("response") || joined.includes("markdown")) {
      role = "assistant";
    }

    out.push({
      role: role,
      text: text,
      length: text.length
    });
  });

  return out;
}

function googleAiOverviewMessages() {
  const nodes = Array.from(document.querySelectorAll("div, span, section"))
    .filter((node) => {
      const text = cleanText(node.innerText);
      if (text.length < 40) { return false; }

      const marker = [
        node.getAttribute("aria-label") || "",
        node.getAttribute("class") || "",
        node.getAttribute("data-attrid") || ""
      ].join(" ").toLowerCase();

      return marker.includes("ai") ||
        marker.includes("overview") ||
        marker.includes("generative") ||
        text.toLowerCase().includes("ai overview");
    });

  const seen = {};
  const out = [];

  nodes.forEach((node) => {
    const text = cleanText(node.innerText);
    if (!text || seen[text]) { return; }
    seen[text] = true;

    out.push({
      role: "assistant",
      text: text,
      length: text.length
    });
  });

  return out.slice(0, 5);
}

function genericMessages() {
    const selectors = ["[data-message-author-role]", "article", ".markdown", ".message"];
    const seen = new Set();
    const out = [];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const text = cleanText(node.innerText || node.textContent || "");
        if (!text || text.length < 8 || isNoise(text) || seen.has(text)) { continue; }
        if (selector !== "[data-message-author-role]" && text.includes("ChatGPT can make mistakes")) { continue; }

        seen.add(text);
        const attr = node.getAttribute && node.getAttribute("data-message-author-role");
        const role = attr || "unknown";

        if (role === "unknown") {
          if (text.includes("ChatGPT can make mistakes")) { continue; }
          if (out.some((m) => text.includes(m.text) || m.text.includes(text))) { continue; }
          if (out.some((m) => m.role !== "unknown" && text.indexOf(m.text) >= 0)) { continue; }
        }

        out.push({ role: role, text: text, length: text.length });

        if (out.length >= 32) { return out; }
      }
    }

    return out;
  }

  function collectMessages() {
    if (provider() === "chatgpt") {
      if (googleAiProviderName() === "gemini" || googleAiProviderName() === "google-ai-studio") {
      const gemini = geminiMessages();
      if (gemini.length > 0) { return gemini; }
    }

    if (googleAiProviderName() === "google-ai-overview") {
      const overview = googleAiOverviewMessages();
      if (overview.length > 0) { return overview; }
    }

    const exact = chatgptMessages();
      if (exact.length > 0) { return exact; }
    }

    const generic = genericMessages();
    return generic.filter((m) => {
      if (m.role !== "unknown") { return true; }
      if (m.text.includes("ChatGPT can make mistakes")) { return false; }
      return !generic.some((x) => x !== m && x.role !== "unknown" && m.text.includes(x.text));
    });
  }

    function conversationId() {
    return location.hostname + location.pathname;
  }

  function normalizeRole(message, index, total) {
  const rawRole = String((message && message.role) || "").toLowerCase();
  const text = String((message && message.text) || "").trim();

  if (rawRole === "user" || rawRole === "assistant" || rawRole === "system" || rawRole === "tool") {
    return rawRole;
  }

  if (index === 0 && total === 1) {
    return "assistant";
  }

  if (index % 2 === 0) {
    return "user";
  }

  if (text.length > 120 || index > 0) {
    return "assistant";
  }

  return "unknown";
}

function normalizeMessage(message, index, providerName) {
  const text = String((message && message.text) || "").trim();

  return {
    schema: "haai.normalized_message.v1",
    provider: providerName || "unknown",
    sequence: index,
    role: normalizeRole(message, index, -1),
    content_text: text,
    content_length: text.length,
    visible: true,
    streamed: false,
    citation_count: (text.match(/⁠|†|\[\d+\]|http/gi) || []).length,
    tool_calls: [],
    reasoning_visible: false
  };
}

function normalizeMessages(messages, providerName) {
  const total = Array.isArray(messages) ? messages.length : [];

  return (messages || []).map((message, index) => {
    const row = normalizeMessage(message, index, providerName);
    row.role = normalizeRole(message, index, total);
    return row;
  });
}

function surface(messages) {
    return {
      detected: provider() !== "unknown" || messages.length > 0 || inputText().length > 0,
      provider: provider(),
      domain: location.hostname,
      url: location.href,
      title: document.title || "",
      conversation_id: conversationId(),
      message_count: messages.length,
      normalized_messages: normalizeMessages(messages, provider()),
      input_detected: inputText().length > 0 || Boolean(document.querySelector("textarea,[contenteditable='true'],div[role='textbox']"))
    };
  }

  function emit(eventType, payload) {
    safeSend({
      type: "haai_record_event",
      event: {
        schema: "haai.extension_event.v1",
        event_type: eventType,
        created_utc: new Date().toISOString(),
        source: "content_script",
        payload: payload
      }
    });
  }

  function scan() {
    const messages = collectMessages();
    const payload = surface(messages);
    const fp = JSON.stringify(messages).slice(-16000);

    if (fp && fp !== lastSnapshot) {
      lastSnapshot = fp;
      payload.messages = messages;
      emit("conversation_snapshot", payload);
    }

    const currentInput = inputText();
    if (currentInput !== lastInputState) {
      lastInputState = currentInput;
      emit("input_surface_changed", {
        detected: payload.detected,
        provider: payload.provider,
        domain: payload.domain,
        url: payload.url,
        title: payload.title,
        message_count: payload.message_count,
        input_detected: payload.input_detected,
        input_length: currentInput.length,
        input_preview: currentInput.slice(0, 500)
      });
    }
  }

  function promptText() {
    const messages = collectMessages();
    const payload = surface(messages);
    const evidence = messages.map((m) => "[" + m.role + "] " + m.text).join("\n\n---\n\n");

    return [
      "HAAI CONTEXT RECOVERY REQUEST",
      "",
      "Reconstruct this AI work session from captured browser evidence.",
      "",
      "Surface:",
      "- provider: " + payload.provider,
      "- domain: " + payload.domain,
      "- title: " + payload.title,
      "- visible messages: " + payload.message_count,
      "- input detected: " + payload.input_detected,
      "",
      "Return:",
      "1. What is being worked on.",
      "2. Recent user instructions.",
      "3. Recent assistant actions.",
      "4. Current blockers.",
      "5. Next step.",
      "6. Confidence and uncertainty.",
      "",
      "Evidence:",
      evidence || "(No visible conversation text found.)"
    ].join("\n");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "haai_probe_page") {
      scan();
      sendResponse({ ok: true, surface: surface(collectMessages()) });
      return true;
    }

    if (message.type === "haai_build_context_prompt") {
      scan();
      sendResponse({ ok: true, prompt: promptText() });
      return true;
    }

    sendResponse({ ok: false, reason: "Unknown content message." });
    return true;
  });

  emit("page_probe", surface(collectMessages()));
  scan();
  setInterval(scan, 2000);
}
