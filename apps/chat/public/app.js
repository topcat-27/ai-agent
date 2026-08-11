(() => {
  "use strict";

  const DEFAULT_CONFIG = {
    name: "Project Manager",
    subtitle:
      "Turn meetings, documents, and project ideas into clear next actions.",
    welcomeMessage:
      "Hello! I’m your Project Manager. Add a meeting transcript or tell me what you’re working on, and I’ll help turn it into decisions, plans, and safe next actions.",
    primaryColour: "#6D4AFF",
    examplePrompts: [
      "Turn these meeting notes into decisions and action items",
      "Build a practical project plan from this document",
      "Show me the highest-priority work in my local project",
    ],
  };
  const DEFAULT_AGENTS = [
    {
      id: "project-manager",
      name: "Project Manager",
      description:
        "Plans projects, analyses meetings, and turns decisions into safe next actions.",
      status: "active",
      examplePrompts: DEFAULT_CONFIG.examplePrompts,
    },
    {
      id: "sales",
      name: "Sales",
      description: "Sales research, preparation, and follow-up workflows.",
      status: "coming-soon",
      examplePrompts: [],
    },
    {
      id: "marketing",
      name: "Marketing",
      description: "Campaign planning, content, and marketing operations.",
      status: "coming-soon",
      examplePrompts: [],
    },
    {
      id: "investment",
      name: "Investment",
      description: "Investment research, analysis, and decision preparation.",
      status: "coming-soon",
      examplePrompts: [],
    },
    {
      id: "bookkeeping",
      name: "Bookkeeping",
      description: "Bookkeeping preparation, review, and reconciliation support.",
      status: "coming-soon",
      examplePrompts: [],
    },
  ];
  const STORAGE_KEY = "ai-solopreneur-chat-session";
  const MAX_DOCUMENTS = 3;
  const LARGE_PASTE_THRESHOLD = 4_000;

  const elements = {
    agentPanel: document.querySelector(".agent-panel"),
    agentInitials: document.querySelector("#agent-initials"),
    agentList: document.querySelector("#agent-list"),
    agentName: document.querySelector("#agent-name"),
    agentSubtitle: document.querySelector("#agent-subtitle"),
    attachmentMenu: document.querySelector("#attachment-menu"),
    attachmentMenuButton: document.querySelector("#attachment-menu-button"),
    characterCount: document.querySelector("#character-count"),
    conversation: document.querySelector("#conversation"),
    conversationAgentName: document.querySelector("#conversation-agent-name"),
    conversationTitleText: document.querySelector("#conversation-title-text"),
    documentList: document.querySelector("#document-list"),
    documentStatus: document.querySelector("#document-status"),
    fileInput: document.querySelector("#file-input"),
    form: document.querySelector("#chat-form"),
    historyButton: document.querySelector("#history-button"),
    historyClose: document.querySelector("#history-close"),
    historyList: document.querySelector("#history-list"),
    historyMore: document.querySelector("#history-more"),
    historyNew: document.querySelector("#history-new"),
    historySearchForm: document.querySelector("#history-search-form"),
    historySearchInput: document.querySelector("#history-search-input"),
    historyStatus: document.querySelector("#history-status"),
    input: document.querySelector("#message-input"),
    mobileAgentInitials: document.querySelector("#mobile-agent-initials"),
    pasteButton: document.querySelector("#paste-button"),
    pasteCancel: document.querySelector("#paste-cancel"),
    pasteDialog: document.querySelector("#paste-dialog"),
    pastedName: document.querySelector("#pasted-name"),
    pastedText: document.querySelector("#pasted-text"),
    pasteForm: document.querySelector("#paste-form"),
    requestStatus: document.querySelector("#request-status"),
    resetButton: document.querySelector("#reset-button"),
    sendButton: document.querySelector("#send-button"),
    sendButtonLabel: document.querySelector("#send-button-label"),
    suggestionList: document.querySelector("#suggestion-list"),
    suggestions: document.querySelector("#suggestions"),
    uploadButton: document.querySelector("#upload-button"),
  };

  let sessionId = loadOrCreateSession();
  let requestInProgress = false;
  let documentRequestInProgress = false;
  let loadingMessage = null;
  let agents = DEFAULT_AGENTS;
  let activeAgentId = "project-manager";
  let uploadedDocuments = [];
  let sessionDocuments = [];
  let conversations = [];
  let nextConversationCursor = null;
  let currentMessages = [];
  let nextMessageBefore = null;
  let activeConversationTitle = "New conversation";
  let pendingRefreshTimer = null;
  const narrowLayout = window.matchMedia("(max-width: 50rem)");

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
      subtitle: cleanText(
        supplied.subtitle,
        DEFAULT_CONFIG.subtitle,
        160,
      ),
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

  function activeAgent() {
    return (
      agents.find(
        (agent) => agent.id === activeAgentId && agent.status === "active",
      ) ?? agents.find((agent) => agent.status === "active")
    );
  }

  function displayAgentName() {
    return activeAgentId === "project-manager"
      ? config.name
      : activeAgent()?.name ?? config.name;
  }

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

  function applyAgentIdentity() {
    const name = displayAgentName();
    const description =
      activeAgentId === "project-manager"
        ? config.subtitle
        : activeAgent()?.description ?? config.subtitle;
    document.title = `${name} · Local agent`;
    document.documentElement.style.setProperty(
      "--brand-primary",
      config.primaryColour,
    );
    elements.agentName.textContent = name;
    elements.agentSubtitle.textContent = description;
    elements.conversationAgentName.textContent = name;
    elements.conversationTitleText.textContent = activeConversationTitle;
    elements.input.setAttribute("aria-label", `Message ${name}`);
    elements.input.placeholder = `What should the ${name} do?`;

    // The PitchUp logo is rendered as an <img> in the markup, so the initials
    // are intentionally not written over it here.
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
    if (kind === "agent") {
      const logo = document.createElement("img");
      logo.className = "brand__logo";
      logo.src = "/logo.svg";
      logo.alt = "";
      avatar.append(logo);
    } else {
      avatar.textContent = "You";
    }
    return avatar;
  }

  function documentMetadata(documentItem) {
    const pageText =
      typeof documentItem.pageCount === "number"
        ? ` · ${documentItem.pageCount} pages`
        : "";
    const expiryText = documentItem.expired ? " · Expired" : "";
    return `${documentItem.wordCount.toLocaleString()} words${pageText}${expiryText}`;
  }

  function documentTypeLabel(documentItem) {
    if (documentItem.type === "pasted-text") {
      return "TEXT";
    }
    return String(documentItem.type || "FILE").toUpperCase().slice(0, 5);
  }

  function createSentAttachment(documentItem) {
    const attachment = document.createElement("div");
    attachment.className = "sent-attachment";
    attachment.classList.toggle(
      "sent-attachment--expired",
      documentItem.expired === true,
    );
    attachment.setAttribute(
      "aria-label",
      `Attached ${documentItem.name}, ${documentMetadata(documentItem)}`,
    );

    const preview = document.createElement("span");
    preview.className = `sent-attachment__preview sent-attachment__preview--${documentItem.type}`;
    preview.setAttribute("aria-hidden", "true");

    const pageFold = document.createElement("span");
    pageFold.className = "sent-attachment__fold";

    const previewLines = document.createElement("span");
    previewLines.className = "sent-attachment__lines";
    for (let index = 0; index < 3; index += 1) {
      previewLines.append(document.createElement("span"));
    }

    const type = document.createElement("span");
    type.className = "sent-attachment__type";
    type.textContent = documentTypeLabel(documentItem);
    preview.append(pageFold, previewLines, type);

    const details = document.createElement("span");
    details.className = "sent-attachment__details";

    const name = document.createElement("span");
    name.className = "sent-attachment__name";
    name.textContent = documentItem.name;
    name.title = documentItem.name;

    const metadata = document.createElement("span");
    metadata.className = "sent-attachment__meta";
    metadata.textContent = documentMetadata(documentItem);

    details.append(name, metadata);
    attachment.append(preview, details);
    return attachment;
  }

  // --- PitchUp: meeting-link ingest and Asana capture --------------------
  const SUPPORTED_LINK_HOSTS = {
    "fathom.video": "/share/",
    "notes.granola.ai": "/t/",
  };
  let asanaMetaPromise = null;
  let linkIngestInProgress = false;

  function supportedLinkIn(text) {
    const trimmed = String(text ?? "").trim();
    if (!/^https:\/\/\S+$/.test(trimmed) || /\s/.test(trimmed)) {
      return null;
    }
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    const prefix = SUPPORTED_LINK_HOSTS[parsed.hostname];
    if (!prefix) {
      return null;
    }
    if (parsed.hostname === "notes.granola.ai") {
      return /^\/[td]\//.test(parsed.pathname) ? trimmed : null;
    }
    return parsed.pathname.startsWith(prefix) ? trimmed : null;
  }

  function linkStatusElement() {
    let status = document.querySelector("#link-status");
    if (!status) {
      status = document.createElement("p");
      status.id = "link-status";
      status.className = "attachment-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      elements.form.parentNode.insertBefore(status, elements.form);
    }
    return status;
  }

  function setLinkStatus(message, kind) {
    const status = linkStatusElement();
    if (!message) {
      status.hidden = true;
      status.textContent = "";
      return;
    }
    status.hidden = false;
    status.textContent = message;
    status.className = `attachment-status attachment-status--${kind}`;
  }

  async function handleMeetingLink(linkUrl) {
    if (linkIngestInProgress) {
      return;
    }
    linkIngestInProgress = true;
    setLinkStatus("Fetching the transcript from that link…", "working");
    try {
      const response = await fetch("/api/ingest-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(friendlyError(body));
      }
      if (typeof body?.text !== "string" || !body.text.trim()) {
        throw new Error("We couldn't read a transcript from that link.");
      }
      const existing = elements.input.value.trim();
      elements.input.value = `${existing}${existing ? "\n\n" : ""}${body.text}`;
      elements.input.dispatchEvent(new Event("input", { bubbles: true }));
      elements.input.focus();
      const label = body.source === "granola" ? "Granola notes" : "Fathom recording";
      const title = body.title ? `${label} — “${body.title}”` : label;
      setLinkStatus(
        `Added transcript from ${title} (${Number(body.characters).toLocaleString()} characters). Review it, add any instruction, then send.`,
        "success",
      );
    } catch (error) {
      setLinkStatus(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't get the transcript from that link.",
        "error",
      );
    } finally {
      linkIngestInProgress = false;
    }
  }

  function loadAsanaMeta() {
    if (!asanaMetaPromise) {
      asanaMetaPromise = fetch("/api/asana/meta")
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(friendlyError(body));
          }
          return {
            projects: Array.isArray(body?.projects) ? body.projects : [],
            members: Array.isArray(body?.members) ? body.members : [],
            defaultProjectGid: body?.defaultProjectGid ?? "",
          };
        })
        .catch((error) => {
          asanaMetaPromise = null;
          throw error;
        });
    }
    return asanaMetaPromise;
  }

  function extractAsanaProposal(text) {
    const fence = /```asana-tasks\s*\n([\s\S]*?)```/;
    const match = fence.exec(text);
    if (!match) {
      return { proposal: null, prose: text };
    }
    let proposal = null;
    try {
      const parsed = JSON.parse(match[1]);
      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      if (tasks.length > 0) {
        proposal = {
          meetingTitle:
            typeof parsed.meetingTitle === "string" ? parsed.meetingTitle.trim() : "",
          tasks: tasks
            .filter((task) => task && typeof task.title === "string" && task.title.trim())
            .slice(0, 50)
            .map((task) => ({
              title: String(task.title).trim(),
              notes: typeof task.notes === "string" ? task.notes.trim() : "",
              assigneeName:
                typeof task.assigneeName === "string" ? task.assigneeName.trim() : "",
              dueOn:
                typeof task.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueOn.trim())
                  ? task.dueOn.trim()
                  : "",
            })),
        };
      }
    } catch {
      proposal = null;
    }
    return { proposal, prose: text.replace(fence, "").trim() };
  }

  /** Only matches an unambiguous workspace member; never guesses an owner. */
  function matchMember(name, members) {
    const wanted = String(name ?? "").trim().toLowerCase();
    if (!wanted) {
      return "";
    }
    const exact = members.filter((m) => m.name.trim().toLowerCase() === wanted);
    if (exact.length === 1) {
      return exact[0].gid;
    }
    const firstWord = wanted.split(/\s+/)[0];
    const byFirstName = members.filter((m) => {
      const memberFirst = m.name.trim().toLowerCase().split(/\s+/)[0];
      const emailLocal = (m.email || "").split("@")[0].toLowerCase();
      return memberFirst === firstWord || emailLocal.startsWith(`${firstWord}.`);
    });
    return byFirstName.length === 1 ? byFirstName[0].gid : "";
  }

  function asanaLabelled(labelText, control) {
    const wrap = document.createElement("label");
    wrap.className = "asana-field";
    const span = document.createElement("span");
    span.className = "asana-field__label";
    span.textContent = labelText;
    wrap.append(span, control);
    return wrap;
  }

  function asanaSelect(optionList, selectedValue, placeholder) {
    const select = document.createElement("select");
    select.className = "asana-input";
    if (placeholder !== undefined) {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = placeholder;
      select.append(blank);
    }
    for (const option of optionList) {
      const element = document.createElement("option");
      element.value = option.gid;
      element.textContent = option.name;
      if (option.gid === selectedValue) {
        element.selected = true;
      }
      select.append(element);
    }
    return select;
  }

  function renderAsanaPanel(proposal) {
    const panel = document.createElement("section");
    panel.className = "asana-panel";
    panel.setAttribute("aria-label", "Review tasks before pushing to Asana");

    const heading = document.createElement("p");
    heading.className = "asana-panel__title";
    heading.textContent = `Review ${proposal.tasks.length} task${proposal.tasks.length === 1 ? "" : "s"} before pushing to Asana`;

    const status = document.createElement("p");
    status.className = "asana-panel__status";
    status.textContent = "Loading your Asana projects…";

    const controls = document.createElement("div");
    controls.className = "asana-controls";
    const list = document.createElement("div");
    list.className = "asana-list";
    const footer = document.createElement("div");
    footer.className = "asana-panel__footer";
    const pushButton = document.createElement("button");
    pushButton.type = "button";
    pushButton.className = "asana-push";
    pushButton.textContent = "Push to Asana";
    pushButton.disabled = true;
    footer.append(pushButton);

    panel.append(heading, status, controls, list, footer);

    loadAsanaMeta()
      .then((meta) => {
        status.hidden = true;

        const projectSelect = asanaSelect(meta.projects, meta.defaultProjectGid);
        const structureSelect = document.createElement("select");
        structureSelect.className = "asana-input";
        for (const option of [
          { value: "flat", label: "Separate tasks" },
          { value: "grouped", label: "Subtasks under one parent" },
        ]) {
          const element = document.createElement("option");
          element.value = option.value;
          element.textContent = option.label;
          structureSelect.append(element);
        }
        controls.append(
          asanaLabelled("Project", projectSelect),
          asanaLabelled("Structure", structureSelect),
        );

        const rows = proposal.tasks.map((task) => {
          const card = document.createElement("div");
          card.className = "asana-card";

          const include = document.createElement("input");
          include.type = "checkbox";
          include.checked = true;
          include.className = "asana-card__include";
          include.setAttribute("aria-label", `Include "${task.title}"`);

          const title = document.createElement("input");
          title.type = "text";
          title.className = "asana-input asana-input--title";
          title.value = task.title;

          const notes = document.createElement("textarea");
          notes.className = "asana-input asana-input--notes";
          notes.rows = 2;
          notes.value = task.notes;

          const assignee = asanaSelect(
            meta.members,
            matchMember(task.assigneeName, meta.members),
            "Unassigned",
          );

          const due = document.createElement("input");
          due.type = "date";
          due.className = "asana-input";
          due.value = task.dueOn;

          const meta2 = document.createElement("div");
          meta2.className = "asana-card__meta";
          meta2.append(asanaLabelled("Assignee", assignee), asanaLabelled("Due date", due));

          const cardBody = document.createElement("div");
          cardBody.className = "asana-card__body";
          cardBody.append(title, notes, meta2);

          card.append(include, cardBody);
          list.append(card);
          return { include, title, notes, assignee, due };
        });

        const refreshButton = () => {
          const selected = rows.filter((row) => row.include.checked).length;
          pushButton.disabled = selected === 0;
          pushButton.textContent =
            selected === 0 ? "Select a task" : `Push ${selected} to Asana`;
        };
        for (const row of rows) {
          row.include.addEventListener("change", refreshButton);
        }
        refreshButton();

        pushButton.addEventListener("click", async () => {
          const selected = rows.filter((row) => row.include.checked);
          if (selected.length === 0) {
            return;
          }
          pushButton.disabled = true;
          pushButton.textContent = "Pushing…";
          status.hidden = false;
          status.className = "asana-panel__status";
          status.textContent = "Creating tasks in Asana…";
          try {
            const response = await fetch("/api/asana/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: structureSelect.value,
                projectGid: projectSelect.value,
                meetingTitle: proposal.meetingTitle,
                tasks: selected.map((row) => ({
                  title: row.title.value,
                  notes: row.notes.value,
                  assigneeGid: row.assignee.value,
                  dueOn: row.due.value,
                })),
              }),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(friendlyError(body));
            }
            const created = Array.isArray(body?.created) ? body.created : [];
            controls.remove();
            list.remove();
            footer.remove();
            status.className = "asana-panel__status asana-panel__status--success";
            status.textContent = body?.parent?.gid
              ? `Created ${created.length} subtask${created.length === 1 ? "" : "s"} under “${body.parent.name}” in Asana.`
              : `Created ${created.length} task${created.length === 1 ? "" : "s"} in Asana.`;
            const links = document.createElement("ul");
            links.className = "asana-results";
            for (const task of body?.parent?.gid ? [body.parent, ...created] : created) {
              const item = document.createElement("li");
              if (task.url) {
                const anchor = document.createElement("a");
                anchor.href = task.url;
                anchor.target = "_blank";
                anchor.rel = "noopener noreferrer";
                anchor.textContent = task.name || "View task";
                item.append(anchor);
              } else {
                item.textContent = task.name || "Task created";
              }
              links.append(item);
            }
            panel.append(links);
            scrollConversation();
          } catch (error) {
            status.hidden = false;
            status.className = "asana-panel__status asana-panel__status--error";
            status.textContent =
              error instanceof Error && error.message
                ? error.message
                : "Could not push those tasks. Try again.";
            refreshButton();
          }
        });
        scrollConversation();
      })
      .catch((error) => {
        status.className = "asana-panel__status asana-panel__status--error";
        status.textContent =
          error instanceof Error && error.message
            ? error.message
            : "Could not load your Asana projects.";
      });

    return panel;
  }

  // --- PitchUp: safe Markdown rendering for agent replies ----------------
  // The reply is untrusted model output. Everything is HTML-escaped first, then
  // only a fixed whitelist of tags is emitted, so nothing in a reply executes.
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
    out = out.replace(/`([^`]+)`/g, (_m, code) => {
      codeSpans.push(code);
      return `${CODE_SENTINEL}${codeSpans.length - 1}${CODE_SENTINEL}`;
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, rawUrl) => {
      const href = safeUrl(rawUrl);
      return href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`
        : label;
    });
    out = out
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
    return out.replace(
      new RegExp(`${CODE_SENTINEL}(\\d+)${CODE_SENTINEL}`, "g"),
      (_m, index) => `<code>${codeSpans[Number(index)]}</code>`,
    );
  }

  function isTableSeparator(line) {
    return line !== undefined && /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && /-/.test(line);
  }

  function markdownToHtml(source) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let i = 0;
    const parseRow = (line) =>
      line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const buffer = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) { buffer.push(lines[i]); i += 1; }
        i += 1;
        html.push(`<pre><code>${escapeHtml(buffer.join("\n"))}</code></pre>`);
        continue;
      }
      if (/^\s*$/.test(line)) { i += 1; continue; }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = Math.min(heading[1].length, 6);
        html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
        i += 1;
        continue;
      }
      if (/^\s*([-*_])\1\1+\s*$/.test(line)) { html.push("<hr />"); i += 1; continue; }

      if (line.includes("|") && isTableSeparator(lines[i + 1])) {
        const headers = parseRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
          rows.push(parseRow(lines[i]));
          i += 1;
        }
        let table = `<table><thead><tr>${headers.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`;
        if (rows.length) {
          table += `<tbody>${rows
            .map((row) => `<tr>${headers.map((_h, index) => `<td>${renderInline(row[index] ?? "")}</td>`).join("")}</tr>`)
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
        html.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i += 1;
        }
        html.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ol>`);
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

  function addMessage(kind, text, attachments = [], options = {}) {
    const wrapper = document.createElement("article");
    wrapper.className = `message message--${kind}`;
    if (["pending", "failed", "interrupted"].includes(options.status)) {
      wrapper.classList.add(`message--${options.status}`);
    }
    if (options.id) {
      wrapper.dataset.messageId = options.id;
    }

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = kind === "agent" ? displayAgentName() : "You";

    let copy;
    let asanaProposal = null;
    if (kind === "agent") {
      const extracted = extractAsanaProposal(text);
      asanaProposal = extracted.proposal;
      copy = document.createElement("div");
      copy.className = "message__copy message__copy--rich";
      copy.innerHTML = markdownToHtml(
        extracted.prose || "Here are the tasks I found. Review them before pushing.",
      );
    } else {
      copy = document.createElement("p");
      copy.className = "message__copy";
      copy.textContent = text;
    }

    body.append(label);
    if (kind === "user" && attachments.length > 0) {
      const attachmentList = document.createElement("div");
      attachmentList.className = "message__attachments";
      attachmentList.setAttribute("aria-label", "Sent attachments");
      for (const documentItem of attachments) {
        attachmentList.append(createSentAttachment(documentItem));
      }
      body.append(attachmentList);
    }
    body.append(copy);
    if (["pending", "failed", "interrupted"].includes(options.status)) {
      const status = document.createElement("p");
      status.className = "message__status";
      status.textContent =
        options.status === "pending"
          ? "Reply in progress…"
          : options.status === "interrupted"
          ? "Reply interrupted — send this again as a new message."
          : "Reply failed — send this again to retry.";
      body.append(status);
    }
    if (asanaProposal) {
      body.append(renderAsanaPanel(asanaProposal));
    }
    wrapper.append(createAvatar(kind), body);
    elements.conversation.append(wrapper);
    if (options.scroll !== false) {
      scrollConversation();
    }
    return wrapper;
  }

  function addLoadingMessage() {
    const wrapper = document.createElement("article");
    wrapper.className = "message message--agent";

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = displayAgentName();

    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      dots.append(document.createElement("span"));
    }

    const accessibleText = document.createElement("span");
    accessibleText.className = "visually-hidden";
    accessibleText.textContent = `${displayAgentName()} is thinking`;

    body.append(label, dots, accessibleText);
    wrapper.append(createAvatar("agent"), body);
    elements.conversation.append(wrapper);
    scrollConversation();
    return wrapper;
  }

  function addError(message, retryRequest) {
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

    if (retryRequest) {
      const retry = document.createElement("button");
      retry.className = "retry-button";
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        alert.remove();
        void sendMessage(retryRequest.message, true, retryRequest.documents);
      });
      content.append(retry);
    }

    alert.append(icon, content);
    elements.conversation.append(alert);
    scrollConversation();
  }

  function friendlyError(errorBody, fallback) {
    if (
      typeof errorBody === "object" &&
      errorBody !== null &&
      typeof errorBody.error === "object" &&
      errorBody.error !== null &&
      typeof errorBody.error.message === "string"
    ) {
      return errorBody.error.message;
    }
    return fallback;
  }

  async function parseResponse(response, fallback) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Use the stable fallback below.
    }
    if (!response.ok) {
      throw new Error(friendlyError(body, fallback));
    }
    return body;
  }

  async function loadAgents() {
    try {
      const response = await fetch("/api/agents", {
        headers: { Accept: "application/json" },
      });
      const body = await parseResponse(
        response,
        "The local agent list could not be loaded.",
      );
      if (
        body &&
        Array.isArray(body.agents) &&
        body.agents.some((agent) => agent?.status === "active")
      ) {
        agents = body.agents;
        activeAgentId =
          agents.find((agent) => agent.id === activeAgentId)?.status === "active"
            ? activeAgentId
            : agents.find((agent) => agent.status === "active").id;
      }
    } catch {
      agents = DEFAULT_AGENTS;
    }
  }

  function relativeTime(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      return "Saved locally";
    }
    const seconds = Math.round((timestamp - Date.now()) / 1_000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (Math.abs(seconds) < 60) {
      return formatter.format(seconds, "second");
    }
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) {
      return formatter.format(minutes, "minute");
    }
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) {
      return formatter.format(hours, "hour");
    }
    return formatter.format(Math.round(hours / 24), "day");
  }

  function syncHistoryPanelAccess() {
    elements.agentPanel.inert =
      narrowLayout.matches &&
      !elements.agentPanel.classList.contains("agent-panel--open");
  }

  function setHistoryOpen(isOpen) {
    elements.agentPanel.classList.toggle("agent-panel--open", isOpen);
    elements.historyButton.setAttribute("aria-expanded", String(isOpen));
    syncHistoryPanelAccess();
    if (isOpen) {
      elements.historySearchInput.focus();
    } else if (document.activeElement === elements.historyClose) {
      elements.historyButton.focus();
    }
  }

  function renderHistoryList(items = conversations, isSearch = false) {
    elements.historyList.replaceChildren();
    if (items.length === 0) {
      elements.historyStatus.textContent = isSearch
        ? "No saved chats match that search."
        : "No saved chats yet.";
      return;
    }
    elements.historyStatus.textContent = isSearch
      ? `${items.length} matching message${items.length === 1 ? "" : "s"}`
      : "Saved on this computer";
    for (const item of items) {
      if (isSearch) {
        const result = document.createElement("button");
        result.className = "history-result";
        result.type = "button";

        const title = document.createElement("span");
        title.className = "history-result__title";
        title.textContent = item.conversationTitle;
        const snippet = document.createElement("span");
        snippet.className = "history-result__snippet";
        snippet.textContent = item.snippet;
        result.append(title, snippet);
        result.addEventListener("click", () => {
          void loadConversation(item.conversationId, item.messageId);
        });
        elements.historyList.append(result);
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "history-item";
      wrapper.classList.toggle("history-item--active", item.id === sessionId);
      wrapper.setAttribute("role", "listitem");

      const open = document.createElement("button");
      open.className = "history-item__open";
      open.type = "button";
      open.setAttribute("aria-current", item.id === sessionId ? "true" : "false");
      const title = document.createElement("span");
      title.className = "history-item__title";
      title.textContent = item.title;
      const meta = document.createElement("span");
      meta.className = "history-item__meta";
      meta.textContent = `${relativeTime(item.updatedAt)} · ${item.messageCount} message${item.messageCount === 1 ? "" : "s"}`;
      open.append(title, meta);
      open.addEventListener("click", () => {
        void loadConversation(item.id);
      });

      const actions = document.createElement("span");
      actions.className = "history-item__actions";
      const rename = document.createElement("button");
      rename.className = "history-item__action";
      rename.type = "button";
      rename.textContent = "✎";
      rename.setAttribute("aria-label", `Rename ${item.title}`);
      rename.addEventListener("click", () => {
        void renameConversation(item);
      });
      const remove = document.createElement("button");
      remove.className = "history-item__action";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${item.title}`);
      remove.addEventListener("click", () => {
        void deleteConversation(item);
      });
      actions.append(rename, remove);
      wrapper.append(open, actions);
      elements.historyList.append(wrapper);
    }
  }

  async function loadConversationList({ append = false } = {}) {
    const cursor = append && nextConversationCursor
      ? `&cursor=${encodeURIComponent(nextConversationCursor)}`
      : "";
    const response = await fetch(`/api/conversations?limit=50${cursor}`, {
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse(response, "Saved chats could not be loaded.");
    const received = Array.isArray(body?.conversations) ? body.conversations : [];
    conversations = append ? [...conversations, ...received] : received;
    nextConversationCursor = body?.nextCursor ?? null;
    elements.historyMore.hidden = !nextConversationCursor;
    renderHistoryList();
    return conversations;
  }

  function discardPendingDocuments(previousSessionId) {
    const documents = sessionDocuments;
    uploadedDocuments = [];
    sessionDocuments = [];
    renderDocuments();
    for (const documentItem of documents) {
      void fetch(
        `/api/documents/${encodeURIComponent(documentItem.id)}?sessionId=${encodeURIComponent(previousSessionId)}`,
        { method: "DELETE" },
      );
    }
  }

  function renderStoredConversation(targetMessageId) {
    if (pendingRefreshTimer !== null) {
      window.clearTimeout(pendingRefreshTimer);
      pendingRefreshTimer = null;
    }
    elements.conversation.replaceChildren();
    if (nextMessageBefore) {
      const older = document.createElement("button");
      older.className = "load-older";
      older.type = "button";
      older.textContent = "Load earlier messages";
      older.addEventListener("click", () => {
        void loadOlderMessages();
      });
      elements.conversation.append(older);
    }
    if (currentMessages.length === 0) {
      addMessage("agent", config.welcomeMessage, [], { scroll: false });
      elements.suggestions.hidden = false;
    } else {
      elements.suggestions.hidden = true;
      for (const message of currentMessages) {
        addMessage(
          message.role === "assistant" ? "agent" : "user",
          message.content,
          message.attachments ?? [],
          {
            id: message.id,
            status: message.status,
            scroll: false,
          },
        );
      }
    }
    const target = targetMessageId
      ? elements.conversation.querySelector(
          `[data-message-id="${CSS.escape(targetMessageId)}"]`,
        )
      : null;
    if (target) {
      target.classList.add("message--target");
      target.scrollIntoView({ block: "center" });
      elements.conversation.focus();
    } else {
      elements.conversation.scrollTop = elements.conversation.scrollHeight;
    }
    if (currentMessages.some((message) => message.status === "pending")) {
      const expectedSessionId = sessionId;
      pendingRefreshTimer = window.setTimeout(() => {
        if (sessionId === expectedSessionId && !requestInProgress) {
          void loadConversation(sessionId, undefined, true).catch(() => {});
        }
      }, 1_500);
    }
  }

  async function loadConversation(id, targetMessageId, allowBusy = false) {
    if (!allowBusy && (requestInProgress || documentRequestInProgress)) {
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(id)}?limit=100`,
      { headers: { Accept: "application/json" } },
    );
    const body = await parseResponse(response, "That saved chat could not be loaded.");
    const previousSessionId = sessionId;
    if (previousSessionId !== id && sessionDocuments.length > 0) {
      discardPendingDocuments(previousSessionId);
    }
    sessionId = body.conversation.id;
    storeSession(sessionId);
    activeConversationTitle = body.conversation.title;
    const availableAgent = agents.find(
      (agent) => agent.id === body.conversation.agentId && agent.status === "active",
    );
    if (availableAgent) {
      activeAgentId = availableAgent.id;
    }
    currentMessages = Array.isArray(body.messages) ? body.messages : [];
    nextMessageBefore = body.nextBefore ?? null;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
    applyAgentIdentity();
    renderAgentList();
    renderSuggestions();
    renderStoredConversation(targetMessageId);
    renderHistoryList();
    setHistoryOpen(false);
    elements.input.focus();
  }

  async function loadOlderMessages() {
    if (!nextMessageBefore) {
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(sessionId)}?limit=100&before=${encodeURIComponent(nextMessageBefore)}`,
      { headers: { Accept: "application/json" } },
    );
    const body = await parseResponse(response, "Earlier messages could not be loaded.");
    currentMessages = [...(body.messages ?? []), ...currentMessages];
    nextMessageBefore = body.nextBefore ?? null;
    renderStoredConversation();
    elements.conversation.scrollTop = 0;
  }

  async function createConversation(agentId = activeAgentId) {
    if (requestInProgress || documentRequestInProgress) {
      return;
    }
    const previousSessionId = sessionId;
    if (sessionDocuments.length > 0) {
      discardPendingDocuments(previousSessionId);
    }
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    const body = await parseResponse(response, "A new chat could not be created.");
    await loadConversationList();
    await loadConversation(body.conversation.id);
    elements.requestStatus.textContent = "New conversation started";
  }

  async function renameConversation(conversation) {
    const supplied = window.prompt("Rename this conversation", conversation.title);
    if (supplied === null) {
      return;
    }
    const title = supplied.replace(/\s+/g, " ").trim();
    if (!title || title.length > 80) {
      elements.historyStatus.textContent = "Use a title from 1 to 80 characters.";
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversation.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    await parseResponse(response, "That chat could not be renamed.");
    if (conversation.id === sessionId) {
      activeConversationTitle = title;
      elements.conversationTitleText.textContent = title;
    }
    await loadConversationList();
  }

  async function deleteConversation(conversation) {
    if (!window.confirm(`Permanently delete “${conversation.title}” from this computer?`)) {
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversation.id)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      await parseResponse(response, "That chat could not be deleted.");
    }
    const deletedCurrent = conversation.id === sessionId;
    await loadConversationList();
    if (deletedCurrent) {
      const replacement = conversations.find(
        (candidate) => candidate.agentId === activeAgentId,
      ) ?? conversations[0];
      if (replacement) {
        await loadConversation(replacement.id);
      } else {
        await createConversation(activeAgentId);
      }
    }
  }

  async function searchConversations(query) {
    const cleaned = query.trim();
    if (!cleaned) {
      renderHistoryList();
      elements.historyMore.hidden = !nextConversationCursor;
      return;
    }
    const response = await fetch(
      `/api/conversations/search?q=${encodeURIComponent(cleaned)}&limit=50`,
      { headers: { Accept: "application/json" } },
    );
    const body = await parseResponse(response, "Saved chats could not be searched.");
    elements.historyMore.hidden = true;
    renderHistoryList(Array.isArray(body.results) ? body.results : [], true);
  }

  function renderAgentList() {
    elements.agentList.replaceChildren();
    for (const agent of agents) {
      const button = document.createElement("button");
      button.className = "agent-button";
      button.type = "button";
      button.disabled =
        agent.status !== "active" ||
        requestInProgress ||
        documentRequestInProgress;
      button.setAttribute("role", "listitem");
      button.setAttribute(
        "aria-pressed",
        String(agent.id === activeAgentId),
      );

      const name = document.createElement("span");
      name.className = "agent-button__name";
      name.textContent = agent.name;

      const status = document.createElement("span");
      status.className = "agent-button__status";
      status.textContent =
        agent.status === "active"
          ? agent.id === activeAgentId
            ? "Active"
            : "Available"
          : "Coming soon";

      const description = document.createElement("span");
      description.className = "agent-button__description";
      description.textContent = agent.description;

      button.append(name, status, description);
      if (agent.status === "active") {
        button.addEventListener("click", () => {
          if (agent.id === activeAgentId) {
            return;
          }
          activeAgentId = agent.id;
          applyAgentIdentity();
          renderAgentList();
          renderSuggestions();
          void createConversation(agent.id);
        });
      }
      elements.agentList.append(button);
    }
  }

  function renderSuggestions() {
    elements.suggestionList.replaceChildren();
    const selectedPrompts =
      activeAgent()?.examplePrompts?.length > 0
        ? activeAgent().examplePrompts
        : config.examplePrompts;
    for (const prompt of selectedPrompts.slice(0, 6)) {
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

  function renderDocuments() {
    elements.documentList.replaceChildren();
    for (const documentItem of uploadedDocuments) {
      const chip = document.createElement("div");
      chip.className = "document-chip";

      const name = document.createElement("span");
      name.className = "document-chip__name";
      name.textContent = documentItem.name;
      name.title = documentItem.name;

      const metadata = document.createElement("span");
      metadata.className = "document-chip__meta";
      metadata.textContent = documentMetadata(documentItem);

      const remove = document.createElement("button");
      remove.className = "document-chip__remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${documentItem.name}`);
      remove.disabled = requestInProgress || documentRequestInProgress;
      remove.addEventListener("click", () => {
        void removeDocument(documentItem.id);
      });

      chip.append(name, metadata, remove);
      elements.documentList.append(chip);
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
    const controlsBusy = isBusy || documentRequestInProgress;
    if (controlsBusy) {
      setAttachmentMenuOpen(false);
    }
    elements.conversation.setAttribute("aria-busy", String(isBusy));
    elements.input.disabled = controlsBusy;
    elements.sendButton.disabled = controlsBusy;
    elements.resetButton.disabled = controlsBusy;
    elements.historyNew.disabled = controlsBusy;
    elements.historyMore.disabled = controlsBusy;
    elements.historySearchInput.disabled = controlsBusy;
    elements.attachmentMenuButton.disabled = controlsBusy;
    elements.uploadButton.disabled = controlsBusy;
    elements.pasteButton.disabled = controlsBusy;
    for (const suggestion of elements.suggestionList.querySelectorAll("button")) {
      suggestion.disabled = controlsBusy;
    }
    for (const historyControl of elements.historyList.querySelectorAll("button")) {
      historyControl.disabled = controlsBusy;
    }
    elements.sendButtonLabel.textContent = isBusy ? "Working" : "Send";
    elements.requestStatus.textContent = isBusy
      ? `${displayAgentName()} is working on your request…`
      : "Press Enter to send · Shift + Enter for a new line";
    renderAgentList();
    renderDocuments();
  }

  function setDocumentBusy(isBusy, message = "") {
    documentRequestInProgress = isBusy;
    elements.documentStatus.textContent = message;
    setBusy(requestInProgress);
  }

  function setAttachmentMenuOpen(isOpen) {
    elements.attachmentMenu.hidden = !isOpen;
    elements.attachmentMenuButton.setAttribute(
      "aria-expanded",
      String(isOpen),
    );
    if (isOpen) {
      elements.uploadButton.focus();
    }
  }

  async function uploadFile(file) {
    if (uploadedDocuments.length >= MAX_DOCUMENTS) {
      addError(`Add no more than ${MAX_DOCUMENTS} documents to one message.`);
      return;
    }

    setDocumentBusy(true, `Reading ${file.name}…`);
    try {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("file", file);
      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      const body = await parseResponse(
        response,
        "The document could not be read.",
      );
      if (!body?.document?.id) {
        throw new Error("The document reader returned an unexpected result.");
      }
      uploadedDocuments.push(body.document);
      sessionDocuments.push(body.document);
      renderDocuments();
      elements.documentStatus.textContent =
        body.document.warnings?.length > 0
          ? body.document.warnings[0]
          : "";
    } catch (error) {
      elements.documentStatus.textContent = "";
      addError(
        error instanceof Error
          ? error.message
          : "The document could not be read.",
      );
    } finally {
      documentRequestInProgress = false;
      setBusy(requestInProgress);
      elements.fileInput.value = "";
    }
  }

  async function uploadPastedText(name, text) {
    if (uploadedDocuments.length >= MAX_DOCUMENTS) {
      addError(`Add no more than ${MAX_DOCUMENTS} documents to one message.`);
      return false;
    }

    setDocumentBusy(true, "Preparing pasted text…");
    try {
      const response = await fetch("/api/documents/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, name, text }),
      });
      const body = await parseResponse(
        response,
        "The pasted text could not be prepared.",
      );
      if (!body?.document?.id) {
        throw new Error("The document reader returned an unexpected result.");
      }
      uploadedDocuments.push(body.document);
      sessionDocuments.push(body.document);
      renderDocuments();
      elements.documentStatus.textContent = "";
      return true;
    } catch (error) {
      elements.documentStatus.textContent = "";
      addError(
        error instanceof Error
          ? error.message
          : "The pasted text could not be prepared.",
      );
      return false;
    } finally {
      documentRequestInProgress = false;
      setBusy(requestInProgress);
    }
  }

  async function removeDocument(id) {
    const documentItem = uploadedDocuments.find((item) => item.id === id);
    if (!documentItem) {
      return;
    }

    setDocumentBusy(true, `Removing ${documentItem.name}…`);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => null);
        throw new Error(
          friendlyError(body, "The document could not be removed."),
        );
      }
      uploadedDocuments = uploadedDocuments.filter((item) => item.id !== id);
      sessionDocuments = sessionDocuments.filter((item) => item.id !== id);
      elements.documentStatus.textContent = "";
    } catch (error) {
      addError(
        error instanceof Error
          ? error.message
          : "The document could not be removed.",
      );
    } finally {
      documentRequestInProgress = false;
      setBusy(requestInProgress);
    }
  }

  async function sendMessage(
    rawMessage,
    showUserMessage,
    retryDocuments,
  ) {
    if (requestInProgress || documentRequestInProgress) {
      return;
    }

    const message = rawMessage.trim();
    if (!message) {
      elements.input.focus();
      return;
    }

    const requestDocuments = Array.isArray(retryDocuments)
      ? retryDocuments
      : [...uploadedDocuments];

    if (showUserMessage) {
      addMessage("user", message, requestDocuments);
      uploadedDocuments = [];
      elements.fileInput.value = "";
      elements.pastedName.value = "";
      elements.pastedText.value = "";
      elements.documentStatus.textContent = "";
      renderDocuments();
    }
    elements.suggestions.hidden = true;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
    setBusy(true);
    loadingMessage = addLoadingMessage();
    const requestId = createSessionId();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          sessionId,
          agentId: activeAgentId,
          message,
          documentIds: requestDocuments.map((item) => item.id),
        }),
      });

      const responseBody = await parseResponse(
        response,
        "The local agent could not reply. Check that n8n is running, then try again.",
      );
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
      await loadConversationList();
      await loadConversation(sessionId, undefined, true);
    } catch (error) {
      loadingMessage?.remove();
      loadingMessage = null;
      try {
        await loadConversationList();
        await loadConversation(sessionId, undefined, true);
      } catch {
        // Keep the visible optimistic message when history refresh also fails.
      }
      addError(
        error instanceof Error
          ? error.message
          : "The local agent could not reply. Check n8n and try again.",
        { message, documents: requestDocuments },
      );
    } finally {
      setBusy(false);
      elements.input.focus();
    }
  }

  function updateCharacterCount() {
    const length = elements.input.value.length;
    elements.characterCount.textContent = `${length.toLocaleString()} / 100,000`;
    elements.characterCount.classList.toggle(
      "character-count--near-limit",
      length >= 90_000,
    );
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 160)}px`;
  }

  function startNewConversation() {
    elements.fileInput.value = "";
    elements.pastedName.value = "";
    elements.pastedText.value = "";
    elements.documentStatus.textContent = "";
    setAttachmentMenuOpen(false);
    void createConversation(activeAgentId).catch((error) => {
      addError(
        error instanceof Error
          ? error.message
          : "A new conversation could not be created.",
      );
    });
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    // Sending a bare meeting link fetches its transcript instead of asking the
    // agent about the URL itself.
    const meetingLink = supportedLinkIn(elements.input.value);
    if (meetingLink) {
      elements.input.value = "";
      elements.input.dispatchEvent(new Event("input", { bubbles: true }));
      void handleMeetingLink(meetingLink);
      return;
    }
    void sendMessage(elements.input.value, true);
  });

  elements.input.addEventListener("input", () => {
    updateCharacterCount();
    resizeInput();
  });

  elements.input.addEventListener("paste", (event) => {
    const pastedText = event.clipboardData?.getData("text") ?? "";
    // A supported meeting link is fetched instead of being pasted as text.
    const meetingLink = supportedLinkIn(pastedText);
    if (meetingLink) {
      event.preventDefault();
      void handleMeetingLink(meetingLink);
      return;
    }
    if (
      pastedText.length > LARGE_PASTE_THRESHOLD ||
      elements.input.value.length + pastedText.length > 8_000
    ) {
      event.preventDefault();
      void uploadPastedText("Pasted transcript", pastedText).then((added) => {
        if (added) {
          elements.documentStatus.textContent =
            "Large pasted text was added as document context. Add an instruction below.";
        }
      });
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

  elements.attachmentMenuButton.addEventListener("click", () => {
    setAttachmentMenuOpen(elements.attachmentMenu.hidden);
  });

  elements.uploadButton.addEventListener("click", () => {
    setAttachmentMenuOpen(false);
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  });

  elements.pasteButton.addEventListener("click", () => {
    setAttachmentMenuOpen(false);
    elements.pastedName.value = "Pasted transcript";
    elements.pastedText.value = "";
    elements.pasteDialog.showModal();
    elements.pastedText.focus();
  });

  elements.pasteCancel.addEventListener("click", () => {
    elements.pasteDialog.close();
  });

  document.addEventListener("click", (event) => {
    if (
      !elements.attachmentMenu.hidden &&
      !elements.attachmentMenu.contains(event.target) &&
      !elements.attachmentMenuButton.contains(event.target)
    ) {
      setAttachmentMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.attachmentMenu.hidden) {
      event.preventDefault();
      setAttachmentMenuOpen(false);
      elements.attachmentMenuButton.focus();
    }
    if (
      event.key === "Escape" &&
      elements.agentPanel.classList.contains("agent-panel--open")
    ) {
      event.preventDefault();
      setHistoryOpen(false);
    }
  });

  elements.pasteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.pastedName.value;
    const text = elements.pastedText.value;
    void uploadPastedText(name, text).then((added) => {
      if (added) {
        elements.pasteDialog.close();
        elements.input.focus();
      }
    });
  });

  elements.resetButton.addEventListener("click", startNewConversation);
  elements.historyNew.addEventListener("click", startNewConversation);
  elements.historyButton.addEventListener("click", () => {
    setHistoryOpen(true);
  });
  elements.historyClose.addEventListener("click", () => {
    setHistoryOpen(false);
  });
  elements.historyMore.addEventListener("click", () => {
    void loadConversationList({ append: true }).catch((error) => {
      elements.historyStatus.textContent =
        error instanceof Error ? error.message : "More chats could not be loaded.";
    });
  });
  elements.historySearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchConversations(elements.historySearchInput.value).catch((error) => {
      elements.historyStatus.textContent =
        error instanceof Error ? error.message : "Saved chats could not be searched.";
    });
  });
  elements.historySearchInput.addEventListener("input", () => {
    if (!elements.historySearchInput.value.trim()) {
      renderHistoryList();
      elements.historyMore.hidden = !nextConversationCursor;
    }
  });
  narrowLayout.addEventListener("change", () => {
    if (!narrowLayout.matches) {
      elements.agentPanel.classList.remove("agent-panel--open");
      elements.historyButton.setAttribute("aria-expanded", "false");
    }
    syncHistoryPanelAccess();
  });

  async function initialise() {
    syncHistoryPanelAccess();
    await loadAgents();
    applyAgentIdentity();
    renderAgentList();
    renderSuggestions();
    renderDocuments();
    try {
      await loadConversationList();
      try {
        await loadConversation(sessionId);
        return;
      } catch {
        // The browser may hold a pre-persistence session UUID.
      }
      const mostRecent = conversations.find(
        (conversation) => conversation.agentId === activeAgentId,
      ) ?? conversations[0];
      if (mostRecent) {
        await loadConversation(mostRecent.id);
      } else {
        await createConversation(activeAgentId);
      }
    } catch (error) {
      renderNewConversation();
      addError(
        error instanceof Error
          ? error.message
          : "Saved chats could not be loaded. Restart the local app and try again.",
      );
    }
  }

  void initialise();
})();
