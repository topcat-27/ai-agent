(() => {
  "use strict";

  const DEFAULT_CONFIG = {
    name: "Project Partner",
    subtitle: "A calm co-pilot for turning ideas into next steps.",
    welcomeMessage:
      "Hello! I’m your project partner. Tell me what you’re working on, and we’ll turn it into clear, manageable next steps.",
    primaryColour: "#6D4AFF",
    examplePrompts: [
      "Help me decide the three most important things to do today",
      "Turn my project idea into a one-week action plan",
      "What questions should I answer before I start this project?",
    ],
  };
  const STORAGE_KEY = "ai-solopreneur-chat-session";
  const MESSAGE_LIMIT = 100_000;
  const MAX_UPLOAD_BYTES = 10 * 1_024 * 1_024;
  const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
  const SUPPORTED_LINK_HOSTS = {
    "fathom.video": "/share/",
    "notes.granola.ai": "/t/",
  };

  function supportedLinkIn(text) {
    const trimmed = text.trim();
    if (!/^https:\/\/\S+$/.test(trimmed) || /\s/.test(trimmed)) {
      return null;
    }
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const prefix = SUPPORTED_LINK_HOSTS[url.hostname];
    if (!prefix) {
      return null;
    }
    if (url.hostname === "notes.granola.ai") {
      return /^\/[td]\//.test(url.pathname) ? trimmed : null;
    }
    return url.pathname.startsWith(prefix) ? trimmed : null;
  }

  const elements = {
    agentInitials: document.querySelector("#agent-initials"),
    agentName: document.querySelector("#agent-name"),
    agentSubtitle: document.querySelector("#agent-subtitle"),
    attachButton: document.querySelector("#attach-button"),
    attachmentStatus: document.querySelector("#attachment-status"),
    characterCount: document.querySelector("#character-count"),
    conversation: document.querySelector("#conversation"),
    conversationAgentName: document.querySelector("#conversation-agent-name"),
    fileInput: document.querySelector("#file-input"),
    form: document.querySelector("#chat-form"),
    input: document.querySelector("#message-input"),
    mobileAgentInitials: document.querySelector("#mobile-agent-initials"),
    requestStatus: document.querySelector("#request-status"),
    resetButton: document.querySelector("#reset-button"),
    sendButton: document.querySelector("#send-button"),
    sendButtonLabel: document.querySelector("#send-button-label"),
    suggestionList: document.querySelector("#suggestion-list"),
    suggestions: document.querySelector("#suggestions"),
  };

  let uploadInProgress = false;

  let sessionId = loadOrCreateSession();
  let requestInProgress = false;
  let loadingMessage = null;

  function cleanText(value, fallback, maximumLength) {
    if (typeof value !== "string") {
      return fallback;
    }
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned.slice(0, maximumLength) : fallback;
  }

  function loadConfig() {
    const supplied =
      typeof window.AGENT_CONFIG === "object" && window.AGENT_CONFIG !== null
        ? window.AGENT_CONFIG
        : {};
    const prompts = Array.isArray(supplied.examplePrompts)
      ? supplied.examplePrompts
          .filter((prompt) => typeof prompt === "string" && prompt.trim())
          .slice(0, 6)
          .map((prompt) => prompt.trim().slice(0, 180))
      : DEFAULT_CONFIG.examplePrompts;
    const suppliedColour = cleanText(
      supplied.primaryColour,
      DEFAULT_CONFIG.primaryColour,
      40,
    );

    return {
      name: cleanText(supplied.name, DEFAULT_CONFIG.name, 60),
      subtitle: cleanText(supplied.subtitle, DEFAULT_CONFIG.subtitle, 160),
      welcomeMessage: cleanText(
        supplied.welcomeMessage,
        DEFAULT_CONFIG.welcomeMessage,
        800,
      ),
      primaryColour:
        window.CSS?.supports("color", suppliedColour)
          ? suppliedColour
          : DEFAULT_CONFIG.primaryColour,
      examplePrompts:
        prompts.length > 0 ? prompts : DEFAULT_CONFIG.examplePrompts,
    };
  }

  const config = loadConfig();

  function getInitials(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }

  function createSessionId() {
    return window.crypto.randomUUID();
  }

  function storeSession(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The chat still works when private browsing blocks local storage.
    }
  }

  function loadOrCreateSession() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (
        stored &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          stored,
        )
      ) {
        return stored;
      }
    } catch {
      // Fall through to a fresh session.
    }

    const freshSession = createSessionId();
    storeSession(freshSession);
    return freshSession;
  }

  function applyConfig() {
    document.title = `${config.name} · Local agent`;
    document.documentElement.style.setProperty(
      "--brand-primary",
      config.primaryColour,
    );
    elements.agentName.textContent = config.name;
    elements.agentSubtitle.textContent = config.subtitle;
    elements.conversationAgentName.textContent = config.name;

    const initials = getInitials(config.name);
    elements.agentInitials.textContent = initials;
    elements.mobileAgentInitials.textContent = initials;
    elements.input.setAttribute("aria-label", `Message ${config.name}`);
  }

  function scrollConversation() {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    elements.conversation.scrollTo({
      top: elements.conversation.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  function createAvatar(kind) {
    const avatar = document.createElement("span");
    avatar.className = `message__avatar message__avatar--${kind}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = kind === "agent" ? getInitials(config.name) : "You";
    return avatar;
  }

  // --- Safe Markdown rendering for agent replies -------------------------
  // The reply is untrusted model output. Everything is HTML-escaped first, then
  // only a fixed whitelist of tags is emitted, so no markup in the reply can
  // ever execute. Link hrefs are restricted to http(s)/mailto.
  const CODE_SENTINEL = "";

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(rawUrl) {
    const candidate = rawUrl.replace(/&amp;/g, "&").trim();
    if (/^(https?:\/\/|mailto:)/i.test(candidate) && !/[\s"'<>`]/.test(candidate)) {
      return candidate;
    }
    return null;
  }

  function renderInline(text) {
    let out = escapeHtml(text);

    const codeSpans = [];
    out = out.replace(/`([^`]+)`/g, (_match, code) => {
      codeSpans.push(code);
      return `${CODE_SENTINEL}${codeSpans.length - 1}${CODE_SENTINEL}`;
    });

    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, url) => {
      const href = safeUrl(url);
      if (!href) {
        return label;
      }
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
    });

    out = out
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");

    out = out.replace(
      new RegExp(`${CODE_SENTINEL}(\\d+)${CODE_SENTINEL}`, "g"),
      (_match, index) => `<code>${codeSpans[Number(index)]}</code>`,
    );
    return out;
  }

  function isTableSeparator(line) {
    return line !== undefined && /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && /-/.test(line);
  }

  function markdownToHtml(source) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let i = 0;

    const parseRow = (line) =>
      line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

    while (i < lines.length) {
      const line = lines[i];

      const fence = /^```/.test(line);
      if (fence) {
        const buffer = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buffer.push(lines[i]);
          i += 1;
        }
        i += 1;
        html.push(`<pre><code>${escapeHtml(buffer.join("\n"))}</code></pre>`);
        continue;
      }

      if (/^\s*$/.test(line)) {
        i += 1;
        continue;
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = Math.min(heading[1].length, 6);
        html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
        html.push("<hr />");
        i += 1;
        continue;
      }

      if (line.includes("|") && isTableSeparator(lines[i + 1])) {
        const headers = parseRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
          rows.push(parseRow(lines[i]));
          i += 1;
        }
        let table = `<table><thead><tr>${headers
          .map((cell) => `<th>${renderInline(cell)}</th>`)
          .join("")}</tr></thead>`;
        if (rows.length) {
          table += `<tbody>${rows
            .map(
              (row) =>
                `<tr>${headers
                  .map((_header, index) => `<td>${renderInline(row[index] ?? "")}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}</tbody>`;
        }
        html.push(`${table}</table>`);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
          i += 1;
        }
        html.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i += 1;
        }
        html.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const buffer = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buffer.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        html.push(`<blockquote>${markdownToHtml(buffer.join("\n"))}</blockquote>`);
        continue;
      }

      const paragraph = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^#{1,6}\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !(lines[i].includes("|") && isTableSeparator(lines[i + 1]))
      ) {
        paragraph.push(lines[i]);
        i += 1;
      }
      if (paragraph.length) {
        html.push(`<p>${renderInline(paragraph.join("\n")).replace(/\n/g, "<br />")}</p>`);
      }
    }

    return html.join("\n");
  }

  function addMessage(kind, text) {
    const wrapper = document.createElement("article");
    wrapper.className = `message message--${kind}`;

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = kind === "agent" ? config.name : "You";

    let copy;
    if (kind === "agent") {
      copy = document.createElement("div");
      copy.className = "message__copy message__copy--rich";
      copy.innerHTML = markdownToHtml(text);
    } else {
      copy = document.createElement("p");
      copy.className = "message__copy";
      copy.textContent = text;
    }

    body.append(label, copy);
    wrapper.append(createAvatar(kind), body);
    elements.conversation.append(wrapper);
    scrollConversation();
    return wrapper;
  }

  function addLoadingMessage() {
    const wrapper = document.createElement("article");
    wrapper.className = "message message--agent";

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = config.name;

    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      dots.append(document.createElement("span"));
    }

    const accessibleText = document.createElement("span");
    accessibleText.className = "visually-hidden";
    accessibleText.textContent = `${config.name} is thinking`;

    body.append(label, dots, accessibleText);
    wrapper.append(createAvatar("agent"), body);
    elements.conversation.append(wrapper);
    scrollConversation();
    return wrapper;
  }

  function addError(message, retryMessage) {
    const alert = document.createElement("div");
    alert.className = "chat-error";
    alert.setAttribute("role", "alert");

    const icon = document.createElement("span");
    icon.className = "chat-error__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    const content = document.createElement("div");
    const title = document.createElement("p");
    title.className = "chat-error__title";
    title.textContent = "That didn’t work";
    const detail = document.createElement("p");
    detail.className = "chat-error__detail";
    detail.textContent = message;
    content.append(title, detail);

    if (retryMessage) {
      const retry = document.createElement("button");
      retry.className = "retry-button";
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        alert.remove();
        void sendMessage(retryMessage, false);
      });
      content.append(retry);
    }

    alert.append(icon, content);
    elements.conversation.append(alert);
    scrollConversation();
  }

  function renderSuggestions() {
    elements.suggestionList.replaceChildren();
    for (const prompt of config.examplePrompts) {
      const button = document.createElement("button");
      button.className = "suggestion-button";
      button.type = "button";
      button.textContent = prompt;
      button.addEventListener("click", () => {
        void sendMessage(prompt, true);
      });
      elements.suggestionList.append(button);
    }
  }

  function renderNewConversation() {
    elements.conversation.replaceChildren();
    addMessage("agent", config.welcomeMessage);
    elements.suggestions.hidden = false;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
  }

  function setBusy(isBusy) {
    requestInProgress = isBusy;
    elements.conversation.setAttribute("aria-busy", String(isBusy));
    elements.input.disabled = isBusy;
    elements.sendButton.disabled = isBusy;
    elements.resetButton.disabled = isBusy;
    elements.attachButton.disabled = isBusy || uploadInProgress;
    for (const suggestion of elements.suggestionList.querySelectorAll("button")) {
      suggestion.disabled = isBusy;
    }
    elements.sendButtonLabel.textContent = isBusy ? "Working" : "Send";
    elements.requestStatus.textContent = isBusy
      ? `${config.name} is working on your request…`
      : "Press Enter to send · Shift + Enter for a new line";
  }

  function friendlyError(errorBody) {
    if (
      typeof errorBody === "object" &&
      errorBody !== null &&
      typeof errorBody.error === "object" &&
      errorBody.error !== null &&
      typeof errorBody.error.message === "string"
    ) {
      return errorBody.error.message;
    }
    return "The local agent could not reply. Check that n8n is running, then try again.";
  }

  function setAttachmentStatus(message, kind) {
    if (!message) {
      elements.attachmentStatus.hidden = true;
      elements.attachmentStatus.textContent = "";
      elements.attachmentStatus.className = "attachment-status";
      return;
    }
    elements.attachmentStatus.hidden = false;
    elements.attachmentStatus.textContent = message;
    elements.attachmentStatus.className = `attachment-status attachment-status--${kind}`;
  }

  function extensionOf(name) {
    const match = /\.[^.]+$/.exec(name.toLowerCase());
    return match ? match[0] : "";
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read-failed"));
      reader.onload = () => {
        const result = String(reader.result);
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(file);
    });
  }

  function insertTranscript(sourceLabel, data) {
    const existing = elements.input.value.trim();
    const separator = existing ? "\n\n" : "";
    elements.input.value = `${existing}${separator}${data.text}`;
    updateCharacterCount();
    resizeInput();
    elements.input.focus();

    const over = elements.input.value.length > MESSAGE_LIMIT;
    const parts = [
      `Added transcript from ${sourceLabel} (${data.characters.toLocaleString()} characters).`,
    ];
    if (data.truncated) {
      parts.push("It was long, so it was shortened.");
    }
    if (over) {
      parts.push(
        `Keep messages under ${MESSAGE_LIMIT.toLocaleString()} characters — trim it before sending.`,
      );
    } else {
      parts.push("Review it, add any instruction, then send.");
    }
    setAttachmentStatus(parts.join(" "), over ? "error" : "success");
  }

  async function handleFileSelection(file) {
    if (!file || requestInProgress || uploadInProgress) {
      return;
    }

    if (!SUPPORTED_EXTENSIONS.includes(extensionOf(file.name))) {
      setAttachmentStatus(
        "That file type is not supported. Choose a PDF, Word (.docx), text, or Markdown file.",
        "error",
      );
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setAttachmentStatus("That file is too large. Choose a file under 10 MB.", "error");
      return;
    }

    uploadInProgress = true;
    elements.attachButton.disabled = true;
    setAttachmentStatus(`Reading “${file.name}”…`, "working");

    try {
      const dataBase64 = await readFileAsBase64(file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, dataBase64 }),
      });

      let responseBody = null;
      try {
        responseBody = await response.json();
      } catch {
        // A stable fallback is shown below.
      }

      if (!response.ok) {
        throw new Error(friendlyError(responseBody));
      }
      if (
        typeof responseBody !== "object" ||
        responseBody === null ||
        typeof responseBody.text !== "string" ||
        !responseBody.text.trim()
      ) {
        throw new Error("We couldn't read text from that file. Try a different file.");
      }

      insertTranscript(`“${file.name}”`, responseBody);
    } catch (error) {
      const messageText =
        error instanceof Error && error.message
          ? error.message
          : "We couldn't read that file. Try a different file.";
      setAttachmentStatus(messageText, "error");
    } finally {
      uploadInProgress = false;
      elements.attachButton.disabled = requestInProgress;
      elements.fileInput.value = "";
    }
  }

  async function handleLink(linkUrl) {
    if (requestInProgress || uploadInProgress) {
      return;
    }

    uploadInProgress = true;
    elements.attachButton.disabled = true;
    setAttachmentStatus("Fetching the transcript from that link…", "working");

    try {
      const response = await fetch("/api/ingest-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl }),
      });

      let responseBody = null;
      try {
        responseBody = await response.json();
      } catch {
        // A stable fallback is shown below.
      }

      if (!response.ok) {
        throw new Error(friendlyError(responseBody));
      }
      if (
        typeof responseBody !== "object" ||
        responseBody === null ||
        typeof responseBody.text !== "string" ||
        !responseBody.text.trim()
      ) {
        throw new Error("We couldn't read a transcript from that link. Try another link.");
      }

      const label =
        responseBody.source === "granola" ? "Granola notes" : "Fathom recording";
      const title =
        typeof responseBody.title === "string" && responseBody.title.trim()
          ? `${label} — “${responseBody.title.trim()}”`
          : label;
      insertTranscript(title, responseBody);
    } catch (error) {
      const messageText =
        error instanceof Error && error.message
          ? error.message
          : "We couldn't get the transcript from that link. Try again.";
      setAttachmentStatus(messageText, "error");
    } finally {
      uploadInProgress = false;
      elements.attachButton.disabled = requestInProgress;
    }
  }

  async function sendMessage(rawMessage, showUserMessage) {
    if (requestInProgress) {
      return;
    }

    const message = rawMessage.trim();
    if (!message) {
      elements.input.focus();
      return;
    }

    if (showUserMessage) {
      addMessage("user", message);
    }
    elements.suggestions.hidden = true;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
    setBusy(true);
    loadingMessage = addLoadingMessage();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });

      let responseBody = null;
      try {
        responseBody = await response.json();
      } catch {
        // A stable fallback is shown below.
      }

      if (!response.ok) {
        throw new Error(friendlyError(responseBody));
      }
      if (
        typeof responseBody !== "object" ||
        responseBody === null ||
        responseBody.sessionId !== sessionId ||
        typeof responseBody.reply !== "string" ||
        !responseBody.reply.trim()
      ) {
        throw new Error(
          "The agent returned an unexpected response. Check the workflow and try again.",
        );
      }

      loadingMessage.remove();
      loadingMessage = null;
      addMessage("agent", responseBody.reply.trim());
    } catch (error) {
      loadingMessage?.remove();
      loadingMessage = null;
      const messageText =
        error instanceof Error
          ? error.message
          : "The local agent could not reply. Check n8n and try again.";
      addError(messageText, message);
    } finally {
      setBusy(false);
      elements.input.focus();
    }
  }

  function updateCharacterCount() {
    const length = elements.input.value.length;
    elements.characterCount.textContent = `${length.toLocaleString()} / ${MESSAGE_LIMIT.toLocaleString()}`;
    elements.characterCount.classList.toggle(
      "character-count--near-limit",
      length >= MESSAGE_LIMIT * 0.9,
    );
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 160)}px`;
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const link = supportedLinkIn(elements.input.value);
    if (link) {
      elements.input.value = "";
      updateCharacterCount();
      resizeInput();
      void handleLink(link);
      return;
    }
    void sendMessage(elements.input.value, true);
  });

  elements.input.addEventListener("input", () => {
    updateCharacterCount();
    resizeInput();
  });

  elements.input.addEventListener("paste", (event) => {
    if (requestInProgress || uploadInProgress) {
      return;
    }
    const pasted = event.clipboardData
      ? event.clipboardData.getData("text")
      : "";
    const link = supportedLinkIn(pasted);
    if (link) {
      event.preventDefault();
      void handleLink(link);
    }
  });

  elements.input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });

  elements.resetButton.addEventListener("click", () => {
    sessionId = createSessionId();
    storeSession(sessionId);
    renderNewConversation();
    setAttachmentStatus(null);
    elements.requestStatus.textContent = "New conversation started";
    elements.input.focus();
  });

  elements.attachButton.addEventListener("click", () => {
    if (!requestInProgress && !uploadInProgress) {
      elements.fileInput.click();
    }
  });

  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files && elements.fileInput.files[0];
    if (file) {
      void handleFileSelection(file);
    }
  });

  const dropZone = document.querySelector(".chat-card");
  if (dropZone) {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    dropZone.addEventListener("dragenter", (event) => {
      stop(event);
      if (!requestInProgress && !uploadInProgress) {
        dropZone.classList.add("chat-card--dragover");
      }
    });
    dropZone.addEventListener("dragover", stop);
    dropZone.addEventListener("dragleave", (event) => {
      if (event.target === dropZone) {
        dropZone.classList.remove("chat-card--dragover");
      }
    });
    dropZone.addEventListener("drop", (event) => {
      stop(event);
      dropZone.classList.remove("chat-card--dragover");
      const file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) {
        void handleFileSelection(file);
      }
    });
  }

  applyConfig();
  renderSuggestions();
  renderNewConversation();
})();
