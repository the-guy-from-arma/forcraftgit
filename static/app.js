const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const app = $("#app");
const toastEl = $("#toast");
const OS_VERSION = "0.1.1";
const SESSION_BOOT_TIMEOUT_MS = 14000;
const pendingMutations = new Map();
let activeActionConfirm = false;

const state = {
  boot: {
    status: "starting",
    attempt: 0,
    lastError: "",
  },
  authMode: "login",
  session: null,
  activeApp: null,
  returnToMdtOnClose: false,
  pendingArmaCode: new URL(window.location.href).searchParams.get("code") || "",
  armaUnlinkOpen: false,
  armaLinkPromptDismissed: false,
  generatedDevCode: null,
  fineSettlementCode: null,
  taxSettlementCode: null,
  settlementTab: "fines",
  fineSettlementPrompt: "",
  devTab: "dashboard",
  devAccount: null,
  devAntiCheatUid: null,
  devAntiCheatSearch: "",
  dmvTab: "overview",
  jobsTab: "state_police",
  mdtTab: "search",
  mdtNavOpen: false,
  mdtSideOpen: false,
  mdtCatalogOpen: false,
  mdtCatalogMode: "citation",
  mdtSelectedCiv: "",
  mdtSelectedChargeId: "",
  mdtBookingDraft: null,
  mdtReportAlertId: "",
  mdtNotice: null,
  mdtProtocolAssistantEnabled: localStorage.getItem("rp.mdt.protocolAssistant") !== "0",
  mdtTrafficStopActive: false,
  mdtTrafficStopStep: 0,
  mdtTrafficStopQuery: "",
  mdtTrafficStopResults: [],
  mdtTrafficStopDriverId: "",
  mdtTrafficStopDriverName: "",
  mdtTrafficStopOutcome: "",
  cidSelectedCaseId: null,
  cidSelectedIaId: null,
  cidWarrantModalId: null,
  mdtProfileUserId: null,
  mdtProfileTab: "profile",
  dispatchSelectedCallId: null,
  dispatchNcicResults: [],
  dispatchNcicQuery: "",
  dispatchFilter: "active",
  dispatchPastOpen: false,
  dispatchViewingPastCall: false,
  myFaircroftTab: "overview",
  courtTab: "docket",
  courtSelectedCaseId: null,
  contractsTab: "open",
  contractsInfoOpen: false,
  contractProofId: null,
  roadmapFilter: "all",
  roadmapEditorId: null,
  businessTab: "apply",
  businessReviewFilter: "active",
  businessLicensePage: 1,
  businessRegistryPage: 1,
  treasuryProofs: [],
  adminTab: "users",
  adminApplicationFilter: "active",
  indeedApplicationFilter: "active",
  adminSearch: "",
  adminAccountId: null,
  dmvCountdownTimer: null,
  dmvCountdownRefreshing: false,
  cache: {},
};

const MDT_DISPATCH_ROLES = [
  "admin",
  "dispatcher",
  "owner",
  "leo",
  "cid",
  "cid_director",
  "iu",
  "iu_director",
  "fireman",
  "fire_chief",
  "deputy_chief",
  "fire_marshal",
  "ems",
  "sheriff",
  "police",
  "metro_police_chief",
  "state_police",
  "state_police_commander",
];

const CALLSIGN_REQUIRED_ROLES = [
  "dispatcher",
  "leo",
  "cid",
  "cid_director",
  "iu",
  "iu_director",
  "fireman",
  "fire_chief",
  "deputy_chief",
  "fire_marshal",
  "ems",
  "sheriff",
  "police",
  "metro_police_chief",
  "state_police",
  "state_police_commander",
];

const iconSvg = {
  "id-card": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4M7 16c.6-1 3.4-1 4 0"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2M3 12h18M12 12v2"/></svg>',
  gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m14 13-7 7M8 7l6 6M5 10l5-5M12 3l5 5M16 12l5 5M14 15l5-5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 10 9-6 9 6Z"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 19h18"/></svg>',
  treasury: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M5 10v8M9 12v6M15 12v6M19 10v8M3 18h18"/><path d="M12 7v4"/></svg>',
  civic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 21h16M6 18h12M7 9v9M11 9v9M15 9v9M19 9v9M3 8h18L12 3 3 8Z"/><path d="M12 5.5v1"/></svg>',
  store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 10h16l-1-5H5Z"/><path d="M5 10v10h14V10"/><path d="M8 20v-6h8v6"/><path d="M4 10c0 2 3 2 4 0 1 2 5 2 6 0 1 2 4 2 6 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M16 11l2 2 4-5"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/><path d="M6 10h2M16 10h2M11 14h2"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-5"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8.5 14.5A4.5 4.5 0 1 0 17 12c0-3-2-5-5-8-.5 3-2 4.5-3.5 6S6 12.7 8.5 14.5Z"/><path d="M12 22a4 4 0 0 0 4-4c0-1.8-1-3.3-3-5-.3 1.8-1.3 2.7-2.2 3.5-.8.8-1.3 1.5-1.3 2.5A2.5 2.5 0 0 0 12 22Z"/></svg>',
  radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 11h14v10H5z"/><path d="M8 11 15 3"/><circle cx="9" cy="16" r="1.5"/><path d="M13 15h3M13 18h3"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  scroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 21h9a3 3 0 0 0 3-3V5a2 2 0 0 0-2-2H7a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h1Z"/><path d="M8 21a3 3 0 0 1-3-3V7h13"/><path d="M9 11h6M9 15h5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V22a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 18l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/><circle cx="19" cy="5" r="2"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19h3a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3h-1a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h5"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 5c3-3 6-3 7-2 1 1 1 4-2 7l-6 6-5-5 6-6Z"/><path d="m9 10-4 1-2 3 5 1M14 15l-1 4-3 2-1-5M15 6l3 3"/><path d="M5 18c-1 0-2 1-2 3 2 0 3-1 3-2"/></svg>',
  "thumb-up": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 10v11H3V10h4ZM7 19h10a3 3 0 0 0 2.9-2.3l1-4A3 3 0 0 0 18 9h-4l1-4c.3-1.3-.7-2-1.5-2L7 10"/></svg>',
  "thumb-down": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 14V3H3v11h4ZM7 5h10a3 3 0 0 1 2.9 2.3l1 4A3 3 0 0 1 18 15h-4l1 4c.3 1.3-.7 2-1.5 2L7 14"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 17l5-5-5-5M15 12H3M21 3v18"/></svg>',
};

const tileColors = {
  profile: "linear-gradient(145deg, #7ee7ff, #276a88)",
  "getting-started": "linear-gradient(145deg, #ffe36d, #1d8b7d)",
  dmv: "linear-gradient(145deg, #4ecdc4, #1b6d69)",
  jobs: "linear-gradient(145deg, #f7b733, #704811)",
  court: "linear-gradient(145deg, #b78cff, #4f3175)",
  "my-faircroft": "linear-gradient(145deg, #78e4d0, #2e628e 55%, #d5ab4e)",
  properties: "linear-gradient(145deg, #28d17c, #17623d)",
  cash: "linear-gradient(145deg, #f15f79, #7a1e31)",
  bank: "linear-gradient(145deg, #5c9cff, #21497e)",
  restriction: "linear-gradient(145deg, #ff9f5c, #7d281f)",
  treasury: "linear-gradient(145deg, #f8d572, #0f806f)",
  business: "linear-gradient(145deg, #58e6a5, #2457a8)",
  messages: "linear-gradient(145deg, #ffffff, #6d7779)",
  contracts: "linear-gradient(145deg, #ff5d7d, #4120a4)",
  changelog: "linear-gradient(145deg, #7ee7ff, #3158e8)",
  roadmap: "linear-gradient(145deg, #56e3a2, #e8b84a 58%, #e45f55)",
  dispatch: "linear-gradient(145deg, #58f0e6, #1e3248)",
  mdt: "linear-gradient(145deg, #28343c, #050709)",
  fire: "linear-gradient(145deg, #ff6b4a, #2d1b1b)",
  "fire-settings": "linear-gradient(145deg, #ffb15a, #5b1815)",
  system: "linear-gradient(145deg, #35e0b6, #22485c)",
  "indeed-admin": "linear-gradient(145deg, #2fd38f, #172f28)",
  admin: "linear-gradient(145deg, #ffcf5a, #6c5010)",
  "dev-tools": "linear-gradient(145deg, #8bffcf, #3156d8)",
  "beta-tasks": "linear-gradient(145deg, #b78cff, #3156d8)",
};

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function minutes(seconds) {
  return Math.floor((seconds || 0) / 60);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedAttr(value, current) {
  return String(value) === String(current) ? " selected" : "";
}

function renderOptions(options, current) {
  return options.map((option) => `<option value="${escapeHtml(option)}"${selectedAttr(option, current)}>${escapeHtml(option)}</option>`).join("");
}

function toast(message) {
  if (!message) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function isMutationMethod(method) {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(String(method || "GET").toUpperCase());
}

function actionConfirmExempt(path) {
  const cleanPath = String(path || "").split("?")[0];
  return cleanPath === "/api/presence" || cleanPath === "/api/auth/login" || cleanPath === "/api/auth/logout";
}

function actionFingerprint(method, path, body = "") {
  const source = `${method}|${path}|${body}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `DF-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function actionTitleFromPath(path, method) {
  const clean = String(path || "")
    .split("?")[0]
    .replace(/^\/api\//, "")
    .replaceAll("/", " ")
    .replaceAll("-", " ")
    .replace(/\b\d+\b/g, "record");
  const title = clean.replace(/\b\w/g, (char) => char.toUpperCase()).trim() || "System Action";
  return `${method} ${title}`;
}

function confirmDigitalAction({ method, path, body }) {
  if (activeActionConfirm) {
    toast("Confirm the open action first");
    return Promise.resolve(false);
  }
  activeActionConfirm = true;
  const signature = actionFingerprint(method, path, body);
  const title = actionTitleFromPath(path, method);
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "action-confirm-backdrop";
    backdrop.innerHTML = `
      <section class="action-confirm-modal" role="dialog" aria-modal="true" aria-label="Confirm request">
        <div>
          <p class="eyebrow">Confirm request</p>
          <h2>${escapeHtml(title)}</h2>
          <p>This will send one request to the RP system. Confirm once and wait for the response before tapping again.</p>
        </div>
        <div class="digital-signature">
          <span>Digital footprint</span>
          <strong>${escapeHtml(signature)}</strong>
        </div>
        <div class="action-confirm-actions">
          <button class="secondary" type="button" data-action-confirm-cancel>Cancel</button>
          <button class="primary" type="button" data-action-confirm-ok>Confirm send</button>
        </div>
      </section>
    `;
    const cleanup = (value) => {
      activeActionConfirm = false;
      backdrop.remove();
      resolve(value);
    };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) cleanup(false);
    });
    backdrop.querySelector("[data-action-confirm-cancel]")?.addEventListener("click", () => cleanup(false));
    backdrop.querySelector("[data-action-confirm-ok]")?.addEventListener("click", () => cleanup(true));
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-action-confirm-ok]")?.focus();
  });
}

async function copyToClipboard(value) {
  const text = String(value || "");
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

async function api(path, options = {}) {
  const timeoutMs = options.timeoutMs ?? 0;
  const confirmOption = options.confirm;
  const { timeoutMs: _timeoutMs, confirm: _confirm, headers: optionHeaders, ...restOptions } = options;
  const requestInit = {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(optionHeaders || {}) },
    ...restOptions,
  };
  requestInit.method = String(requestInit.method || "GET").toUpperCase();
  if (requestInit.body && typeof requestInit.body !== "string") {
    requestInit.body = JSON.stringify(requestInit.body);
  }
  const mutation = isMutationMethod(requestInit.method);
  const lockKey = mutation ? `${requestInit.method} ${path} ${requestInit.body || ""}` : "";
  if (lockKey && pendingMutations.has(lockKey)) {
    toast("Action already sending");
    return pendingMutations.get(lockKey);
  }
  if (mutation && confirmOption !== false && !actionConfirmExempt(path)) {
    const confirmed = await confirmDigitalAction({ method: requestInit.method, path, body: requestInit.body || "" });
    if (!confirmed) throw new Error("");
  }
  let timeoutId = null;
  let controller = null;
  if (timeoutMs > 0) {
    controller = new AbortController();
    requestInit.signal = controller.signal;
    timeoutId = setTimeout(() => {
      controller.abort("Request timed out");
    }, timeoutMs);
  }
  const request = (async () => {
    try {
      const response = await fetch(path, {
        ...requestInit,
      });
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }
      return data;
    } finally {
      clearTimeout(timeoutId);
      if (lockKey) pendingMutations.delete(lockKey);
    }
  })();
  if (lockKey) pendingMutations.set(lockKey, request);
  return request;
}

async function loadSession() {
  state.session = await api("/api/session", { timeoutMs: SESSION_BOOT_TIMEOUT_MS });
  if (state.session?.user && state.pendingArmaCode && !state.activeApp) {
    state.activeApp = "profile";
    await loadAppData("profile");
  }
  render();
}

function renderBootScreen() {
  const connecting = state.boot.status === "connecting";
  const attempting = state.boot.attempt || 1;
  return phone(`
    <section class="boot-screen ${connecting ? "booting" : ""}">
      <video class="faircroft-entrance-media" autoplay muted loop playsinline poster="/static/brand/faircroft-emblem.webp">
        <source src="/static/brand/faircroft-light-sweep.mp4" type="video/mp4" />
      </video>
      <div class="boot-orb" aria-hidden="true">
        <span class="boot-orb-core"></span>
        <span class="boot-orb-ring"></span>
        <span class="boot-orb-ring"></span>
      </div>
      <p class="boot-title">${connecting ? "Entering Faircroft..." : "Cannot contact Faircroft services"}</p>
      <p class="boot-subtitle">
        ${connecting ? "Syncing your account and loading modules. This usually takes just a second." : escapeHtml(state.boot.lastError || "Server response could not be loaded right now.")}
      </p>
      <div class="boot-progress">
        <span></span>
      </div>
      <p class="boot-meta">Connection attempt ${attempting} - RP OS ${OS_VERSION}</p>
      ${connecting ? `<p class="boot-note">If this persists, check your API host and network connection, then retry.</p>` : `<button class="primary" data-retry-boot>Retry</button>`}
      ${state.boot.lastError ? `<p class="boot-error">${escapeHtml(state.boot.lastError)}</p>` : ""}
    </section>
  `);
}

function bindBoot() {
  if (state.boot.status === "connected") return;
  $$("[data-retry-boot]").forEach((button) => {
    button.addEventListener("click", () => bootApp());
  });
}

async function bootApp() {
  state.boot.attempt += 1;
  state.boot.status = "connecting";
  state.boot.lastError = "";
  app.innerHTML = renderBootScreen();
  bindBoot();
  try {
    await loadSession();
    state.boot.status = "connected";
  } catch (error) {
    state.boot.status = "failed";
    state.boot.lastError = error.name === "AbortError" ? `Session request timed out after ${Math.round(SESSION_BOOT_TIMEOUT_MS / 1000)} seconds.` : error.message || "Unable to reach the API.";
    app.innerHTML = renderBootScreen();
    bindBoot();
  }
}

function phone(content) {
  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `
    <section class="phone-shell">
      <div class="phone-screen">
        <div class="status-bar">
          <span>${time}</span>
          <span class="status-icons"><span class="signal"></span><span>5G</span><span class="battery"></span></span>
        </div>
        ${content}
        <footer class="os-version">RP OS ${OS_VERSION}</footer>
      </div>
    </section>
  `;
}

function render() {
  if (state.activeApp !== "dmv") {
    clearDmvCountdown();
  }
  if (!state.session?.user) {
    app.innerHTML = phone(renderAuth());
    bindAuth();
    return;
  }
  if (state.activeApp === "mdt" && !appAvailable("mdt")) {
    state.activeApp = null;
    state.mdtTab = "search";
    state.mdtProfileUserId = null;
    if (state.cache.mdt) state.cache.mdt.cid = null;
  }
  if (isUpdateLockdown()) {
    if (state.activeApp && !appAvailable(state.activeApp)) {
      state.activeApp = null;
    }
    if (state.activeApp === "dmv") {
      state.dmvTab = "license";
    }
  }
  if (state.activeApp === "roadmap") {
    app.innerHTML = renderRoadmapWorkspace() + renderRequiredProfileModals();
    bindRoadmapWorkspace();
    bindRequiredProfileModals();
    return;
  }
  if (state.activeApp === "mdt" || state.activeApp === "fire") {
    app.innerHTML = (
      state.activeApp === "fire"
        ? renderFireWorkspace()
        : renderMdtWorkspace()
    ) + renderRequiredProfileModals();
    state.activeApp === "fire" ? bindFireWorkspace() : bindMdtWorkspace();
    bindRequiredProfileModals();
    return;
  }
  if (state.activeApp === "dev-tools") {
    app.innerHTML = renderDevWorkspace() + renderRequiredProfileModals();
    bindDevWorkspace();
    bindRequiredProfileModals();
    return;
  }
  if (state.activeApp === "business") {
    app.innerHTML = renderBusinessWorkspace() + renderRequiredProfileModals();
    bindBusinessWorkspace();
    bindRequiredProfileModals();
    return;
  }
  if (state.activeApp === "court") {
    app.innerHTML = renderCourtWorkspace() + renderRequiredProfileModals();
    bindCourtWorkspace();
    bindRequiredProfileModals();
    return;
  }
  if (state.activeApp) {
    app.innerHTML = phone(renderHome() + renderPanel(state.activeApp) + renderRequiredProfileModals());
    bindHome();
    bindPanel();
    bindRequiredProfileModals();
    return;
  }
  app.innerHTML = phone(renderHome() + renderRequiredProfileModals());
  bindHome();
  bindRequiredProfileModals();
}

function renderAuth() {
  const register = state.authMode === "register";
  return `
    <section class="auth-card">
      <div class="brand-lockup">
        <img class="app-mark faircroft-emblem" src="/static/brand/faircroft-emblem.webp" alt="Faircroft emblem" />
        <div>
          <p class="eyebrow">Official roleplay system</p>
          <h1>Faircroft RP</h1>
        </div>
      </div>
      <div class="auth-tabs">
        <button class="${!register ? "active" : ""}" data-auth-mode="login">Sign in</button>
        <button class="${register ? "active" : ""}" data-auth-mode="register">Register</button>
      </div>
      <form id="authForm" class="form-grid">
        ${register ? `<label>Name<input name="name" autocomplete="name" required /></label>` : ""}
        ${register ? `<label>Car entry code<input name="car_entry_code" autocomplete="off" maxlength="32" pattern="[A-Za-z0-9_-]{2,32}" placeholder="In-game vehicle access code" required /></label>` : ""}
        ${register ? `<label>Referral code <span class="muted small">optional</span><input name="referral_code" autocomplete="off" maxlength="16" placeholder="Friend's referral code" /></label>` : ""}
        <label>Email<input name="email" type="email" autocomplete="email" required /></label>
        <label>Password<input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="6" required /></label>
        <button class="primary" type="submit">${register ? "Create civilian" : "Unlock phone"}</button>
      </form>
    </section>
  `;
}

function bindAuth() {
  $$("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      render();
    });
  });
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      await api(state.authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: payload,
      });
      await loadSession();
      toast(state.authMode === "register" ? "Civilian profile created" : "Signed in");
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderCarEntryRequiredModal() {
  if (isUpdateLockdown()) return "";
  const user = state.session?.user;
  if (!user || String(user.car_entry_code || "").trim()) return "";
  return `
    <div class="modal-backdrop force-code-backdrop">
      <section class="mdt-modal force-code-modal" role="dialog" aria-modal="true" aria-label="Car entry code required">
        <header>
          <p class="eyebrow">Required profile update</p>
          <h2>Enter Car Entry Code</h2>
        </header>
        <div class="notice-body">
          <p>Your profile needs your in-game car entry code before the phone can continue.</p>
          <p>This code will appear in NCIC/DMV returns when an officer searches your account.</p>
        </div>
        <form id="forcedCarEntryCodeForm" class="form-grid">
          <label>Car entry code<input name="car_entry_code" maxlength="32" pattern="[A-Za-z0-9_-]{2,32}" placeholder="In-game vehicle access code" autocomplete="off" required autofocus /></label>
          <button class="primary" type="submit">Save and continue</button>
        </form>
      </section>
    </div>
  `;
}

function bindCarEntryRequiredModal() {
  $("#forcedCarEntryCodeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveCarEntryCodeFromForm(event.currentTarget);
      toast("Car entry code saved");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
}

function userNeedsCallsign() {
  if (isUpdateLockdown()) return false;
  const user = state.session?.user;
  if (!user) return false;
  const roles = (user.roles || []).map(normalizedRole);
  const hasDepartmentRole = roles.some((role) => CALLSIGN_REQUIRED_ROLES.includes(role));
  return hasDepartmentRole && !String(user.callsign || "").trim();
}

function renderCallsignRequiredModal() {
  if (!userNeedsCallsign()) return "";
  const user = state.session?.user || {};
  return `
    <div class="modal-backdrop force-code-backdrop callsign-required-backdrop">
      <section class="mdt-modal force-code-modal callsign-required-modal" role="dialog" aria-modal="true" aria-label="Callsign required">
        <header>
          <p class="eyebrow">Department radio identity</p>
          <h2>Set Your Callsign</h2>
        </header>
        <div class="notice-body">
          <p>Your account has department access. A callsign can identify you in department records.</p>
          <p>Use the callsign your command staff expects to see in MDT records.</p>
        </div>
        <form id="forcedCallsignForm" class="form-grid">
          <label>Callsign<input name="callsign" value="${escapeHtml(user.callsign || "")}" maxlength="24" pattern="[A-Za-z0-9_-]{2,24}" placeholder="UNIT-1, ALPHA-2, 2B-12" autocomplete="off" required autofocus /></label>
          <button class="primary" type="submit">Save callsign</button>
        </form>
      </section>
    </div>
  `;
}

function renderRequiredProfileModals() {
  if (state.session?.sanction?.type === "timeout") return "";
  return renderCarEntryRequiredModal() || renderArmaLinkRequiredModal() || renderBetaInviteModal();
}

function renderBetaInviteModal() {
  if (!state.session?.system?.beta_invite) return "";
  return `
    <div class="modal-backdrop beta-invite-backdrop">
      <section class="mdt-modal force-code-modal beta-invite-modal" role="dialog" aria-modal="true" aria-label="Faircroft Beta Program invitation">
        <header><p class="eyebrow">Early access invitation</p><h2>Join the Faircroft Beta Program?</h2></header>
        <div class="beta-invite-mark">&beta;</div>
        <div class="notice-body">
          <p>${escapeHtml(state.session.system.beta_recruiting_message || "")}</p>
          <p class="muted small">You will receive the Beta Tester role and a Beta Tasks app for test instructions and bug reports.</p>
        </div>
        <div class="row">
          <button class="primary" type="button" data-beta-response="accepted">Join Beta Program</button>
          <button class="secondary" type="button" data-beta-response="declined">Not right now</button>
        </div>
      </section>
    </div>`;
}

function renderArmaLinkRequiredModal() {
  if (!state.session?.requires_arma_link || state.armaLinkPromptDismissed) return "";
  return `
    <div class="modal-backdrop force-code-backdrop">
      <section class="mdt-modal force-code-modal" role="dialog" aria-modal="true" aria-label="Link Arma account">
        <header>
          <p class="eyebrow">Verified account setup</p>
          <h2>Link Your Arma Account</h2>
        </header>
        <div class="notice-body">
          <p>Your Faircroft account is verified but no live Arma Reforger account is linked.</p>
          <p>Join the game, request a linking code, then enter it from the Profile app.</p>
        </div>
        <div class="row">
          <button class="primary" type="button" data-open-arma-link>Open Profile Linking</button>
          <button class="secondary" type="button" data-dismiss-arma-link>Later</button>
        </div>
      </section>
    </div>
  `;
}

function bindRequiredProfileModals() {
  bindCarEntryRequiredModal();
  $("#forcedCallsignForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveCallsignFromForm(event.currentTarget);
      toast("Callsign saved");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
  $("[data-open-arma-link]")?.addEventListener("click", async () => {
    state.armaLinkPromptDismissed = true;
    state.activeApp = "profile";
    await loadAppData("profile");
    render();
  });
  $("[data-dismiss-arma-link]")?.addEventListener("click", () => {
    state.armaLinkPromptDismissed = true;
    render();
  });
  $$("[data-beta-response]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const accepted = button.dataset.betaResponse === "accepted";
      await api("/api/beta/respond", { method: "POST", body: { response: button.dataset.betaResponse } });
      toast(accepted ? "Welcome to the Faircroft Beta Program" : "Beta invitation dismissed");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function renderHome() {
  const { user, apps, unread_messages: unread } = state.session;
  if (isUpdateLockdown()) return renderUpdateLockdownHome(apps);
  const locked = !user.verified && !user.roles.includes("owner") && !user.roles.includes("admin");
  return `
    <section class="home-stack">
      <header class="home-header">
        <div class="home-identity">
          <img class="home-emblem" src="/static/brand/faircroft-emblem.webp" alt="" />
          <div>
          <p class="eyebrow">${user.primary_agency || (user.verified ? "Civilian" : "Unverified civilian")}</p>
          <h1>${escapeHtml(user.name.split(" ")[0] || user.name)}</h1>
          </div>
        </div>
        <button class="icon-action" data-logout aria-label="Sign out">${iconSvg.logout}</button>
      </header>
      <div class="user-chip"><span class="user-dot ${locked ? "" : "ok"}"></span>${locked ? "Waiting on verification" : "Verified"} · CIV ${escapeHtml(user.civ_number || "pending")} · ${escapeHtml(user.roles.join(", "))}</div>
      ${state.session?.sanction?.type === "timeout" ? `
        <div class="home-alert restriction-alert">
          ${iconSvg.lock}
          <div><strong>Account access temporarily limited</strong><p>${escapeHtml(state.session.sanction.reason || "A staff timeout is active.")} Open the Restriction app for the remaining time and bail instructions.</p></div>
        </div>
      ` : ""}
      ${locked ? `
        <div class="home-alert">
          ${iconSvg.lock}
          <div><strong>Most apps locked</strong><p>Jobs are open for applications. Owner/admin verification is still required for the rest of the system.</p></div>
        </div>
      ` : ""}
      <div class="app-grid">
        ${apps.map((item, index) => `
          <button class="app-icon ${item.enabled ? "" : "locked"} ${item.coming_soon ? "coming-soon" : ""}" style="--i:${index}" data-open-app="${item.id}" ${item.enabled ? "" : "disabled"}>
            <span class="icon-tile" style="--tile:${tileColors[item.id] || tileColors.dmv}">
              ${iconSvg[item.icon] || iconSvg.settings}
              ${item.coming_soon ? `<span class="soon-badge">SOON</span>` : item.enabled ? "" : `<span class="lock-badge">${iconSvg.lock}</span>`}
            </span>
            <span>${escapeHtml(item.label)}${item.id === "messages" && unread ? ` (${unread})` : ""}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderUpdateLockdownHome(apps) {
  const allowed = (apps || []).filter((item) => item.enabled);
  const hasDmv = allowed.some((item) => item.id === "dmv");
  const hasMdt = allowed.some((item) => item.id === "mdt");
  return `
    <section class="update-lockdown-screen">
      <div class="ios-update-nav">
        <span>General</span>
        <strong>Software Update</strong>
        <span></span>
      </div>
      <div class="ios-setting-row">
        <span>Automatic Updates</span>
        <strong>On</strong>
      </div>
      <article class="ios-update-card">
        <div class="update-app-icon">RP</div>
        <div>
          <h2>RP Command Update</h2>
          <p class="muted small">Server maintenance mode</p>
        </div>
        <p>${escapeHtml(updateLockdownMessage())}</p>
        <div class="update-progress"><span></span></div>
        <p class="muted small">Available during update: ${hasDmv ? "Driver License" : ""}${hasDmv && hasMdt ? " and " : ""}${hasMdt ? "LEO MDT" : ""}${!allowed.length ? "No actions available for this account" : ""}.</p>
      </article>
      <div class="update-action-list">
        ${allowed.map((item) => `
          <button class="ios-update-action" data-open-app="${item.id}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${item.id === "dmv" ? "Open Driver License" : item.id === "mdt" ? "Open MDT" : "Open"}</strong>
          </button>
        `).join("") || `<div class="empty">No available update-mode actions</div>`}
      </div>
    </section>
  `;
}

function bindHome() {
  $$("[data-open-app]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeApp = button.dataset.openApp;
      if (isUpdateLockdown() && state.activeApp === "dmv") {
        state.dmvTab = "license";
      }
      await loadAppData(state.activeApp);
      render();
    });
  });
  $("[data-logout]")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.session = { user: null, apps: [] };
    state.activeApp = null;
    render();
  });
}

function renderPanel(id) {
  const titles = {
    profile: "Profile",
    "getting-started": "Getting Started",
    dmv: "DMV",
    jobs: "Jobs",
    "my-faircroft": "MyFaircroft",
    court: "Court",
    properties: "Properties",
    cash: "Cash App",
    bank: "Bank",
    restriction: "Restriction Notice",
    treasury: "Faircroft Treasury",
    business: "Business",
    messages: "Messages",
    contracts: "Contracts",
    changelog: "Changelog",
    mdt: "MDT CAD",
    fire: "Fire MDT",
    "fire-settings": "Fire Settings",
    system: "System",
    "indeed-admin": "Indeed Admin",
    admin: "Admin",
    "dev-tools": "Dev Tools",
    "fine-settlement": "Fine Settlement",
    "beta-tasks": "Beta Tasks",
  };
  const body = {
    profile: renderProfile,
    "getting-started": renderGettingStarted,
    dmv: renderDmv,
    jobs: renderJobs,
    "my-faircroft": renderMyFaircroft,
    court: renderCourt,
    properties: renderProperties,
    cash: renderCash,
    bank: renderBank,
    restriction: renderRestrictionNotice,
    treasury: renderTreasury,
    business: renderBusiness,
    messages: renderMessages,
    contracts: renderContracts,
    changelog: renderChangelog,
    mdt: renderMdt,
    fire: renderFireMdt,
    "fire-settings": renderFireSettings,
    system: renderSystem,
    "indeed-admin": renderIndeedAdmin,
    admin: renderAdmin,
    "dev-tools": renderDevTools,
    "fine-settlement": renderFineSettlement,
    "beta-tasks": renderBetaTasks,
  }[id]?.() || `<div class="empty">Module unavailable</div>`;

  return `
    <section class="app-panel">
      <header class="panel-top">
        <button class="icon-action" data-close-panel aria-label="Back">${iconSvg.back}</button>
        <h2>${titles[id] || "App"}</h2>
        <button class="icon-action" data-refresh-panel aria-label="Refresh">↻</button>
      </header>
      <div class="panel-body">${body}</div>
    </section>
  `;
}

async function loadAppData(id) {
  const loaders = {
    profile: () => api("/api/profile"),
    dmv: () => api("/api/dmv/me"),
    jobs: () => api("/api/jobs"),
    "my-faircroft": () => api("/api/my-faircroft"),
    court: () => api("/api/court/cases"),
    properties: () => api("/api/properties"),
    bank: () => api("/api/bank"),
    treasury: () => api("/api/treasury"),
    business: () => api("/api/business"),
    messages: () => api("/api/messages"),
    contracts: () => api("/api/contracts"),
    changelog: () => api("/api/changelog"),
    roadmap: () => api("/api/roadmap"),
    mdt: async () => {
      const data = {
        charges: await api("/api/mdt/charges"),
        alerts: await api("/api/mdt/alerts"),
        reports: await api("/api/mdt/reports"),
        bookings: await optionalApi("/api/mdt/bookings", { active: [], recent: [], stats: { active: 0, today: 0, released: 0 } }),
        bolos: await optionalApi("/api/mdt/bolos", { active: [], recent: [] }),
        cid: mdtCommandEnabled() ? await api("/api/cid/overview") : null,
        search: state.cache.mdt?.search || []
      };
      if (data.cid && state.mdtTab === "search" && !data.search.length) {
        state.mdtTab = "cid-command";
      }
      return data;
    },
    fire: () => api("/api/fire/overview"),
    "fire-settings": () => api("/api/fire/overview"),
    system: () => api("/api/system/settings"),
    "indeed-admin": () => api("/api/indeed-admin/applications"),
    "dev-tools": () => api("/api/dev-tools"),
    "fine-settlement": () => api("/api/fine-settlement"),
    "beta-tasks": () => api("/api/beta/tasks"),
    admin: async () => ({
      overview: await api("/api/admin/overview"),
      users: await api("/api/admin/users"),
      referrals: await api("/api/admin/referrals"),
      applications: await api("/api/admin/department-applications"),
      jobs: await api("/api/admin/jobs"),
    }),
  };
  if (loaders[id]) {
    try {
      state.cache[id] = await loaders[id]();
    } catch (error) {
      toast(error.message);
    }
  }
}

function renderRestrictionNotice() {
  const sanction = state.session?.sanction || {};
  const expires = sanction.expires_at ? new Date(sanction.expires_at) : null;
  const expiryText = expires && !Number.isNaN(expires.getTime()) ? expires.toLocaleString() : "Pending staff review";
  const bail = Number(sanction.bail_amount || 0);
  return `
    <div class="stack restriction-notice">
      <section class="profile-hero restriction-hero">
        <div>
          <p class="eyebrow">Temporary account restriction</p>
          <h3>Limited Access Active</h3>
          <p>Your account remains available for Profile, Bank, and this notice.</p>
        </div>
        <span class="pill amber">TIMEOUT</span>
      </section>
      <section class="profile-link-card">
        <div class="restriction-detail"><span>Reason</span><strong>${escapeHtml(sanction.reason || "No public reason supplied")}</strong></div>
        <div class="restriction-detail"><span>Report</span><strong>${escapeHtml(sanction.report_number || "Not available")}</strong></div>
        <div class="restriction-detail"><span>Restriction ends</span><strong>${escapeHtml(expiryText)}</strong></div>
        <div class="restriction-detail"><span>Bail amount</span><strong>${bail > 0 ? money(bail) : "No bail set"}</strong></div>
      </section>
      <section class="profile-link-card">
        <h3>How access is restored</h3>
        <p>${bail > 0 ? `A friend may arrange payment of ${money(bail)} with Faircroft staff on your behalf. Staff must confirm payment and release the restriction.` : "No bail amount was assigned. You must serve the timeout or contact staff if you believe it was issued incorrectly."}</p>
        <p class="muted small">Otherwise, serve the full timeout. Access returns automatically after the listed expiration time.</p>
      </section>
    </div>`;
}

function bindPanel() {
  $("[data-close-panel]")?.addEventListener("click", async () => {
    if (state.returnToMdtOnClose && state.activeApp === "messages") {
      state.returnToMdtOnClose = false;
      state.activeApp = "mdt";
      await loadAppData("mdt");
      render();
      return;
    }
    state.activeApp = null;
    state.returnToMdtOnClose = false;
    await loadSession();
  });
  $("[data-refresh-panel]")?.addEventListener("click", async () => {
    await loadAppData(state.activeApp);
    render();
  });

  const binders = {
    profile: bindProfile,
    dmv: bindDmv,
    jobs: bindJobs,
    "my-faircroft": bindMyFaircroft,
    court: bindCourt,
    properties: bindProperties,
    cash: bindCash,
    bank: bindBank,
    treasury: bindTreasury,
    business: bindBusiness,
    messages: bindMessages,
    contracts: bindContracts,
    mdt: bindMdt,
    fire: bindFireMdt,
    "fire-settings": bindFireSettings,
    system: bindSystem,
    "indeed-admin": bindIndeedAdmin,
    admin: bindAdmin,
    "dev-tools": bindDevTools,
    "fine-settlement": bindFineSettlement,
    "beta-tasks": bindBetaTasks,
  };
  binders[state.activeApp]?.();
}

function can(role) {
  return state.session?.user?.roles?.includes(role);
}

function canAny(...roles) {
  return roles.some((role) => can(role));
}

function canUseMdtMessages() {
  return Boolean(state.session?.user?.verified) || can("admin") || can("owner");
}

function isIUUser() {
  return canAny("iu", "iu_director");
}

function mdtCommandEnabled() {
  return canAny("cid", "cid_director", "iu", "iu_director");
}

function mdtCommandLabel() {
  if (canAny("iu_director")) return "IU Director";
  if (canAny("iu")) return "IU";
  if (canAny("cid_director")) return "CID Director";
  if (canAny("cid")) return "CID";
  return "LEO";
}

const TRAFFIC_STOP_STEPS = [
  {
    key: "observe",
    title: "Observe and decide",
    callout: "Reason for stop",
    body: "Confirm the traffic violation or reasonable suspicion before activating lights. Note vehicle description, plate, location, direction of travel, occupants, and any safety concerns.",
  },
  {
    key: "radio",
    title: "Radio the stop",
    callout: "Document the stop",
    body: "Record the location/postal, vehicle description, plate if visible, reason for stop, and occupant count before contact.",
  },
  {
    key: "position",
    title: "Position and approach",
    callout: "Officer safety",
    body: "Park safely, offset behind the vehicle, watch occupants, and choose driver-side or passenger-side approach based on scene conditions. Keep the interaction professional and calm.",
  },
  {
    key: "documents",
    title: "Introduce and request documents",
    callout: "Contact script",
    body: "Identify yourself, department, and reason for the stop. Request driver license, registration, and insurance. Ask clear questions without escalating the scene unnecessarily.",
  },
  {
    key: "ncic",
    title: "Run NCIC / DMV",
    callout: "Records check",
    body: "Return to the MDT and run the driver and vehicle through NCIC/DMV. Check license status, warrants, vehicle registration, insurance, prior citations, and officer safety notes.",
  },
  {
    key: "outcome",
    title: "Decide outcome",
    callout: "Enforcement action",
    body: "Choose warning, citation, further investigation, arrest, or release based on RP facts and server protocol. If writing a ticket, use the MDT citation writer and court date workflow.",
  },
  {
    key: "arrest",
    title: "Arrest protocol",
    callout: "Custody sequence",
    body: "If the stop becomes an arrest or criminal offense, slow the scene down: call backup or a supervisor when needed, secure the driver, document probable cause, and route charges through the criminal writer.",
  },
  {
    key: "close",
    title: "Close and document",
    callout: "Clear the stop",
    body: "Explain the outcome to the driver, return documents when appropriate, and file an after-action report if the stop became an incident, pursuit, arrest, or use-of-force event.",
  },
];

function isUpdateLockdown() {
  return Boolean(state.session?.system?.update_lockdown_enabled);
}

function updateLockdownMessage() {
  return state.session?.system?.update_lockdown_message || "System update in progress. Driver License and LEO MDT remain available.";
}

function appAvailable(id) {
  return Boolean((state.session?.apps || []).find((item) => item.id === id && item.enabled));
}

async function optionalApi(path, fallback) {
  try {
    return await api(path);
  } catch (error) {
    console.warn(`Optional request failed: ${path}`, error);
    return fallback;
  }
}

function normalizedRole(role) {
  const clean = String(role || "").trim().toLowerCase().replaceAll("-", "_").replace(/\s+/g, "_");
  const aliases = {
    chief: "fire_chief",
    cheif: "fire_chief",
    firechief: "fire_chief",
    fire_cheif: "fire_chief",
    fd_chief: "fire_chief",
    fire_marshall: "fire_marshal",
  };
  return aliases[clean] || clean;
}

function hasFireCommandAccess() {
  const roles = (state.session?.user?.roles || []).map(normalizedRole);
  return roles.some((role) => ["owner", "fire_chief", "deputy_chief", "fire_marshal"].includes(role));
}

function renderProfile() {
  const data = state.cache.profile || {};
  const user = data.user || state.session.user;
  const link = data.arma_link;
  const activity = data.recent_activity || [];
  const claimedCodes = data.claimed_codes || [];
  const characters = data.characters || [];
  const activeCharacter = data.active_character || characters.find((item) => item.is_active) || {};
  const nameChange = data.name_change || { locked: false, used: 0, limit: 3, remaining: 3, window_days: 3 };
  const nameChangeBlocked = nameChange.locked || Number(nameChange.remaining || 0) <= 0;
  const nameChangeLabel = nameChange.locked ? "locked" : `${nameChange.remaining}/${nameChange.limit} left`;
  const referrals = data.referrals || { code: user.referral_code || "", bonus_amount: 50000, count: 0, total_bonus: 0, pending_count: 0, pending_total: 0, recent: [] };
  const canSetCallsign = canAny("owner", "admin", "leo", "cid", "iu", "iu_director", "sheriff", "police", "metro_police_chief", "state_police", "state_police_commander", "fireman", "ems", "dispatcher", "fire_chief", "deputy_chief", "fire_marshal");
  return `
    <div class="stack profile-app">
      <div class="profile-hero">
        <div>
          <p class="eyebrow">Player profile</p>
          <h3>${escapeHtml(user.name)}</h3>
          <p>CIV ${escapeHtml(user.civ_number || "pending")} - ${escapeHtml(user.verified ? "verified" : "pending verification")}</p>
        </div>
        <span class="pill ${user.verified ? "green" : "amber"}">${user.verified ? "verified" : "pending"}</span>
      </div>
      <div class="profile-grid">
        <div><span>Email</span><strong>${escapeHtml(user.email || state.session.user.email || "")}</strong></div>
        <div><span>Roles</span><strong>${escapeHtml((user.roles || state.session.user.roles || []).join(", "))}</strong></div>
        <div><span>Agency</span><strong>${escapeHtml(user.primary_agency || "Civilian")}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(user.verified ? "Verified civilian" : "Awaiting verification")}</strong></div>
        <div><span>Car Entry Code</span><strong>${escapeHtml(user.car_entry_code || "Required")}</strong></div>
        ${canSetCallsign ? `<div><span>Callsign</span><strong>${escapeHtml(user.callsign || "Not set")}</strong></div>` : ""}
        <div><span>Referral Code</span><strong>${escapeHtml(referrals.code || "Generating")}</strong></div>
        <div><span>Live Link</span><strong>${escapeHtml(link ? "Attached" : "Not attached")}</strong></div>
      </div>
      <section class="profile-link-card referral-card">
        <div class="row">
          <div>
            <p class="eyebrow">Referral program</p>
            <h3>In-game referral reward</h3>
            <p class="muted small">Share your code with a new player. Staff may review the referral and apply any approved reward through the in-game economy.</p>
          </div>
          <span class="pill ${Number(referrals.pending_count || 0) ? "amber" : "green"}">${Number(referrals.pending_count || 0)} pending</span>
        </div>
        <div class="referral-copy-grid">
          <div class="referral-code-box">
            <span>Your code</span>
            <strong>${escapeHtml(referrals.code || "Generating")}</strong>
          </div>
          <button class="secondary" type="button" data-copy-referral="${escapeHtml(referrals.code || "")}" ${referrals.code ? "" : "disabled"}>Copy code</button>
        </div>
        <div class="profile-grid compact">
          <div><span>Deposited</span><strong>${money(referrals.total_bonus || 0)}</strong></div>
          <div><span>Pending tickets</span><strong>${money(referrals.pending_total || 0)}</strong></div>
          <div><span>Referral count</span><strong>${Number(referrals.count || 0)}</strong></div>
          ${referrals.referred_by ? `<div><span>You were referred by</span><strong>${escapeHtml(referrals.referred_by.name || "Another player")}</strong></div>` : ""}
        </div>
        ${(referrals.recent || []).length ? `
          <div class="referral-recent">
            ${(referrals.recent || []).map((item) => `
              <div class="row">
                <span>${escapeHtml(item.referred_name || "New civilian")} / ${escapeHtml(item.status || "pending")}</span>
                <strong>${money(item.bonus_amount)}</strong>
              </div>
            `).join("")}
          </div>
        ` : ""}
      </section>
      <section class="profile-link-card">
        <div class="row">
          <div>
            <p class="eyebrow">In-game vehicle access</p>
            <h3>Car Entry Code</h3>
            <p class="muted small">Officers will see this code when they pull your NCIC/DMV profile.</p>
          </div>
          <span class="pill ${user.car_entry_code ? "green" : "red"}">${user.car_entry_code ? "filed" : "required"}</span>
        </div>
        <form id="carEntryCodeForm" class="form-grid car-entry-form">
          <label>Car entry code<input name="car_entry_code" value="${escapeHtml(user.car_entry_code || "")}" maxlength="32" pattern="[A-Za-z0-9_-]{2,32}" placeholder="In-game vehicle access code" required /></label>
          <button class="secondary" type="submit">Save car entry code</button>
        </form>
      </section>
      ${canSetCallsign ? `
        <section class="profile-link-card">
          <div class="row">
            <div>
              <p class="eyebrow">Radio identity</p>
              <h3>Department Callsign</h3>
              <p class="muted small">This optional handle identifies you in department and MDT records.</p>
            </div>
            <span class="pill ${user.callsign ? "green" : "red"}">${user.callsign ? "set" : "missing"}</span>
          </div>
          <form id="callsignForm" class="form-grid">
            <label>Callsign<input name="callsign" value="${escapeHtml(user.callsign || "")}" maxlength="24" pattern="[A-Za-z0-9_-]{2,24}" placeholder="UNIT-1, ALPHA-2, etc" required /></label>
            <button class="secondary" type="submit">Save callsign</button>
          </form>
        </section>
      ` : ""}
      <section class="profile-link-card character-manager">
        <div class="row">
          <div>
            <p class="eyebrow">Character roster</p>
            <h3>${escapeHtml(activeCharacter.character_name || user.name)}</h3>
            <p class="muted small">Active RP identity. Name changes are limited to ${nameChange.limit} inside ${nameChange.window_days} days.</p>
          </div>
          <span class="pill ${nameChangeBlocked ? "amber" : "green"}">${escapeHtml(nameChangeLabel)}</span>
        </div>
        ${nameChange.locked ? `<div class="home-alert compact-alert">${iconSvg.lock}<div><strong>Name changes locked</strong><p>An owner/admin must unlock this account before the active character name can be changed again.</p></div></div>` : ""}
        <form id="profileNameForm" class="form-grid">
          <label>Active character name<input name="name" value="${escapeHtml(activeCharacter.character_name || user.name)}" maxlength="80" ${nameChangeBlocked ? "disabled" : ""} required /></label>
          <button class="secondary" type="submit" ${nameChangeBlocked ? "disabled" : ""}>Change active name</button>
        </form>
        <div class="character-list">
          ${characters.map((character) => `
            <article class="character-row ${character.is_active ? "active" : ""}">
              <div>
                <strong>${escapeHtml(character.character_name)}</strong>
                <p>${escapeHtml(character.biography || (character.is_active ? "Active character" : "Saved character"))}</p>
              </div>
              <button class="secondary compact-action" type="button" data-activate-character="${character.id}" ${character.is_active ? "disabled" : ""}>${character.is_active ? "Active" : "Use"}</button>
            </article>
          `).join("") || `<div class="empty">No characters yet</div>`}
        </div>
        <form id="characterCreateForm" class="form-grid character-create-form">
          <div>
            <h3>Create character</h3>
            <p class="muted small">New characters are saved to this account and become the active RP identity.</p>
          </div>
          <label>Character name<input name="character_name" maxlength="80" placeholder="First Last" required /></label>
          <label>Character notes<textarea name="biography" maxlength="800" placeholder="Optional backstory, faction, or RP notes"></textarea></label>
          <button class="primary" type="submit">Create and use</button>
        </form>
      </section>
      <section class="profile-link-card">
        <div class="row">
          <div>
            <p class="eyebrow">Arma attachment</p>
            <h3>${link ? "Account attached" : "Attach in-game account"}</h3>
          </div>
          <span class="pill ${link ? "green" : "amber"}">${link ? "linked" : "pending"}</span>
        </div>
        ${link ? `
          <div class="profile-grid compact">
            <div><span>Player</span><strong>${escapeHtml(link.player_name || "Unknown")}</strong></div>
            <div><span>Server</span><strong>${escapeHtml(link.server_id || "default")}</strong></div>
            <div><span>Identity</span><strong>${escapeHtml(link.identity_id || "Not provided")}</strong></div>
            <div><span>Last sync</span><strong>${escapeHtml(link.last_sync_at || link.linked_at || "Awaiting sync")}</strong></div>
          </div>
          <button class="danger" type="button" data-open-arma-unlink>Unlink Arma Account</button>
          ${state.armaUnlinkOpen ? `
            <div class="modal-backdrop" data-close-arma-unlink>
              <section class="mdt-modal force-code-modal" role="dialog" aria-modal="true" aria-label="Developer Arma unlink">
                <header class="row">
                  <div><p class="eyebrow">Development use only</p><h2>Unlink Arma Account</h2></div>
                  <button class="icon-action" type="button" data-close-arma-unlink aria-label="Close">${iconSvg.back}</button>
                </header>
                <div class="home-alert compact-alert">
                  ${iconSvg.shield}
                  <div>
                    <strong>Server engineer guidance required</strong>
                    <p>Unlinking is for development reasons only. A developer must generate a specialized one-time code for this action.</p>
                  </div>
                </div>
                <form id="armaUnlinkForm" class="form-grid arma-unlink-form">
                  <label>Developer unlink code<input name="dev_code" placeholder="DEV-XXXX-XXXX" autocomplete="off" required /></label>
                  <label class="checkbox-row">
                    <input name="acknowledge" type="checkbox" required />
                    <span>I understand this removes my live Arma account link.</span>
                  </label>
                  <button class="danger" type="submit">Confirm Development Unlink</button>
                </form>
              </section>
            </div>
          ` : ""}
        ` : `
          <p class="muted small">Enter the in-game link code shown by TBS RP LINKING SYSTEM after joining the server.</p>
          <form id="armaLinkForm" class="form-grid arma-link-form">
            <label>Link code<input name="code" value="${escapeHtml(state.pendingArmaCode)}" placeholder="1-145595" autocomplete="one-time-code" inputmode="text" required /></label>
            <button class="primary" type="submit">Attach Account</button>
          </form>
        `}
      </section>
      ${claimedCodes.length ? `
        <section class="profile-activity">
          <div class="row"><h3>Recent link claims</h3><span class="pill green">${claimedCodes.length}</span></div>
          <div class="profile-grid compact">
            ${claimedCodes.map((item) => `
              <div><span>${escapeHtml(item.server_id || "default")}</span><strong>${escapeHtml(item.player_name || item.code)}</strong></div>
            `).join("")}
          </div>
        </section>
      ` : ""}
      ${activity.length ? `
        <section class="profile-activity">
          <div class="row"><h3>Arma activity</h3><span class="pill">${activity.length}</span></div>
          <div class="list">
            ${activity.slice(0, 5).map((item) => `
              <article>
                <strong>${escapeHtml(item.action || item.event_type || "Activity")}</strong>
                <p>${escapeHtml(item.reason || item.source_system || item.received_at || "")}</p>
              </article>
            `).join("")}
          </div>
        </section>
      ` : ""}
    </div>
  `;
}

async function saveCarEntryCodeFromForm(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  const result = await api("/api/profile/car-entry-code", { method: "POST", body: payload });
  state.session.user = result.user;
  if (state.cache.profile?.user) {
    state.cache.profile.user = { ...state.cache.profile.user, ...result.user };
  }
  return result;
}

async function saveCallsignFromForm(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  const result = await api("/api/profile/callsign", { method: "POST", body: payload });
  state.session.user = result.user;
  if (state.cache.profile?.user) {
    state.cache.profile.user = { ...state.cache.profile.user, ...result.user };
  }
  return result;
}

function bindProfile() {
  $$("[data-copy-referral]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await copyToClipboard(button.dataset.copyReferral);
      toast("Referral code copied");
    } catch {
      toast("Could not copy referral code");
    }
  }));
  $("#carEntryCodeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveCarEntryCodeFromForm(event.currentTarget);
      toast("Car entry code saved");
      await loadAppData("profile");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#callsignForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveCallsignFromForm(event.currentTarget);
      toast("Callsign saved");
      await loadAppData("profile");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#profileNameForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api("/api/profile/name", { method: "POST", body: payload });
      toast("Character name updated");
      await loadAppData("profile");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#characterCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api("/api/profile/characters", { method: "POST", body: payload });
      form.reset();
      toast("Character created");
      await loadAppData("profile");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-activate-character]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/profile/characters/${button.dataset.activateCharacter}/activate`, { method: "POST" });
      toast("Character activated");
      await loadAppData("profile");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#armaLinkForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await api("/api/profile/link-arma", { method: "POST", body: payload });
      toast("Arma account attached");
      state.pendingArmaCode = "";
      if (window.location.search.includes("code=")) {
        window.history.replaceState({}, "", "/");
      }
      await loadAppData("profile");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $("[data-open-arma-unlink]")?.addEventListener("click", () => {
    state.armaUnlinkOpen = true;
    render();
  });
  $$("[data-close-arma-unlink]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.armaUnlinkOpen = false;
    render();
  }));
  $("#armaUnlinkForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const acknowledge = form.querySelector('[name="acknowledge"]');
    if (!acknowledge?.checked) {
      toast("Confirm the development-use warning before unlinking");
      return;
    }
    const confirmed = window.confirm(
      "Development use only: unlink this Arma account with server engineer guidance?"
    );
    if (!confirmed) return;
    try {
      const devCode = String(new FormData(form).get("dev_code") || "").trim().toUpperCase();
      await api("/api/profile/unlink-arma", {
        method: "POST",
        body: { confirmation: "UNLINK FOR DEVELOPMENT", dev_code: devCode },
      });
      toast("Arma account unlinked for development");
      state.armaUnlinkOpen = false;
      state.armaLinkPromptDismissed = false;
      await loadAppData("profile");
      await loadSession();
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderGettingStarted() {
  const steps = [
    {
      number: "01",
      title: "Spawn In & Get a Vehicle",
      location: "Airport / Used Car Dealership",
      image: "/static/getting-started/used-cars.jpg",
      body: "When you first join the server, you spawn at the airport. Your first priority should be getting transportation. Head to the used car dealership and buy a vehicle as soon as possible so you can move around the city, take jobs, and start making money.",
      note: "Make sure your character is created in the online CAD profile system.",
    },
    {
      number: "02",
      title: "Military Base Fishing",
      location: "Military Base / Dirty Pond",
      image: "/static/getting-started/dirty-pond.jpg",
      body: "Go to the Military Base on the map and head to the pond area called the Dirty Pond. In this spot you can go into the water, collect sticks, and sell them to make early money.",
      note: "This is a starter grind spot and works best once you have a vehicle.",
    },
    {
      number: "03",
      title: "Visit the Bag Store",
      location: "Bag Store near Police Station",
      image: "/static/getting-started/bag-store.jpg",
      body: "After getting your vehicle, head to the Bag Store and buy bags. Bags increase inventory space, which lets you carry more items while looting, working, or grinding money.",
      note: "More bag space means fewer trips back and forth.",
    },
    {
      number: "04",
      title: "Buy Your IL License",
      location: "Town Hall",
      image: "/static/getting-started/townhall.jpg",
      body: "Go to Town Hall and buy your IL license. This license is used for mining so you can start progressing toward better money routes.",
      note: "Do this before going all-in on mining.",
    },
    {
      number: "05",
      title: "Start Mining",
      location: "Mining Area / Hardware Store",
      image: "/static/getting-started/hardware-store.jpg",
      body: "Go to the mining area on the map where the ore is located in the middle of the castle. The ore you want is iron. To mine it, buy the required tool from the hardware store for 7.5k.",
      note: "Buy the tool first, then head to the iron mining location.",
    },
  ];
  return `
    <div class="getting-started-app">
      <section class="getting-started-hero">
        <div>
          <p class="eyebrow">Civilian starter guide</p>
          <h3>Getting Started</h3>
          <p>Follow this route after spawning to get mobile, expand inventory space, unlock mining, and begin earning money.</p>
        </div>
        <a class="secondary" href="https://forcraftrp.up.railway.app/" target="_blank" rel="noopener">Open CAD</a>
      </section>
      <div class="starter-route">
        ${steps.map((step) => `
          <article class="starter-step-card">
            <img src="${step.image}" alt="${escapeHtml(step.location)} map location" loading="lazy" />
            <div class="starter-step-body">
              <div class="starter-step-head">
                <span>${step.number}</span>
                <div>
                  <h3>${escapeHtml(step.title)}</h3>
                  <p>${escapeHtml(step.location)}</p>
                </div>
              </div>
              <p>${escapeHtml(step.body)}</p>
              <div class="starter-note">${escapeHtml(step.note)}</div>
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function isPendingLicenseApplication(item) {
  return ["submitted", "pending", "under_review"].includes(item?.status);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutesLeft = Math.floor(total / 60);
  const secs = total % 60;
  if (minutesLeft >= 60) {
    const hours = Math.floor(minutesLeft / 60);
    const mins = minutesLeft % 60;
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }
  return `${minutesLeft}m ${String(secs).padStart(2, "0")}s`;
}

function pendingLicenseCountdown(item, settings) {
  const totalSeconds = Math.max(60, Number(settings?.minutes || 6) * 60);
  const approvalAt = item?.approval_at ? new Date(item.approval_at).getTime() : 0;
  const remainingSeconds = approvalAt ? Math.max(0, Math.ceil((approvalAt - Date.now()) / 1000)) : Number(item?.approval_remaining_seconds || totalSeconds);
  const pct = Math.max(0, Math.min(100, Math.round(((totalSeconds - remainingSeconds) / totalSeconds) * 100)));
  return { remainingSeconds, totalSeconds, pct, approvalAt };
}

function renderDmvApprovalTracker(applications, settings) {
  const pending = applications.find((item) => isPendingLicenseApplication(item));
  const latest = applications[0];
  if (pending) {
    const countdown = pendingLicenseCountdown(pending, settings);
    return `
      <section class="dmv-approval-card">
        <div class="row">
          <div>
            <p class="eyebrow">DMV approval queue</p>
            <h3>${escapeHtml(pending.application_type)}</h3>
            <p class="muted small">${escapeHtml(pending.license_class)} filed ${new Date(pending.created_at).toLocaleString()}</p>
          </div>
          <span class="pill amber">${escapeHtml(pending.status)}</span>
        </div>
        ${settings?.enabled ? `
          <div class="approval-countdown">
            <span>Estimated approval</span>
            <strong data-dmv-countdown-target="${escapeHtml(pending.approval_at)}">${formatDuration(countdown.remainingSeconds)}</strong>
          </div>
          <div class="progress approval-progress" style="--pct:${countdown.pct}%"><span></span></div>
          <p class="muted small">Owner DMV autopilot is set to approve licenses after ${Number(settings.minutes || 6)} minutes.</p>
        ` : `
          <p class="muted small">DMV auto approval is paused by owner settings. Your application is still saved.</p>
        `}
      </section>
    `;
  }
  if (latest?.status === "approved") {
    return `
      <section class="dmv-approval-card approved">
        <div class="row">
          <div>
            <p class="eyebrow">DMV approval complete</p>
            <h3>${escapeHtml(latest.application_type)}</h3>
            <p class="muted small">${escapeHtml(latest.license_class)} approved ${new Date(latest.updated_at || latest.created_at).toLocaleString()}</p>
          </div>
          <span class="pill green">approved</span>
        </div>
      </section>
    `;
  }
  return `
    <section class="dmv-approval-card">
      <p class="eyebrow">DMV approval queue</p>
      <h3>No pending application</h3>
      <p class="muted small">Submit a driver license application to start the approval countdown.</p>
    </section>
  `;
}

function renderDmv() {
  const data = state.cache.dmv;
  const record = data?.record;
  if (!record) return `<div class="empty">DMV record loading</div>`;
  const vehicles = data.vehicles || [];
  const applications = data.license_applications || [];
  const licenseAutopilot = data.license_autopilot || { enabled: true, minutes: 6 };
  const activeVehicle = vehicles[0] || record;
  const lockdown = isUpdateLockdown();
  if (lockdown && state.dmvTab !== "license") {
    state.dmvTab = "license";
  }
  return `
    <div class="stack">
      ${lockdown ? `
        <section class="update-lockdown-mini">
          <p class="eyebrow">Software Update</p>
          <h3>Driver License remains available</h3>
          <p class="muted small">${escapeHtml(updateLockdownMessage())}</p>
        </section>
      ` : `
        <div class="segmented">
          <button class="${state.dmvTab === "overview" ? "active" : ""}" data-dmv-tab="overview">Overview</button>
          <button class="${state.dmvTab === "license" ? "active" : ""}" data-dmv-tab="license">License</button>
          <button class="${state.dmvTab === "vehicles" ? "active" : ""}" data-dmv-tab="vehicles">Vehicles</button>
        </div>
      `}
      ${state.dmvTab === "license" ? renderDmvLicense(applications, licenseAutopilot) : state.dmvTab === "vehicles" ? renderDmvVehicles(vehicles, record) : renderDmvOverview(record, vehicles, applications, activeVehicle)}
    </div>
  `;
}

function renderDmvOverview(record, vehicles, applications, activeVehicle) {
  return `
    <div class="stack">
      <div class="record-card">
        <p class="eyebrow">Driver profile</p>
        <h3>${escapeHtml(state.session.user.name)}</h3>
        <div class="grid-2">
          <div class="metric"><span>License</span><strong>${escapeHtml(record.license_status)}</strong></div>
          <div class="metric"><span>Class</span><strong>${escapeHtml(record.license_class)}</strong></div>
          <div class="metric"><span>Plate</span><strong>${escapeHtml(record.plate)}</strong></div>
          <div class="metric"><span>Insurance</span><strong>${escapeHtml(record.insurance_status)}</strong></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="metric"><span>Vehicles</span><strong>${vehicles.length}</strong></div>
        <div class="metric"><span>Applications</span><strong>${applications.length}</strong></div>
      </div>
      <article class="record-card">
        <div class="row"><h3>Primary vehicle</h3><span class="pill green">${escapeHtml(activeVehicle.registration_status || "Active")}</span></div>
        <p class="muted small">${escapeHtml([activeVehicle.vehicle_year, activeVehicle.vehicle_color, activeVehicle.vehicle_make, activeVehicle.vehicle_model].filter(Boolean).join(" ")) || "No registered vehicle yet"}</p>
        <div class="grid-2">
          <div class="metric"><span>Plate</span><strong>${escapeHtml(activeVehicle.plate || "None")}</strong></div>
          <div class="metric"><span>Insurance</span><strong>${escapeHtml(activeVehicle.insurance_status || "Pending")}</strong></div>
        </div>
      </article>
      <div class="card">
        <div class="row"><h3>Recent applications</h3><button class="secondary" data-dmv-tab="license">Apply</button></div>
        <div class="list">
          ${applications.slice(0, 3).map((item) => `
            <div class="row"><span>${escapeHtml(item.application_type)} · ${escapeHtml(item.license_class)}</span><span class="pill ${item.status === "approved" ? "green" : "amber"}">${escapeHtml(item.status)}</span></div>
          `).join("") || `<div class="empty">No license applications yet</div>`}
        </div>
      </div>
    </div>
  `;
}

function renderDmvLicense(applications, settings) {
  return `
    <div class="stack">
      ${renderDmvApprovalTracker(applications, settings)}
      <form id="dmvLicenseForm" class="card form-grid">
        <div class="grid-2">
          <label>Application type<select name="application_type" required>
            <option>New Driver License</option>
            <option>License Renewal</option>
            <option>Motorcycle Endorsement</option>
            <option>Commercial License Permit</option>
            <option>Replacement License</option>
          </select></label>
          <label>Class<select name="license_class" required>
            <option>Class D</option>
            <option>Class M</option>
            <option>Class A CDL</option>
            <option>Class B CDL</option>
            <option>Class C CDL</option>
          </select></label>
        </div>
        <label>Legal name<input name="legal_name" value="${escapeHtml(state.session.user.name)}" required /></label>
        <label>Date of birth<input name="date_of_birth" type="date" required /></label>
        <label>Notes<textarea name="notes" placeholder="Medical restrictions, endorsements, or DMV notes"></textarea></label>
        <button class="primary" type="submit">Submit application</button>
      </form>
      <div class="list">
        ${applications.map((item) => `
          <article class="message-card">
            <div class="row"><h3>${escapeHtml(item.application_type)}</h3><span class="pill ${item.status === "approved" ? "green" : "amber"}">${escapeHtml(item.status)}</span></div>
            <p class="muted small">${escapeHtml(item.license_class)} · filed ${new Date(item.created_at).toLocaleDateString()}</p>
            <p>${escapeHtml(item.notes || "No additional notes")}</p>
          </article>
        `).join("") || `<div class="empty">No license applications filed</div>`}
      </div>
    </div>
  `;
}

function renderDmvVehicles(vehicles, record) {
  return `
    <div class="stack">
      <form id="dmvVehicleForm" class="card form-grid">
        <div class="grid-2">
          <label>Year<input name="vehicle_year" type="number" min="1900" max="2100" required /></label>
          <label>Plate<input name="plate" value="${escapeHtml(record.plate || "")}" maxlength="12" required /></label>
        </div>
        <div class="grid-2">
          <label>Make<input name="vehicle_make" value="${escapeHtml(record.vehicle_make === "Unregistered" ? "" : record.vehicle_make)}" required /></label>
          <label>Model<input name="vehicle_model" value="${escapeHtml(record.vehicle_model === "Vehicle" ? "" : record.vehicle_model)}" required /></label>
        </div>
        <div class="grid-2">
          <label>Color<input name="vehicle_color" value="${escapeHtml(record.vehicle_color === "Gray" ? "" : record.vehicle_color)}" required /></label>
          <label>Insurance<select name="insurance_status" required><option>Active</option><option>Pending Verification</option><option>Expired</option></select></label>
        </div>
        <p class="muted small">VIN will be generated automatically by DMV records.</p>
        <button class="primary" type="submit">Register vehicle</button>
      </form>
      <div class="list">
        ${vehicles.map((vehicle) => `
          <article class="property-card">
            <div class="row"><h3>${escapeHtml(vehicle.vehicle_year)} ${escapeHtml(vehicle.vehicle_make)} ${escapeHtml(vehicle.vehicle_model)}</h3><span class="pill green">${escapeHtml(vehicle.registration_status)}</span></div>
            <p class="muted small">${escapeHtml(vehicle.vehicle_color)} · plate ${escapeHtml(vehicle.plate)} · VIN ${escapeHtml(vehicle.vin)}</p>
            <div class="grid-2">
              <div class="metric"><span>Insurance</span><strong>${escapeHtml(vehicle.insurance_status)}</strong></div>
              <div class="metric"><span>Registered</span><strong>${new Date(vehicle.created_at).toLocaleDateString()}</strong></div>
            </div>
          </article>
        `).join("") || `<div class="empty">No registered vehicles</div>`}
      </div>
    </div>
  `;
}

function clearDmvCountdown() {
  if (state.dmvCountdownTimer) {
    clearInterval(state.dmvCountdownTimer);
    state.dmvCountdownTimer = null;
  }
  state.dmvCountdownRefreshing = false;
}

function setupDmvCountdown() {
  clearDmvCountdown();
  const nodes = $$("[data-dmv-countdown-target]");
  if (!nodes.length) return;
  const tick = async () => {
    let expired = false;
    nodes.forEach((node) => {
      const target = new Date(node.dataset.dmvCountdownTarget || "").getTime();
      const remaining = Number.isFinite(target) ? Math.max(0, Math.ceil((target - Date.now()) / 1000)) : 0;
      node.textContent = remaining ? formatDuration(remaining) : "approving...";
      if (remaining <= 0) expired = true;
    });
    if (expired && !state.dmvCountdownRefreshing) {
      state.dmvCountdownRefreshing = true;
      clearDmvCountdown();
      await loadAppData("dmv");
      render();
    }
  };
  tick();
  state.dmvCountdownTimer = setInterval(tick, 1000);
}

function bindDmv() {
  $$("[data-dmv-tab]").forEach((button) => button.addEventListener("click", () => {
    state.dmvTab = button.dataset.dmvTab;
    render();
  }));
  setupDmvCountdown();
  $("#dmvLicenseForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/dmv/license-applications", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("License application submitted");
      await loadAppData("dmv");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#dmvVehicleForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/dmv/vehicles", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Vehicle registered");
      await loadAppData("dmv");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

const lawEnforcementDepartmentChoices = ["Faircroft Sheriff's Office"];
const barExamQuestions = [
  ["Which offense is labeled Assault - Violent Crime with a $1,200 penalty?", ["Criminally negligent homicide", "Assault - Violent Crime", "Robbery in the 3rd degree", "Possession of burglar's tools"]],
  ["Which offense involves physical injury with a deadly weapon or dangerous instrument and carries a $500 penalty?", ["Assault with a deadly weapon (lower degree)", "Murder in the 2nd degree", "Unlawful weapon possession", "Reckless endangerment"]],
  ["Which serious assault carries a $2,500 penalty for serious physical injury by a deadly weapon or depraved-risk conduct?", ["Simple assault", "Aggravated assault on an officer", "Serious assault by deadly weapon", "Criminal facilitation"]],
  ["Which offense is aggravated assault against a police or peace officer with a $5,000 penalty?", ["Assault - Violent Crime", "Aggravated assault upon a police or peace officer", "Robbery in the 1st degree", "Coercion in the 1st degree"]],
  ["Which item is unlawful weapon possession with a $1,500 penalty?", ["WPN-style unlawful weapon possession", "Possession of burglar's tools", "Controlled substance possession", "Failure to identify"]],
  ["Which offense causes death through criminal negligence and carries a $1,000 penalty?", ["Manslaughter in the 2nd degree", "Criminally negligent homicide", "Murder in the 1st degree", "Robbery in the 2nd degree"]],
  ["Which offense carries a $10,000 penalty and involves intentionally causing death or depraved-risk conduct?", ["Manslaughter in the 1st degree", "Murder in the 2nd degree", "Criminal attempt", "Trespass in the 1st degree"]],
  ["Which description best matches Robbery in the 2nd degree with a $2,500 penalty?", ["Forcibly stealing property with no aggravation", "Forcible stealing aided by another present, causing injury, or displaying what appears to be a firearm", "Simple theft below felony threshold", "Possession of burglar's tools"]],
  ["Which offense is rape by forcible compulsion or when the victim is physically helpless and carries a $5,000 penalty?", ["Sexual misconduct", "Rape in the 1st degree", "Consensual sodomy (legacy)", "Criminal solicitation"]],
  ["Which offense is listed as a legacy consensual sodomy offense with a $250 penalty?", ["Sexual misconduct", "Consensual sodomy (legacy)", "Sodomy in the 3rd degree", "Sodomy in the 1st degree"]],
  ["Which item is the Class A misdemeanor carrying a $500 penalty for soliciting felony conduct?", ["Solicitation violation ($150)", "Solicitation for felony conduct ($500)", "Solicitation involving under 16 ($1,000)", "Solicitation for Class A felony ($2,500)"]],
  ["Which facilitation offense applies when someone provides means to help commit a Class A felony and carries a $2,500 penalty?", ["Minor facilitation - $500", "Facilitation involving under 16 - $1,000", "Facilitation for Class A felony - $2,500", "Highest-level facilitation involving under 16 - $5,000"]],
  ["Which conspiracy offense carries a $10,000 penalty for agreeing to commit a Class A felony with a participant under 16?", ["Low-level conspiracy - $250", "Mid-level conspiracy - $1,500", "Conspiracy to commit Class A felony - $5,000", "Conspiracy with under-16 participant - $10,000"]],
  ["Which offense is Trespass in the 2nd degree for unlawfully entering a dwelling with a $500 penalty?", ["Trespass in the 3rd degree (building)", "Trespass in the 2nd degree (dwelling)", "Trespass in the 1st degree (weapon present)", "Burglary in the 3rd degree"]],
  ["Which description best fits Burglary in the 1st degree with a $5,000 penalty?", ["Entering a building to commit any crime", "Burglary of a dwelling involving a deadly weapon, injury, or displayed firearm", "Possession of burglar's tools only", "Simple trespass on enclosed property"]],
  ["Which basic idea describes Coercion in the 1st degree with a $1,500 penalty?", ["Minor annoyance or persuasion", "Using fear of physical injury or property damage to force serious acts", "Friendly suggestion to comply", "Only economic pressure"]],
  ["Reckless Endangerment in the 1st degree shows depraved indifference and carries which penalty?", ["$500", "$1,000", "$1,500", "$5,000"]],
  ["Which item is Controlled Substance Possession listed as a narcotics misdemeanor with a $900 penalty?", ["Controlled substance possession - $900", "Petty theft - $600", "Trespassing property - $450", "Failure to identify - $350"]],
  ["Which traffic citation is Speeding 16-30 Over with a $300 fine and 4 points?", ["Speeding 1-15 Over - $150", "Speeding 16-30 Over - $300", "Speed Not Reasonable and Prudent - $200", "Speed in Zone - $250"]],
  ["Which violation is portable electronic device use while driving with a $200 fine and 5 points?", ["Portable electronic device use - $200 and 5 points", "Seat belt violation - $100", "Vehicle equipment violation - $110", "Speeding 1-15 Over - $150"]],
];
const lawEnforcementApplicationFields = [
  { key: "in_game_name", label: "What is your in-game name?", kind: "text", min: 2, max: 120, placeholder: "Your RP character name" },
  { key: "discord_name", label: "Discord Name", kind: "text", min: 2, max: 120, placeholder: "Discord username" },
  { key: "age", label: "Whats your Age", kind: "age", min: 13, max: 100, placeholder: "Age" },
  { key: "why_law_enforcement", label: "Why do you want to join Law Enforcement", kind: "long", min: 20, max: 4000 },
  { key: "department_choice", label: "Which department do you want to apply for", kind: "choice" },
  { key: "prior_experience", label: "Do you have any prior experience with Law Enforcement on any Rp servers", kind: "long", min: 2, max: 3000 },
  { key: "position_fit", label: "Explain why you would be Good for this position", kind: "long", min: 20, max: 4000 },
  { key: "robbery_scenario", label: "While on duty, you're dispatched to a Gas Station Robbery. Upon arrival, you notice an individual running out the side door towards their vehicle with a knife in their hand. How would you handle this situation?", kind: "long", min: 20, max: 5000 },
  { key: "off_duty_corruption_scenario", label: "While off duty, you are driving around Faircroft, and notice one of your friends, who is a Deputy, in the parking lot with a Citizen. You notice that the Deputy is pulling items out of his Patrol Belt and handing them to the individual. How would you handle this situation?", kind: "long", min: 20, max: 5000 },
  { key: "drug_trafficking_process", label: "While on duty, you detain a suspect for suspected drug trafficking, once you search them you discover the suspect does indeed have Cocaine. How would you process the suspect?", kind: "long", min: 20, max: 5000 },
  { key: "corruption_acknowledgement", label: "Do you understand that any proven corruption within the Faircroft Sheriff Offce may result in termination", kind: "yesno" },
  { key: "procedure_commitment", label: "Do you commit to following the Global Operating Procedures, Division Standard Operating Procedures, and all announcements?", kind: "yesno" },
  { key: "english_communication", label: "Can you communicate clearly using the English language, which is crucial for clear and concise communication across the Sheriff's Office?", kind: "yesno" },
  { key: "chain_of_command", label: "Do you agree to follow chain of command", kind: "yesno" },
  { key: "truth_acknowledgement", label: "Do you acknowledge that falsifying any information on this application will result in an automatic denial and could result in blacklisting", kind: "yesno" },
];

function departmentChoiceForPosting(posting) {
  const map = {
    sheriff: "Faircroft Sheriff's Office",
  };
  return map[posting?.key] || "";
}

function parseDepartmentApplicationStatement(statement) {
  if (!statement || typeof statement !== "string" || !statement.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(statement);
    return ["law_enforcement_application", "bar_exam_application"].includes(parsed?.type) ? parsed : null;
  } catch {
    return null;
  }
}

function renderDepartmentApplicationPreview(application) {
  const record = parseDepartmentApplicationStatement(application?.statement);
  if (!record?.answers?.length) return "";
  return `
    <details class="department-answer-preview">
      <summary>Submitted application answers</summary>
      <div class="department-answer-grid">
        ${record.answers.map((item) => `
          <div>
            <span>${escapeHtml(item.question)}</span>
            <p>${escapeHtml(item.answer)}</p>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderDepartmentApplicationField(field, posting) {
  const defaultName = field.key === "in_game_name" ? state.session?.user?.name || "" : "";
  if (field.kind === "choice") {
    const selected = departmentChoiceForPosting(posting);
    return `
      <label class="application-question">${escapeHtml(field.label)}
        <select name="${field.key}" required>
          <option value="">Select department</option>
          ${lawEnforcementDepartmentChoices.map((choice) => `<option value="${escapeHtml(choice)}" ${choice === selected ? "selected" : ""}>${escapeHtml(choice)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (field.kind === "yesno") {
    return `
      <label class="application-question">${escapeHtml(field.label)}
        <select name="${field.key}" required>
          <option value="">Select answer</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </label>
    `;
  }
  if (field.kind === "age") {
    return `
      <label class="application-question">${escapeHtml(field.label)}
        <input name="${field.key}" type="number" min="${field.min}" max="${field.max}" placeholder="${escapeHtml(field.placeholder || "")}" required />
      </label>
    `;
  }
  if (field.kind === "long") {
    return `
      <label class="application-question application-question-wide">${escapeHtml(field.label)}
        <textarea name="${field.key}" minlength="${field.min}" maxlength="${field.max}" required placeholder="Write your response here"></textarea>
      </label>
    `;
  }
  return `
    <label class="application-question">${escapeHtml(field.label)}
      <input name="${field.key}" minlength="${field.min}" maxlength="${field.max}" value="${escapeHtml(defaultName)}" placeholder="${escapeHtml(field.placeholder || "")}" required />
    </label>
  `;
}

function renderDepartmentApplicationForm(posting) {
  if (posting.form_type === "bar_exam") {
    return `
      <form class="department-application-form bar-exam-form" data-department-key="${escapeHtml(posting.key)}">
        <div class="application-form-head">
          <div><p class="eyebrow">Faircroft Bar Association</p><h3>Bar Exam</h3><p class="muted small">Answer all 20 questions. Your score is delivered privately to the review team.</p></div>
          <span class="pill amber">20 Questions</span>
        </div>
        <div class="bar-applicant-grid">
          <label>In-game name<input name="in_game_name" value="${escapeHtml(state.session?.user?.name || "")}" minlength="2" maxlength="120" required /></label>
          <label>Discord name<input name="discord_name" minlength="2" maxlength="120" required /></label>
        </div>
        <div class="bar-question-list">
          ${barExamQuestions.map(([question, options], index) => `
            <fieldset class="bar-question">
              <legend><span>${index + 1}</span>${escapeHtml(question)}</legend>
              <div class="bar-options">
                ${options.map((option, optionIndex) => {
                  const letter = String.fromCharCode(65 + optionIndex);
                  return `<label><input type="radio" name="bar_q${index + 1}" value="${letter}" required /><strong>${letter}</strong><span>${escapeHtml(option)}</span></label>`;
                }).join("")}
              </div>
            </fieldset>
          `).join("")}
        </div>
        <button class="primary" type="submit">Submit Bar Exam for review</button>
      </form>
    `;
  }
  if (posting.form_type === "law_enforcement") {
    const commandRoles = (posting.command_roles || []).map(humanLabel).join(", ") || "Owner/Admin Command";
    return `
      <form class="department-application-form law-application-form" data-department-key="${escapeHtml(posting.key)}">
        <div class="application-form-head">
          <div>
            <p class="eyebrow">Law enforcement application</p>
            <h3>${escapeHtml(posting.label)} packet</h3>
            <p class="muted small">Complete every required question. This packet is sent to ${escapeHtml(commandRoles)} plus owner/admin staff.</p>
          </div>
          <span class="pill amber">Command Review</span>
        </div>
        <div class="law-application-grid">
          ${lawEnforcementApplicationFields.map((field) => renderDepartmentApplicationField(field, posting)).join("")}
        </div>
        <button class="primary" type="submit">Submit law enforcement application</button>
      </form>
    `;
  }
  return `
    <form class="department-application-form" data-department-key="${escapeHtml(posting.key)}">
      <label>Why should command select you?<textarea name="statement" minlength="20" maxlength="4000" required placeholder="Talk about experience, availability, roleplay style, training history, and why you want this department."></textarea></label>
      <button class="primary" type="submit">Submit application</button>
    </form>
  `;
}

function renderJobs() {
  const data = state.cache.jobs;
  if (!data) return `<div class="empty">Jobs loading</div>`;
  const postings = data.department_postings || [];
  const applications = data.department_applications || [];
  const activeApplications = applications.filter((item) => !["approved", "denied", "withdrawn", "closed"].includes(item.status));
  return `
    <div class="stack jobs-portal">
      <section class="jobs-hero">
        <div>
          <p class="eyebrow">Recruitment board</p>
          <h3>Department Applications</h3>
          <p>Apply for whitelisted RP departments. Command staff will review your application and assign roles if approved.</p>
        </div>
        <div class="jobs-hero-metrics">
          <div><span>Applications</span><strong>${applications.length}</strong></div>
          <div><span>Active</span><strong>${activeApplications.length}</strong></div>
        </div>
      </section>
      <div class="job-ad-board">
        ${postings.map((posting, index) => renderJobAdvertisement(posting, applications, index)).join("") || `<div class="empty">No job advertisements are open</div>`}
      </div>
      <details class="jobs-history" ${applications.length ? "" : ""}>
        <summary><span>My application files</span><strong>${applications.length}</strong></summary>
        <div class="job-application-list">
          ${applications.map((item) => renderJobApplicationFile(item, postings)).join("") || `<div class="empty">No department applications submitted yet</div>`}
        </div>
      </details>
    </div>
  `;
}

function renderJobAdvertisement(posting, applications, index) {
  const latestApplication = applications.find((item) => item.department_key === posting.key);
  const hasActiveApplication = latestApplication && !["denied", "withdrawn", "closed"].includes(latestApplication.status);
  const isLawyer = posting.key === "lawyer";
  return `
    <details class="job-advertisement ${isLawyer ? "lawyer-ad" : ""}" ${index === 0 ? "open" : ""}>
      <summary>
        <div class="job-ad-icon">${isLawyer ? "§" : posting.key === "fire_ems" ? "✚" : "★"}</div>
        <div><p class="eyebrow">${escapeHtml(posting.division)}</p><h3>${escapeHtml(posting.label)}</h3><p>${escapeHtml(posting.schedule)}</p></div>
        <div class="job-ad-action">
          <span class="pill ${hasActiveApplication ? "amber" : latestApplication?.status === "approved" ? "green" : ""}">${latestApplication ? humanLabel(latestApplication.status) : "Now hiring"}</span>
          <strong>${hasActiveApplication ? "View application" : "Open & apply"} <i>›</i></strong>
        </div>
      </summary>
      <div class="job-ad-body">
        <div class="department-meta">
          <div><span>Position</span><strong>${escapeHtml(posting.badge)}</strong></div>
          <div><span>Role track</span><strong>${escapeHtml(posting.role_label || humanLabel(posting.role_key))}</strong></div>
          <div><span>Review</span><strong>${isLawyer ? "Judicial certification" : "Command staff"}</strong></div>
        </div>
        <div class="department-requirements"><span>What you need</span><p>${escapeHtml(posting.requirements)}</p></div>
        ${latestApplication ? `<div class="department-application-status"><div><p class="eyebrow">${escapeHtml(latestApplication.application_number)}</p><h3>Your application</h3><p class="muted small">Submitted ${new Date(latestApplication.created_at).toLocaleString()}${latestApplication.reviewer_name ? ` / Reviewer ${escapeHtml(latestApplication.reviewer_name)}` : ""}</p></div><span class="pill ${businessStatusClass(latestApplication.status)}">${humanLabel(latestApplication.status)}</span></div>` : ""}
        ${hasActiveApplication ? `<div class="empty">This application is active and waiting for review.</div>` : renderDepartmentApplicationForm(posting)}
      </div>
    </details>
  `;
}

function renderJobApplicationFile(item, postings) {
  const posting = postings.find((row) => row.key === item.department_key) || {};
  return `
    <article class="job-application-file">
      <div class="row tight">
        <div>
          <p class="eyebrow">${escapeHtml(item.application_number)}</p>
          <h3>${escapeHtml(posting.label || item.department_name || "Department")}</h3>
          <p class="muted small">Submitted ${new Date(item.created_at).toLocaleString()}${item.reviewer_name ? ` / Reviewer ${escapeHtml(item.reviewer_name)}` : ""}</p>
        </div>
        <span class="pill ${businessStatusClass(item.status)}">${humanLabel(item.status)}</span>
      </div>
      ${item.reviewer_notes ? `<p class="muted small">Command notes: ${escapeHtml(item.reviewer_notes)}</p>` : ""}
    </article>
  `;
}

function bindJobs() {
  $$(".department-application-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        await api("/api/jobs/department-applications", {
          method: "POST",
          body: { ...payload, department_key: form.dataset.departmentKey },
        });
        toast("Department application submitted");
        await loadAppData("jobs");
        render();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function treasuryStatusClass(status) {
  if (status === "paid") return "green";
  if (status === "denied") return "red";
  return "amber";
}

function treasuryTypeLabel(value) {
  return humanLabel(value || "treasury_request");
}

function renderTreasuryProofs(proofs = [], options = {}) {
  if (!proofs.length) return `<div class="empty">No proof images attached</div>`;
  const removable = Boolean(options.removable);
  return `
    <div class="treasury-proof-grid">
      ${proofs.map((proof, index) => `
        <div class="treasury-proof-thumb">
          ${proof.data_url ? `<img src="${escapeHtml(proof.data_url)}" alt="${escapeHtml(proof.name || "Treasury proof")}" loading="lazy" />` : `<div class="treasury-proof-placeholder">${iconSvg["id-card"]}</div>`}
          <span>${escapeHtml(proof.name || `proof-${index + 1}`)}</span>
          ${removable ? `<button type="button" class="icon-action mini" data-remove-treasury-proof="${index}" aria-label="Remove proof">${iconSvg.back}</button>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderTreasuryRequestCard(item, staff = false) {
  const proofs = item.proof_images || [];
  const title = staff ? `${item.user_name || "Civilian"} / CIV ${item.user_civ_number || "pending"}` : treasuryTypeLabel(item.request_type);
  return `
    <article class="treasury-request-card ${item.status === "submitted" ? "pending" : ""}">
      <div class="row tight">
        <div>
          <p class="eyebrow">${escapeHtml(item.request_number || "TRS-pending")}</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <span class="pill ${treasuryStatusClass(item.status)}">${escapeHtml(item.status || "submitted")}</span>
      </div>
      <div class="treasury-request-metrics">
        <div><span>Requested</span><strong>${money(item.requested_amount)}</strong></div>
        <div><span>Approved</span><strong>${money(item.approved_amount)}</strong></div>
        <div><span>Proof</span><strong>${item.proof_bypass ? "Bypass" : `${item.proof_count || proofs.length || 0} files`}</strong></div>
      </div>
      <p class="muted small">${escapeHtml(item.reason || "No request notes provided")}</p>
      ${item.reviewer_notes ? `<p class="small">Review: ${escapeHtml(item.reviewer_notes)}</p>` : ""}
      ${proofs.length ? renderTreasuryProofs(proofs) : ""}
      ${staff && item.status === "submitted" ? `
        <form class="treasury-review-form form-grid" data-request-id="${item.id}">
          <label>Approved amount<input name="approved_amount" type="number" min="1" step="0.01" value="${escapeHtml(item.requested_amount || 75000)}" /></label>
          <label>Review notes<textarea name="reviewer_notes" maxlength="1200" placeholder="Reason for approval, denial, or adjusted amount"></textarea></label>
          <div class="row">
            <button class="primary" type="submit" data-treasury-action="paid">Approve and deposit</button>
            <button class="danger" type="submit" data-treasury-action="denied">Deny</button>
          </div>
        </form>
      ` : ""}
    </article>
  `;
}

function renderTreasury() {
  const data = state.cache.treasury;
  if (!data) return `<div class="empty">Treasury loading</div>`;
  const stimulus = Number(data.stimulus_amount || 75000);
  const proofs = state.treasuryProofs || [];
  return `
    <div class="stack treasury-app">
      <section class="treasury-hero">
        <div>
          <p class="eyebrow">Faircroft Treasury</p>
          <h3>Stimulus and wipe compensation</h3>
          <p>File a server wipe compensation request with screenshot proof, or use the no-proof option for the standard ${money(stimulus)} stimulus check.</p>
        </div>
        <span class="treasury-seal">${iconSvg.treasury}</span>
      </section>
      <form id="treasuryRequestForm" class="treasury-form">
        <div class="grid-2">
          <label>Request type
            <select name="request_type">
              <option value="wipe_compensation">Server wipe compensation</option>
              <option value="stimulus">Stimulus check</option>
            </select>
          </label>
          <label>Requested amount<input name="requested_amount" type="number" min="1" step="0.01" value="${escapeHtml(stimulus)}" /></label>
        </div>
        <label>Request notes<textarea name="reason" maxlength="1200" placeholder="Explain what was lost, old balance, wipe date, or why you need stimulus review"></textarea></label>
        <label class="check-row treasury-bypass"><input type="checkbox" name="proof_bypass" /> No proof available - request standard ${money(stimulus)} stimulus check</label>
        <div class="treasury-dropzone" data-treasury-dropzone>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple data-treasury-file-input />
          <strong>Drop screenshots here</strong>
          <span>Balance proof, old bank screen, inventory loss, or wipe evidence. Up to ${Number(data.max_proofs || 4)} images.</span>
        </div>
        ${renderTreasuryProofs(proofs, { removable: true })}
        <button class="primary" type="submit">Submit Treasury request</button>
      </form>
      <section class="treasury-section">
        <div class="row">
          <div>
            <p class="eyebrow">Your ledger</p>
            <h3>Request history</h3>
          </div>
          <span class="pill">${(data.my_requests || []).length}</span>
        </div>
        <div class="treasury-request-list">
          ${(data.my_requests || []).map((item) => renderTreasuryRequestCard(item)).join("") || `<div class="empty">No Treasury requests filed yet</div>`}
        </div>
      </section>
      ${data.can_review ? `
        <section class="treasury-section staff">
          <div class="row">
            <div>
              <p class="eyebrow">Owner/admin review</p>
              <h3>Compensation queue</h3>
            </div>
            <span class="pill amber">${(data.review_queue || []).filter((item) => item.status === "submitted").length} pending</span>
          </div>
          <div class="treasury-request-list">
            ${(data.review_queue || []).map((item) => renderTreasuryRequestCard(item, true)).join("") || `<div class="empty">No Treasury requests to review</div>`}
          </div>
        </section>
      ` : ""}
    </div>
  `;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read proof image"));
    reader.readAsDataURL(file);
  });
}

async function encodeTreasuryProof(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Treasury proof must be an image");
  }
  const original = await readFileAsDataUrl(file);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve({ name: file.name, type: file.type, data_url: original });
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({ name: file.name, type: "image/jpeg", data_url: canvas.toDataURL("image/jpeg", 0.74) });
    };
    image.onerror = () => resolve({ name: file.name, type: file.type, data_url: original });
    image.src = original;
  });
}

async function addTreasuryProofFiles(files) {
  const maxProofs = Number(state.cache.treasury?.max_proofs || 4);
  const selected = Array.from(files || []).slice(0, Math.max(0, maxProofs - state.treasuryProofs.length));
  if (!selected.length) {
    toast(`Maximum ${maxProofs} proof images`);
    return;
  }
  const encoded = [];
  for (const file of selected) {
    encoded.push(await encodeTreasuryProof(file));
  }
  state.treasuryProofs = [...state.treasuryProofs, ...encoded].slice(0, maxProofs);
  render();
}

function bindTreasury() {
  const dropzone = $("[data-treasury-dropzone]");
  const input = $("[data-treasury-file-input]");
  input?.addEventListener("change", async () => {
    try {
      await addTreasuryProofFiles(input.files);
      input.value = "";
    } catch (error) {
      toast(error.message);
    }
  });
  dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone?.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
    try {
      await addTreasuryProofFiles(event.dataTransfer.files);
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-remove-treasury-proof]").forEach((button) => button.addEventListener("click", () => {
    state.treasuryProofs.splice(Number(button.dataset.removeTreasuryProof), 1);
    render();
  }));
  $("#treasuryRequestForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await api("/api/treasury", {
        method: "POST",
        body: {
          request_type: formData.get("request_type"),
          requested_amount: formData.get("requested_amount"),
          reason: formData.get("reason"),
          proof_bypass: formData.get("proof_bypass") === "on",
          proof_images: state.treasuryProofs,
        },
      });
      state.treasuryProofs = [];
      toast("Treasury request submitted");
      await loadAppData("treasury");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$(".treasury-review-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = event.submitter?.dataset.treasuryAction || "paid";
      const formData = new FormData(form);
      try {
        await api(`/api/treasury/requests/${form.dataset.requestId}`, {
          method: "PATCH",
          body: {
            status: action,
            approved_amount: formData.get("approved_amount"),
            reviewer_notes: formData.get("reviewer_notes"),
          },
        });
        toast(action === "paid" ? "Comp deposited" : "Treasury request denied");
        await loadAppData("treasury");
        await loadSession();
        render();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function renderBank() {
  const data = state.cache.bank;
  if (!data) return `<div class="empty">Bank loading</div>`;
  const canManageTreasury = Boolean(data.can_manage_treasury);
  return `
    <div class="stack bank-app">
      <section class="bank-hero">
        <div>
          <p class="eyebrow">FCRPMUSSALO Live Bank</p>
          <h3>${data.balance_synced ? money(data.balance) : "Awaiting game sync"}</h3>
          <p>Authoritative in-game balance${data.balance_synced_at ? ` · synced ${escapeHtml(data.balance_synced_at)}` : ""}.</p>
        </div>
        <span>${iconSvg.bank}</span>
      </section>
      <div class="metric"><span>Server time</span><strong>${minutes(data.income.presence_seconds_today)}m</strong></div>
      ${canManageTreasury ? `
        <section class="treasury-section bank-treasury-admin">
          <div class="row">
            <div>
              <p class="eyebrow">Treasury ledger</p>
              <h3>Compensation controls</h3>
            </div>
            <span class="pill green">${money(data.treasury_stats?.paid_total || 0)} paid</span>
          </div>
          <div class="grid-2">
            <div class="metric"><span>Pending requests</span><strong>${data.treasury_stats?.pending_count || 0}</strong></div>
            <div class="metric"><span>Players paid</span><strong>${data.treasury_stats?.paid_count || 0}</strong></div>
          </div>
          <form id="bankTreasuryAdjustForm" class="form-grid treasury-bank-form">
            <label>Recipient
              <select name="user_id" required>
                <option value="">Select player account</option>
                ${(data.treasury_users || []).map((item) => `<option value="${item.id}">${escapeHtml(item.name)} / CIV ${escapeHtml(item.civ_number || "pending")} / ${money(item.bank_balance)}</option>`).join("")}
              </select>
            </label>
            <label>Amount<input name="amount" type="number" min="1" step="0.01" value="75000" required /></label>
            <label>Comp reason<textarea name="reason" maxlength="500" required placeholder="Server wipe comp, admin-approved balance restore, event payout"></textarea></label>
            <button class="primary" type="submit">Add Treasury deposit</button>
          </form>
          <div class="treasury-ledger-list">
            ${(data.treasury_recent || []).map((item) => `
              <div class="treasury-ledger-row">
                <div>
                  <strong>${escapeHtml(item.user_name || "Civilian")}</strong>
                  <span>${escapeHtml(item.request_number)} / ${treasuryTypeLabel(item.request_type)}</span>
                </div>
                <strong>${money(item.approved_amount)}</strong>
              </div>
            `).join("") || `<div class="empty">No compensation deposits yet</div>`}
          </div>
        </section>
      ` : ""}
      <div class="card bank-activity-card">
        <h3>Activity</h3>
        <div class="list">${(data.transactions || []).map((tx) => `
          <div class="row"><span>${escapeHtml(tx.description)}</span><strong>${money(tx.amount)}</strong></div>
        `).join("") || `<div class="empty">No transactions yet</div>`}</div>
      </div>
    </div>
  `;
}

function bindBank() {
  $("#bankTreasuryAdjustForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/bank/treasury-adjust", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Treasury deposit added");
      await loadAppData("bank");
      await loadSession();
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderCash() {
  return `
    <div class="stack">
      <div class="card">
        <p class="eyebrow">In-game banking required</p>
        <div class="money">${state.session.user.bank_balance_synced ? money(state.session.user.bank_balance) : "Awaiting sync"}</div>
        <p class="muted">FCRPMUSSALO is the authoritative bank. Make transfers through the in-game banking system so the game balance remains accurate.</p>
      </div>
    </div>
  `;
}

function bindCash() {
  $("#cashForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/cash/transfer", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Payment sent");
      await loadSession();
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderProperties() {
  const props = state.cache.properties?.properties || [];
  return `
    <div class="stack">
      ${props.map((property) => `
        <article class="property-card">
          <div class="row"><h3>${escapeHtml(property.name)}</h3><span class="pill ${property.status === "available" ? "green" : "amber"}">${escapeHtml(property.status)}</span></div>
          <p class="muted small">${escapeHtml(property.address)} · rent value ${money(property.rent_rate)}/h</p>
          <div class="row">
            <strong>${money(property.price)}</strong>
            ${property.status === "available" ? `<button class="secondary" data-buy-property="${property.id}">Buy</button>` : `<span class="muted small">${escapeHtml(property.owner_name || "Owned")}</span>`}
          </div>
        </article>
      `).join("") || `<div class="empty">No property listings</div>`}
    </div>
  `;
}

function bindProperties() {
  $$("[data-buy-property]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/properties/${button.dataset.buyProperty}/buy`, { method: "POST" });
        toast("Property purchased");
        await loadAppData("properties");
        render();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function renderMessages() {
  const messages = state.cache.messages?.messages || [];
  return `
    <div class="stack">
      <form id="messageForm" class="card form-grid">
        <label>To email<input name="recipient_email" type="email" required /></label>
        <label>Subject<input name="subject" maxlength="80" required /></label>
        <label>Message<textarea name="body" maxlength="800" required></textarea></label>
        <button class="primary" type="submit">Send</button>
      </form>
      <div class="list">
        ${messages.map((message) => `
          <article class="message-card">
            <div class="row"><h3>${escapeHtml(message.subject)}</h3><span class="pill">${escapeHtml(message.sender_name)}</span></div>
            <p class="muted small">${new Date(message.created_at).toLocaleString()}</p>
            <p>${escapeHtml(message.body)}</p>
          </article>
        `).join("") || `<div class="empty">No messages yet</div>`}
      </div>
    </div>
  `;
}

function bindMessages() {
  $("#messageForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/messages", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Message sent");
      event.currentTarget.reset();
      await loadAppData("messages");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

function roadmapDateLabel(value) {
  if (!value) return "Open horizon";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function roadmapFilterMatches(item, filter) {
  if (filter === "all") return item.is_visible;
  if (filter === "ideas") return item.is_visible && ["planned", "exploring"].includes(item.status);
  return item.is_visible && item.status === filter;
}

function roadmapStatusLabel(status) {
  return {
    shipped: "Live",
    building: "In build",
    next: "Up next",
    planned: "Planned",
    exploring: "Exploring",
    paused: "Paused",
  }[status] || humanLabel(status);
}

function renderRoadmapWorkspace() {
  const data = state.cache.roadmap || { items: [], stats: {}, options: {} };
  const items = data.items || [];
  const visible = items.filter((item) => item.is_visible);
  const filtered = items.filter((item) => roadmapFilterMatches(item, state.roadmapFilter));
  const stats = data.stats || {};
  const overallProgress = Math.max(0, Math.min(100, Number(stats.overall_progress || 0)));
  const filters = [
    ["all", "All phases"],
    ["building", "In build"],
    ["next", "Up next"],
    ["ideas", "Ideas"],
    ["shipped", "Live"],
  ];
  const routeSystems = [
    ["PWA Core", 0],
    ["Game Link", 25],
    ["Android", 50],
    ["Banking", 75],
    ["Properties", 95],
  ];
  const currentSystemIndex = routeSystems.findIndex(([, threshold]) => overallProgress < threshold);
  const androidTarget = stats.android_days === null || stats.android_days === undefined
    ? "Scheduling"
    : `${stats.android_days} day${Number(stats.android_days) === 1 ? "" : "s"}`;
  return `
    <section class="roadmap-workspace">
      <header class="roadmap-topbar">
        <button class="roadmap-back" type="button" data-close-roadmap aria-label="Return to launcher">
          ${iconSvg.back}<span>Launcher</span>
        </button>
        <div class="roadmap-brand">
          <img class="roadmap-brand-emblem" src="/static/brand/faircroft-emblem.webp" alt="" />
          <div>
            <p>STATE OF FAIRCROFT</p>
            <strong>Build Route</strong>
            <span>PUBLIC DEVELOPMENT NETWORK</span>
          </div>
        </div>
        <div class="roadmap-top-actions">
          ${data.can_manage ? `<button class="roadmap-command" type="button" data-roadmap-edit="new" aria-label="Add milestone">${iconSvg.plus}<span>Add milestone</span></button>` : ""}
          <button class="roadmap-refresh" type="button" data-refresh-roadmap aria-label="Refresh roadmap">↻</button>
        </div>
      </header>

      <main class="roadmap-scroll">
        <section class="roadmap-intro">
          <div class="roadmap-intro-copy">
            <p class="roadmap-kicker"><span></span> COMMUNITY ROADMAP / LIVE BUILD SIGNAL</p>
            <h1>Faircroft <em>Build Route</em></h1>
            <p>Follow the connected platform from today's PWA through live game integration, native Android access, mobile banking, properties, and the Faircroft roleplay economy.</p>
            <div class="roadmap-live-state">
              <i></i>
              <span>Public route online</span>
              <b>RP OS ${OS_VERSION}</b>
            </div>
          </div>
          <div class="roadmap-launch-countdown">
            <img class="roadmap-launch-crest" src="/static/brand/faircroft-emblem.webp" alt="" />
            <span>ANDROID PARITY TARGET</span>
            <strong>${escapeHtml(androidTarget)}</strong>
            <p>${stats.android_target ? roadmapDateLabel(stats.android_target) : "Target window pending"}</p>
          </div>
        </section>

        <section class="roadmap-program" aria-label="Faircroft platform route">
          <header>
            <div>
              <span>CONNECTED PLATFORM</span>
              <strong>One account. Every Faircroft system.</strong>
            </div>
            <b>${overallProgress}% route completion</b>
          </header>
          <div class="roadmap-program-track">
            <div class="roadmap-program-fill" style="width:${overallProgress}%"></div>
            <i class="roadmap-program-traveler" style="left:${overallProgress}%"></i>
            ${routeSystems.map(([label, threshold], index) => `
              <div class="roadmap-program-station ${index === 0 ? "is-first" : ""} ${index === routeSystems.length - 1 ? "is-last" : ""} ${overallProgress >= threshold ? "complete" : ""} ${index === currentSystemIndex ? "current" : ""}" style="left:${threshold}%">
                <span></span>
                <strong>${escapeHtml(label)}</strong>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="roadmap-telemetry" aria-label="Roadmap progress">
          <div><span>Route completion</span><strong>${overallProgress}%</strong></div>
          <div><span>Active phases</span><strong>${Number(stats.active_phases || 0)}</strong></div>
          <div><span>Systems live</span><strong>${Number(stats.shipped_phases || 0)}</strong></div>
          <div><span>Community signals</span><strong>${Number(stats.community_votes || 0)}</strong></div>
          <div class="roadmap-master-progress"><span style="width:${overallProgress}%"></span></div>
        </section>

        <section class="roadmap-route-controls">
          <div>
            <p>DEVELOPMENT SEQUENCE</p>
            <h2>Milestone route</h2>
          </div>
          <nav class="roadmap-filters" aria-label="Roadmap views">
            ${filters.map(([id, label]) => `
              <button class="${state.roadmapFilter === id ? "active" : ""}" type="button" data-roadmap-filter="${id}">
                ${escapeHtml(label)}
                <span>${id === "all" ? visible.length : items.filter((item) => roadmapFilterMatches(item, id)).length}</span>
              </button>
            `).join("")}
          </nav>
          <span class="roadmap-result-count">${filtered.length} phase${filtered.length === 1 ? "" : "s"} shown</span>
        </section>

        <section class="roadmap-route" aria-label="Faircroft development milestones">
          <div class="roadmap-route-line" aria-hidden="true"><span></span><i></i></div>
          ${filtered.map((item) => {
            const routeIndex = visible.findIndex((row) => String(row.id) === String(item.id));
            const vote = Number(item.user_vote || 0);
            return `
              <article class="roadmap-stop accent-${escapeHtml(item.accent)} status-${escapeHtml(item.status)}" style="--stop-index:${Math.max(routeIndex, 0)}" data-roadmap-stop="${item.id}">
                <div class="roadmap-node" aria-hidden="true">
                  <span>${String(Math.max(routeIndex + 1, 1)).padStart(2, "0")}</span>
                </div>
                <div class="roadmap-stop-content">
                  <div class="roadmap-stop-head">
                    <div class="roadmap-stop-icon">${iconSvg[item.icon] || iconSvg.route}</div>
                    <div>
                      <p>${escapeHtml(item.category)} / ${escapeHtml(roadmapDateLabel(item.target_date))}</p>
                      <h2>${escapeHtml(item.title)}</h2>
                    </div>
                    <span class="roadmap-status">${escapeHtml(roadmapStatusLabel(item.status))}</span>
                  </div>
                  <p class="roadmap-summary">${escapeHtml(item.summary)}</p>
                  <div class="roadmap-progress-row">
                    <div class="roadmap-progress-track"><span style="width:${Number(item.progress || 0)}%"></span></div>
                    <strong>${Number(item.progress || 0)}%</strong>
                  </div>
                  ${item.details ? `
                    <details class="roadmap-notes">
                      <summary>Build brief</summary>
                      <p>${escapeHtml(item.details)}</p>
                    </details>
                  ` : ""}
                  <footer class="roadmap-stop-footer">
                    <div class="roadmap-votes" aria-label="Community voting">
                      <button class="${vote === 1 ? "active up" : ""}" type="button" data-roadmap-vote="${item.id}" data-vote="1" aria-label="Upvote ${escapeHtml(item.title)}">
                        ${iconSvg["thumb-up"]}<span>${Number(item.upvotes || 0)}</span>
                      </button>
                      <strong class="${Number(item.score || 0) < 0 ? "negative" : ""}">${Number(item.score || 0) > 0 ? "+" : ""}${Number(item.score || 0)}</strong>
                      <button class="${vote === -1 ? "active down" : ""}" type="button" data-roadmap-vote="${item.id}" data-vote="-1" aria-label="Downvote ${escapeHtml(item.title)}">
                        ${iconSvg["thumb-down"]}<span>${Number(item.downvotes || 0)}</span>
                      </button>
                    </div>
                    ${data.can_manage ? `<button class="roadmap-edit" type="button" data-roadmap-edit="${item.id}">${iconSvg.settings}<span>Edit phase</span></button>` : `<span class="roadmap-signal-label">COMMUNITY SIGNAL</span>`}
                  </footer>
                </div>
              </article>
            `;
          }).join("") || `<div class="roadmap-empty">No phases match this route view.</div>`}
        </section>

        <footer class="roadmap-footer">
          <div>
            <img class="roadmap-footer-emblem" src="/static/brand/faircroft-emblem.webp" alt="" />
            <span><strong>STATE OF FAIRCROFT</strong><small>Build Route / Public Development Network</small></span>
          </div>
          <p>RP OS ${OS_VERSION} / PostgreSQL live route</p>
        </footer>
      </main>
      ${state.roadmapEditorId !== null ? renderRoadmapEditor(data) : ""}
    </section>
  `;
}

function renderRoadmapEditor(data) {
  const isNew = state.roadmapEditorId === "new";
  const item = isNew ? null : (data.items || []).find((row) => String(row.id) === String(state.roadmapEditorId));
  if (!isNew && !item) return "";
  const model = item || {
    title: "",
    category: "Platform",
    summary: "",
    details: "",
    status: "planned",
    progress: 0,
    target_date: "",
    sort_order: ((data.items || []).length + 1) * 10,
    accent: "mint",
    icon: "route",
    is_visible: true,
  };
  const options = data.options || {};
  return `
    <div class="roadmap-editor-backdrop">
      <section class="roadmap-editor" role="dialog" aria-modal="true" aria-label="${isNew ? "Add roadmap milestone" : "Edit roadmap milestone"}">
        <header>
          <div><p>ROUTE CONTROL</p><h2>${isNew ? "Add milestone" : "Edit milestone"}</h2></div>
          <button type="button" data-close-roadmap-editor aria-label="Close editor">×</button>
        </header>
        <form id="roadmapEditorForm" data-roadmap-item-id="${isNew ? "" : item.id}">
          <label>Title<input name="title" value="${escapeHtml(model.title)}" maxlength="120" required /></label>
          <label>Category<input name="category" value="${escapeHtml(model.category)}" maxlength="60" required /></label>
          <label class="roadmap-editor-wide">Public summary<textarea name="summary" maxlength="500" required>${escapeHtml(model.summary)}</textarea></label>
          <label class="roadmap-editor-wide">Build brief<textarea name="details" maxlength="5000">${escapeHtml(model.details)}</textarea></label>
          <label>Status<select name="status">${(options.statuses || ["shipped", "building", "next", "planned", "exploring", "paused"]).map((value) => `<option value="${value}"${selectedAttr(value, model.status)}>${roadmapStatusLabel(value)}</option>`).join("")}</select></label>
          <label>Target date<input name="target_date" type="date" value="${escapeHtml(model.target_date || "")}" /></label>
          <label>Accent<select name="accent">${(options.accents || ["mint", "gold", "coral", "cyan", "violet"]).map((value) => `<option value="${value}"${selectedAttr(value, model.accent)}>${humanLabel(value)}</option>`).join("")}</select></label>
          <label>Icon<select name="icon">${(options.icons || ["route", "shield", "link", "bank", "home", "rocket", "settings"]).map((value) => `<option value="${value}"${selectedAttr(value, model.icon)}>${humanLabel(value)}</option>`).join("")}</select></label>
          <label>Route order<input name="sort_order" type="number" min="0" max="9999" value="${Number(model.sort_order || 0)}" required /></label>
          <label class="roadmap-progress-input">Progress <output>${Number(model.progress || 0)}%</output><input name="progress" type="range" min="0" max="100" value="${Number(model.progress || 0)}" /></label>
          <label class="roadmap-visibility"><input name="is_visible" type="checkbox" ${model.is_visible ? "checked" : ""} /> Visible to community</label>
          <div class="roadmap-editor-actions">
            <button class="secondary" type="button" data-close-roadmap-editor>Cancel</button>
            <button class="primary" type="submit">${isNew ? "Add to route" : "Save milestone"}</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function animateRoadmapStops() {
  const stops = $$(".roadmap-stop");
  if (!("IntersectionObserver" in window)) {
    stops.forEach((stop) => stop.classList.add("in-view"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        observer.unobserve(entry.target);
      }
    });
  }, { root: $(".roadmap-scroll"), threshold: 0.12 });
  stops.forEach((stop) => observer.observe(stop));
}

function bindRoadmapWorkspace() {
  animateRoadmapStops();
  $("[data-close-roadmap]")?.addEventListener("click", async () => {
    $(".roadmap-workspace")?.classList.add("is-closing");
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    state.activeApp = null;
    state.roadmapEditorId = null;
    await loadSession();
  });
  $("[data-refresh-roadmap]")?.addEventListener("click", async () => {
    const button = $("[data-refresh-roadmap]");
    button?.classList.add("is-refreshing");
    try {
      await loadAppData("roadmap");
      render();
    } catch (error) {
      button?.classList.remove("is-refreshing");
      if (error.message) toast(error.message);
    }
  });
  $$("[data-roadmap-filter]").forEach((button) => button.addEventListener("click", () => {
    const scrollTop = $(".roadmap-scroll")?.scrollTop || 0;
    state.roadmapFilter = button.dataset.roadmapFilter;
    render();
    requestAnimationFrame(() => {
      const scroll = $(".roadmap-scroll");
      if (scroll) scroll.scrollTop = scrollTop;
    });
  }));
  $$("[data-roadmap-vote]").forEach((button) => button.addEventListener("click", async () => {
    const item = state.cache.roadmap?.items?.find((row) => String(row.id) === String(button.dataset.roadmapVote));
    if (!item) return;
    const requested = Number(button.dataset.vote);
    const vote = Number(item.user_vote || 0) === requested ? 0 : requested;
    const scrollTop = $(".roadmap-scroll")?.scrollTop || 0;
    button.classList.add("is-sending");
    button.disabled = true;
    try {
      const result = await api(`/api/roadmap/items/${item.id}/vote`, { method: "POST", body: { vote } });
      Object.assign(item, result);
      if (state.cache.roadmap?.stats) {
        state.cache.roadmap.stats.community_votes = (state.cache.roadmap.items || []).reduce((total, row) => total + Number(row.upvotes || 0) + Number(row.downvotes || 0), 0);
      }
      render();
      requestAnimationFrame(() => {
        const scroll = $(".roadmap-scroll");
        if (scroll) scroll.scrollTop = scrollTop;
        const updated = $(`[data-roadmap-vote="${item.id}"][data-vote="${requested}"]`);
        updated?.classList.add("vote-confirmed");
      });
    } catch (error) {
      button.classList.remove("is-sending");
      button.disabled = false;
      if (error.message) toast(error.message);
    }
  }));
  $$("[data-roadmap-edit]").forEach((button) => button.addEventListener("click", () => {
    state.roadmapEditorId = button.dataset.roadmapEdit;
    render();
  }));
  $$("[data-close-roadmap-editor]").forEach((button) => button.addEventListener("click", () => {
    state.roadmapEditorId = null;
    render();
  }));
  $(".roadmap-editor-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      state.roadmapEditorId = null;
      render();
    }
  });
  const progressInput = $("#roadmapEditorForm input[name='progress']");
  progressInput?.addEventListener("input", () => {
    const output = $("#roadmapEditorForm output");
    if (output) output.textContent = `${progressInput.value}%`;
  });
  $("#roadmapEditorForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.is_visible = form.elements.is_visible.checked;
    payload.progress = Number(payload.progress || 0);
    payload.sort_order = Number(payload.sort_order || 0);
    const itemId = form.dataset.roadmapItemId;
    try {
      await api(itemId ? `/api/roadmap/items/${itemId}` : "/api/roadmap/items", {
        method: itemId ? "PATCH" : "POST",
        body: payload,
      });
      toast(itemId ? "Roadmap milestone saved" : "Milestone added to route");
      state.roadmapEditorId = null;
      await loadAppData("roadmap");
      render();
    } catch (error) {
      if (error.message) toast(error.message);
    }
  });
}

function renderChangelog() {
  const data = state.cache.changelog || {};
  const entries = data.entries || [];
  return `
    <div class="stack changelog-app">
      <div class="changelog-head">
        <div>
          <p class="eyebrow">Release notes</p>
          <h3>Changelog</h3>
        </div>
        <span class="pill">${escapeHtml(data.version || "live")}</span>
      </div>
      <div class="list">
        ${entries.map((entry) => `
          <article class="changelog-card">
            <div class="row">
              <div><p class="eyebrow">${escapeHtml(entry.date)}</p><h3>${escapeHtml(entry.title)}</h3></div>
            </div>
            ${renderChangeGroup("Added", entry.added)}
            ${renderChangeGroup("Changed", entry.changed)}
            ${renderChangeGroup("Fixed", entry.fixed)}
            ${renderChangeGroup("Removed", entry.removed)}
          </article>
        `).join("") || `<div class="empty">No changelog entries loaded</div>`}
      </div>
    </div>
  `;
}

function renderChangeGroup(label, items = []) {
  if (!items?.length) return "";
  return `
    <div class="change-group">
      <span>${escapeHtml(label)}</span>
      ${items.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    </div>
  `;
}

function humanLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function businessStatusClass(status) {
  if (["active", "approved"].includes(status)) return "green";
  if (["denied", "revoked", "expired", "failed", "critical"].includes(status)) return "red";
  return "amber";
}

function businessApplicationProgress(status) {
  const clean = String(status || "submitted");
  const final = clean === "approved" || clean === "denied";
  const index = clean === "submitted" ? 0 : clean === "under_review" ? 1 : clean === "interview_requested" ? 2 : final ? 3 : 0;
  const percent = [12, 42, 72, 100][index];
  return { index, percent, final, denied: clean === "denied", approved: clean === "approved" };
}

function renderBusinessApplicationTracker(item) {
  const progress = businessApplicationProgress(item.status);
  const decisionLabel = progress.approved ? "Approved" : progress.denied ? "Denied" : "Decision";
  const steps = [
    ["Submitted", 0],
    ["Review", 1],
    ["Interview", 2],
    [decisionLabel, 3],
  ];
  return `
    <div class="business-tracker ${progress.approved ? "approved" : ""} ${progress.denied ? "denied" : ""}">
      <div class="business-track-top">
        <span>Approval progress</span>
        <strong>${humanLabel(item.status)}</strong>
      </div>
      <div class="business-track-bar"><span style="width:${progress.percent}%"></span></div>
      <div class="business-track-steps">
        ${steps.map(([label, index]) => {
          const stepClass = index < progress.index || (progress.final && index <= progress.index) ? "complete" : index === progress.index ? "active" : "pending";
          return `<div class="business-track-step ${stepClass} ${progress.denied && index === 3 ? "denied" : ""}"><i></i><span>${escapeHtml(label)}</span></div>`;
        }).join("")}
      </div>
    </div>
  `;
}

function businessCategoryOptions(categories = [], selected = "basic") {
  const rows = categories.length ? categories : ["basic", "commercial", "restricted", "government_contract"];
  return rows.map((category) => `<option value="${escapeHtml(category)}" ${category === selected ? "selected" : ""}>${humanLabel(category)}</option>`).join("");
}

function businessStatusOptions(statuses = [], selected = "active") {
  const rows = statuses.length ? statuses : ["active", "suspended", "revoked", "expired"];
  return rows.map((status) => `<option value="${escapeHtml(status)}" ${status === selected ? "selected" : ""}>${humanLabel(status)}</option>`).join("");
}

function renderBusiness() {
  const data = state.cache.business || {};
  const staff = Boolean(data.staff_view);
  const tabs = [
    ["apply", "Apply"],
    ["licenses", "Licenses"],
    ...(staff ? [["review", "Review"], ["market", "Registry"]] : []),
  ];
  if (!tabs.some(([id]) => id === state.businessTab)) state.businessTab = "apply";
  const stats = staff ? data.stats || {} : {};
  return `
    <div class="stack business-app">
      <div class="business-hero">
        <div>
          <p class="eyebrow">${staff ? "City Hall registry" : "Civilian filing"}</p>
          <h3>Business Registry</h3>
          <p>${staff ? "Review, license, inspect, and enforce RP business operations." : "Apply for a legal RP business license and track your approvals."}</p>
        </div>
        <span class="pill ${staff ? "green" : "amber"}">${staff ? "staff access" : `${data.max_active_per_owner || 2} max`}</span>
      </div>
      ${staff ? `
        <div class="grid-2">
          <div class="metric"><span>Pending</span><strong>${stats.pending || 0}</strong></div>
          <div class="metric"><span>Active</span><strong>${stats.active || 0}</strong></div>
          <div class="metric"><span>Suspended</span><strong>${stats.suspended || 0}</strong></div>
          <div class="metric"><span>Restricted</span><strong>${stats.restricted || 0}</strong></div>
        </div>
      ` : ""}
      <div class="court-tabs">
        ${tabs.map(([id, label]) => `<button class="${state.businessTab === id ? "active" : ""}" data-business-tab="${id}">${label}</button>`).join("")}
      </div>
      ${state.businessTab === "review" ? renderBusinessReview(data) : state.businessTab === "market" ? renderBusinessRegistry(data) : state.businessTab === "licenses" ? renderBusinessLicenses(data) : renderBusinessApply(data)}
    </div>
  `;
}

function renderBusinessWorkspace() {
  const data = state.cache.business || {};
  const staff = Boolean(data.staff_view);
  const tabs = [
    ["apply", "New Application"],
    ["licenses", "My Licenses"],
    ...(staff ? [["review", "Application Review"], ["market", "License Registry"]] : []),
  ];
  if (!tabs.some(([id]) => id === state.businessTab)) state.businessTab = "apply";
  const active = tabs.find(([id]) => id === state.businessTab) || tabs[0];
  return `
    <section class="business-workspace">
      <aside class="business-workspace-sidebar">
        <div class="dev-brand"><img class="dev-emblem" src="/static/brand/faircroft-emblem.webp" alt="" /><div><strong>Faircroft RP</strong><small>Business Registry</small></div></div>
        <p class="dev-nav-label">Registry workspace</p>
        <nav>
          ${tabs.map(([id, label]) => `<button type="button" class="${state.businessTab === id ? "active" : ""}" data-business-tab="${id}">${escapeHtml(label)}</button>`).join("")}
        </nav>
        <div class="business-workspace-sidebar-note">
          <span class="dev-access-dot"></span>
          <div><strong>${staff ? "Registry Staff" : "Business Owner"}</strong><small>${escapeHtml(state.session?.user?.name || "")}</small></div>
        </div>
      </aside>
      <main class="business-workspace-main">
        <header class="business-workspace-topbar">
          <div><p class="eyebrow">${staff ? "City Hall Commerce Division" : "Faircroft Commerce Portal"}</p><h1>${escapeHtml(active[1])}</h1></div>
          <div class="business-workspace-actions">
            <button type="button" class="secondary" data-refresh-business-workspace>Refresh registry</button>
            <button type="button" class="primary" data-close-business-workspace>Return to phone</button>
          </div>
        </header>
        <div class="business-workspace-content">${renderBusiness()}</div>
      </main>
    </section>`;
}

function bindBusinessWorkspace() {
  bindBusiness();
  $("[data-close-business-workspace]")?.addEventListener("click", async () => {
    state.activeApp = null;
    await loadSession();
  });
  $("[data-refresh-business-workspace]")?.addEventListener("click", async () => {
    await loadAppData("business");
    render();
  });
}

function renderBusinessApply(data) {
  const activeApplications = (data.applications || []).filter((item) => !["approved", "denied"].includes(item.status)).slice(0, 2);
  return `
    <div class="stack">
      ${activeApplications.length ? `
        <div class="business-section">
          <div class="row"><h3>Current Filing Progress</h3><span class="pill amber">${activeApplications.length} active</span></div>
          ${activeApplications.map((item) => `
            <div class="business-current">
              <div class="row tight">
                <div><p class="eyebrow">${escapeHtml(item.application_number)}</p><strong>${escapeHtml(item.business_name)}</strong></div>
                <span class="pill ${businessStatusClass(item.status)}">${humanLabel(item.status)}</span>
              </div>
              ${renderBusinessApplicationTracker(item)}
            </div>
          `).join("")}
        </div>
      ` : ""}
      <form id="businessApplicationForm" class="business-form form-grid">
        <div>
          <p class="eyebrow">New filing</p>
          <h3>Business Application</h3>
          <p class="muted small">Applications are reviewed for realism, funding, roleplay intent, rule compliance, and economy balance before a license is issued.</p>
        </div>
        <label>Business name<input name="business_name" maxlength="120" required /></label>
        <div class="grid-2">
          <label>Business type<select name="business_type" required>
            <option>Retail Shop</option>
            <option>Service Company</option>
            <option>Logistics</option>
            <option>Security Firm</option>
            <option>Restaurant / Bar</option>
            <option>Banking / Finance</option>
            <option>Armored Transport</option>
            <option>Government Contractor</option>
            <option>Other</option>
          </select></label>
          <label>License category<select name="license_category" required>${businessCategoryOptions(data.categories, "basic")}</select></label>
        </div>
        <label>Owner information<input name="owner_name" value="${escapeHtml(state.session.user.name)}" maxlength="120" required /></label>
        <label>Business location<input name="location" maxlength="160" placeholder="Street, postal, district, or property" required /></label>
        <div class="grid-2">
          <label>Startup budget<input name="startup_budget" type="number" min="0" step="0.01" required /></label>
          <label>Planned employees<input name="planned_employees" type="number" min="1" max="250" value="1" required /></label>
        </div>
        <label>Funding source<textarea name="funding_source" maxlength="700" placeholder="Explain where the startup money comes from in RP." required></textarea></label>
        <label>Detailed business description<textarea name="description" maxlength="1200" placeholder="Services, operating plan, RP purpose, expected customers, and any restricted activity." required></textarea></label>
        <button class="primary" type="submit">Submit to registry</button>
      </form>
    </div>
  `;
}

function renderBusinessLicenses(data) {
  const businesses = data.businesses || [];
  const applications = data.applications || [];
  const page = businessPageSlice(businesses, state.businessLicensePage);
  state.businessLicensePage = page.page;
  return `
    <div class="stack">
      <div class="business-license-heading">
        <div><p class="eyebrow">License cabinet</p><h3>Your registered businesses</h3></div>
        <span class="pill">${businesses.length} file${businesses.length === 1 ? "" : "s"}</span>
      </div>
      <div class="business-license-folders">
        ${page.rows.map((item) => renderBusinessLicenseFolder(item, false, data)).join("") || `<div class="empty">No approved business licenses yet</div>`}
      </div>
      ${renderBusinessPager(page, "licenses")}
      <div class="business-section">
        <div class="row"><h3>Application History</h3><span class="pill">${applications.length}</span></div>
        <div class="list">
          ${applications.map((item) => renderBusinessApplicationCard(item, false, data)).join("") || `<div class="empty">No business applications submitted</div>`}
        </div>
      </div>
      ${renderBusinessLedger("Recent Inspections", data.inspections || [], "inspection")}
      ${renderBusinessLedger("Violations", data.violations || [], "violation")}
    </div>
  `;
}

function renderBusinessReview(data) {
  const queue = data.review_queue || [];
  const groups = {
    active: queue,
    submitted: queue.filter((item) => item.status === "submitted"),
    under_review: queue.filter((item) => item.status === "under_review"),
    interview_requested: queue.filter((item) => item.status === "interview_requested"),
  };
  if (!groups[state.businessReviewFilter]) state.businessReviewFilter = "active";
  const rows = groups[state.businessReviewFilter] || [];
  const filters = [
    ["active", "Active Queue", queue.length],
    ["submitted", "New", groups.submitted.length],
    ["under_review", "Review", groups.under_review.length],
    ["interview_requested", "Interview", groups.interview_requested.length],
  ];
  return `
    <section class="business-review-board">
      <div class="business-review-filter">
        ${filters.map(([id, label, count]) => `
          <button class="${state.businessReviewFilter === id ? "active" : ""}" type="button" data-business-review-filter="${id}">
            <span>${escapeHtml(label)}</span>
            <strong>${count}</strong>
          </button>
        `).join("")}
      </div>
      <div class="business-review-list">
        ${rows.map((item) => renderBusinessApplicationCard(item, true, data)).join("") || `<div class="empty">No applications in this folder</div>`}
      </div>
      ${(data.recent_reviews || []).length ? `
        <details class="business-review-history">
          <summary>Recent registry actions</summary>
          ${renderBusinessRecentReviews(data.recent_reviews || [])}
        </details>
      ` : ""}
    </section>
  `;
}

function renderBusinessRecentReviews(rows) {
  return `
    <div class="business-review-actions">
      ${rows.slice(0, 18).map((row) => `
        <article class="business-review-action">
          <div>
            <p class="eyebrow">${escapeHtml(row.application_number || "")}</p>
            <strong>${escapeHtml(row.business_name || "Business application")}</strong>
            <p>${escapeHtml(row.notes || "No review notes recorded")}</p>
          </div>
          <span class="pill ${businessStatusClass(row.action)}">${humanLabel(row.action)}</span>
        </article>
      `).join("")}
    </div>
  `;
}

function renderBusinessRegistry(data) {
  const businesses = data.all_businesses || [];
  const page = businessPageSlice(businesses, state.businessRegistryPage);
  state.businessRegistryPage = page.page;
  return `
    <div class="stack">
      <div class="business-license-heading">
        <div><p class="eyebrow">City Hall records</p><h3>Business license cabinet</h3></div>
        <span class="pill">${businesses.length} files</span>
      </div>
      <div class="business-license-folders">
        ${page.rows.map((item) => renderBusinessLicenseFolder(item, true, data)).join("") || `<div class="empty">No business licenses issued yet</div>`}
      </div>
      ${renderBusinessPager(page, "registry")}
      ${renderBusinessLedger("Recent Inspections", data.staff_inspections || [], "inspection")}
      ${renderBusinessLedger("Recent Violations", data.staff_violations || [], "violation")}
    </div>
  `;
}

const BUSINESS_LICENSES_PER_PAGE = 6;

function businessPageSlice(rows, requestedPage) {
  const pages = Math.max(1, Math.ceil(rows.length / BUSINESS_LICENSES_PER_PAGE));
  const page = Math.max(1, Math.min(Number(requestedPage) || 1, pages));
  const start = (page - 1) * BUSINESS_LICENSES_PER_PAGE;
  return { rows: rows.slice(start, start + BUSINESS_LICENSES_PER_PAGE), page, pages, total: rows.length };
}

function renderBusinessPager(page, scope) {
  if (page.pages <= 1) return "";
  return `
    <nav class="business-pager" aria-label="Business license pages">
      <button type="button" class="secondary" data-business-page="${page.page - 1}" data-business-page-scope="${scope}" ${page.page <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page <strong>${page.page}</strong> of ${page.pages}</span>
      <button type="button" class="secondary" data-business-page="${page.page + 1}" data-business-page-scope="${scope}" ${page.page >= page.pages ? "disabled" : ""}>Next</button>
    </nav>`;
}

function renderBusinessLicenseFolder(item, manage, data) {
  return `
    <details class="business-license-folder">
      <summary>
        <div class="business-folder-tab">LICENSE FILE</div>
        <div class="row tight">
          <div>
            <p class="eyebrow">${escapeHtml(item.license_number)}</p>
            <h3>${escapeHtml(item.business_name)}</h3>
            <p class="muted small">${escapeHtml(item.owner_name || "Owner")} · ${escapeHtml(item.location)}</p>
          </div>
          <span class="pill ${businessStatusClass(item.status)}">${humanLabel(item.status)}</span>
        </div>
        <div class="business-folder-strip">
          <span>${humanLabel(item.license_category)}</span>
          <span>${escapeHtml(item.business_type)}</span>
          <span>${money(item.weekly_tax)}/week</span>
          <span>${item.open_violations || 0} violation(s)</span>
        </div>
        <div class="business-folder-open">Open license file <span>+</span></div>
      </summary>
      <div class="business-license-folder-body">${renderBusinessLicenseCard(item, manage, data)}</div>
    </details>`;
}

function renderBusinessApplicationReviewFolder(item, data) {
  return `
    <article class="business-card business-application-folder">
      <details>
        <summary>
          <div class="row tight">
            <div>
              <p class="eyebrow">${escapeHtml(item.application_number)}</p>
              <h3>${escapeHtml(item.business_name)}</h3>
              <p class="muted small">${escapeHtml(item.applicant_name || item.owner_name)} / ${humanLabel(item.license_category)} / ${escapeHtml(item.location)}</p>
            </div>
            <span class="pill ${businessStatusClass(item.status)}">${humanLabel(item.status)}</span>
          </div>
          <div class="business-folder-strip">
            <span>${escapeHtml(item.business_type)}</span>
            <span>${money(item.startup_budget)}</span>
            <span>${escapeHtml(item.applicant_civ_number || "CIV pending")}</span>
            <span>${escapeHtml(item.reviewer_name || "Unassigned")}</span>
          </div>
        </summary>
        <div class="business-folder-body">
          ${renderBusinessApplicationTracker(item)}
          <div class="business-meta">
            <div><span>Type</span><strong>${escapeHtml(item.business_type)}</strong></div>
            <div><span>Budget</span><strong>${money(item.startup_budget)}</strong></div>
            <div><span>Employees</span><strong>${item.planned_employees}</strong></div>
            <div><span>Reviewer</span><strong>${escapeHtml(item.reviewer_name || "Unassigned")}</strong></div>
          </div>
          <div class="business-brief"><span>Plan</span><p>${escapeHtml(item.description)}</p></div>
          <div class="business-brief"><span>Funding</span><p>${escapeHtml(item.funding_source)}</p></div>
          ${item.reviewer_notes ? `<p class="muted small">Review notes: ${escapeHtml(item.reviewer_notes)}</p>` : ""}
          ${item.interview_notes ? `<p class="muted small">Interview: ${escapeHtml(item.interview_notes)}</p>` : ""}
          <form class="business-review-form form-grid" data-application-id="${item.id}">
            <div class="grid-2">
              <label>Decision<select name="status">
                <option value="under_review" ${item.status === "under_review" ? "selected" : ""}>Under Review</option>
                <option value="interview_requested" ${item.status === "interview_requested" ? "selected" : ""}>Interview Requested</option>
                <option value="approved">Approve and Issue License</option>
                <option value="denied">Deny</option>
              </select></label>
              <label>License category<select name="license_category">${businessCategoryOptions(data.categories, item.license_category)}</select></label>
            </div>
            <div class="grid-2">
              <label>Weekly tax<input name="weekly_tax" type="number" min="0" step="0.01" placeholder="Auto if blank" /></label>
              <label>Activity minutes/week<input name="activity_requirement_minutes" type="number" min="0" value="120" /></label>
            </div>
            <label>Review notes<textarea name="reviewer_notes" maxlength="1200">${escapeHtml(item.reviewer_notes || "")}</textarea></label>
            <label>Interview notes<textarea name="interview_notes" maxlength="1000">${escapeHtml(item.interview_notes || "")}</textarea></label>
            <button class="primary" type="submit">Save decision</button>
          </form>
        </div>
      </details>
    </article>
  `;
}

function renderBusinessApplicationCard(item, review, data) {
  if (review) return renderBusinessApplicationReviewFolder(item, data);
  return `
    <article class="business-card">
      <div class="row tight">
        <div>
          <p class="eyebrow">${escapeHtml(item.application_number)}</p>
          <h3>${escapeHtml(item.business_name)}</h3>
          <p class="muted small">${escapeHtml(item.applicant_name || item.owner_name)} · ${humanLabel(item.license_category)} · ${escapeHtml(item.location)}</p>
        </div>
        <span class="pill ${businessStatusClass(item.status)}">${humanLabel(item.status)}</span>
      </div>
      ${renderBusinessApplicationTracker(item)}
      <div class="business-meta">
        <div><span>Type</span><strong>${escapeHtml(item.business_type)}</strong></div>
        <div><span>Budget</span><strong>${money(item.startup_budget)}</strong></div>
        <div><span>Employees</span><strong>${item.planned_employees}</strong></div>
        <div><span>Reviewer</span><strong>${escapeHtml(item.reviewer_name || "Unassigned")}</strong></div>
      </div>
      <div class="business-brief"><span>Plan</span><p>${escapeHtml(item.description)}</p></div>
      <div class="business-brief"><span>Funding</span><p>${escapeHtml(item.funding_source)}</p></div>
      ${item.reviewer_notes ? `<p class="muted small">Review notes: ${escapeHtml(item.reviewer_notes)}</p>` : ""}
      ${item.interview_notes ? `<p class="muted small">Interview: ${escapeHtml(item.interview_notes)}</p>` : ""}
      ${review ? `
        <form class="business-review-form form-grid" data-application-id="${item.id}">
          <div class="grid-2">
            <label>Decision<select name="status">
              <option value="under_review" ${item.status === "under_review" ? "selected" : ""}>Under Review</option>
              <option value="interview_requested" ${item.status === "interview_requested" ? "selected" : ""}>Interview Requested</option>
              <option value="approved">Approve and Issue License</option>
              <option value="denied">Deny</option>
            </select></label>
            <label>License category<select name="license_category">${businessCategoryOptions(data.categories, item.license_category)}</select></label>
          </div>
          <div class="grid-2">
            <label>Weekly tax<input name="weekly_tax" type="number" min="0" step="0.01" placeholder="Auto if blank" /></label>
            <label>Activity minutes/week<input name="activity_requirement_minutes" type="number" min="0" value="120" /></label>
          </div>
          <label>Review notes<textarea name="reviewer_notes" maxlength="1200">${escapeHtml(item.reviewer_notes || "")}</textarea></label>
          <label>Interview notes<textarea name="interview_notes" maxlength="1000">${escapeHtml(item.interview_notes || "")}</textarea></label>
          <button class="primary" type="submit">Save decision</button>
        </form>
      ` : ""}
    </article>
  `;
}

function renderBusinessLicenseCard(item, manage, data) {
  return `
    <article class="business-card license-card">
      <div class="row tight">
        <div>
          <p class="eyebrow">${escapeHtml(item.license_number)}</p>
          <h3>${escapeHtml(item.business_name)}</h3>
          <p class="muted small">${escapeHtml(item.owner_name || "Owner")} · ${humanLabel(item.license_category)} · ${escapeHtml(item.location)}</p>
        </div>
        <span class="pill ${businessStatusClass(item.status)}">${humanLabel(item.status)}</span>
      </div>
      <div class="business-meta">
        <div><span>Tax/week</span><strong>${money(item.weekly_tax)}</strong></div>
        <div><span>Activity</span><strong>${item.activity_requirement_minutes}m</strong></div>
        <div><span>Reputation</span><strong>${item.reputation_score}</strong></div>
        <div><span>Violations</span><strong>${item.open_violations}</strong></div>
      </div>
      <div class="business-brief"><span>Operations</span><p>${escapeHtml(item.description)}</p></div>
      ${item.compliance_notes ? `<p class="muted small">Compliance: ${escapeHtml(item.compliance_notes)}</p>` : ""}
      ${manage ? `
        <form class="business-license-form form-grid" data-business-id="${item.id}">
          <div class="grid-2">
            <label>Status<select name="status">${businessStatusOptions(data.license_statuses, item.status)}</select></label>
            <label>Category<select name="license_category">${businessCategoryOptions(data.categories, item.license_category)}</select></label>
          </div>
          <div class="grid-2">
            <label>Weekly tax<input name="weekly_tax" type="number" min="0" step="0.01" value="${escapeHtml(item.weekly_tax)}" /></label>
            <label>Activity minutes/week<input name="activity_requirement_minutes" type="number" min="0" value="${escapeHtml(item.activity_requirement_minutes)}" /></label>
          </div>
          <div class="grid-2">
            <label>Reputation<input name="reputation_score" type="number" min="0" max="100" value="${escapeHtml(item.reputation_score)}" /></label>
            <label class="check-row"><input type="checkbox" name="insurance_required" ${item.insurance_required ? "checked" : ""} /> Insurance required</label>
          </div>
          <label>Compliance notes<textarea name="compliance_notes" maxlength="1200">${escapeHtml(item.compliance_notes || "")}</textarea></label>
          <button class="primary" type="submit">Update license</button>
        </form>
        <form class="business-inspection-form form-grid mini-registry-form" data-business-id="${item.id}">
          <div class="row"><h3>Inspection</h3><span class="pill">${item.inspection_count}</span></div>
          <div class="grid-2">
            <label>Type<input name="inspection_type" placeholder="Audit / Site visit / Insurance" required /></label>
            <label>Result<select name="result"><option>passed</option><option>warning</option><option>failed</option><option>follow-up required</option></select></label>
          </div>
          <label>Notes<textarea name="notes" maxlength="1000" required></textarea></label>
          <button class="secondary" type="submit">Log inspection</button>
        </form>
        <form class="business-violation-form form-grid mini-registry-form" data-business-id="${item.id}">
          <div class="row"><h3>Violation</h3><span class="pill red">${item.open_violations}</span></div>
          <div class="grid-2">
            <label>Severity<select name="severity"><option>minor</option><option>major</option><option>critical</option></select></label>
            <label>Penalty<input name="penalty" placeholder="Fine, suspension, warning" /></label>
          </div>
          <label>Violation<textarea name="violation" maxlength="1000" required></textarea></label>
          <button class="danger" type="submit">Issue violation</button>
        </form>
      ` : ""}
    </article>
  `;
}

function renderBusinessLedger(title, rows, type) {
  if (!rows.length) return "";
  return `
    <div class="business-section">
      <div class="row"><h3>${escapeHtml(title)}</h3><span class="pill">${rows.length}</span></div>
      <div class="list">
        ${rows.map((row) => `
          <article class="business-ledger">
            <div class="row tight">
              <div>
                <p class="eyebrow">${escapeHtml(row.license_number || "")}</p>
                <h3>${escapeHtml(row.business_name || "Business")}</h3>
              </div>
              <span class="pill ${type === "violation" ? businessStatusClass(row.status) : businessStatusClass(row.result)}">${escapeHtml(type === "violation" ? row.severity : row.result)}</span>
            </div>
            <p>${escapeHtml(type === "violation" ? row.violation : row.notes)}</p>
            ${type === "violation" && row.penalty ? `<p class="muted small">Penalty: ${escapeHtml(row.penalty)}</p>` : ""}
            <p class="muted small">${escapeHtml(type === "violation" ? row.issuer_name : row.inspector_name)} · ${new Date(row.created_at).toLocaleString()}</p>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function bindBusiness() {
  $$("[data-business-tab]").forEach((button) => button.addEventListener("click", () => {
    state.businessTab = button.dataset.businessTab;
    render();
  }));
  $$("[data-business-review-filter]").forEach((button) => button.addEventListener("click", () => {
    state.businessReviewFilter = button.dataset.businessReviewFilter;
    render();
  }));
  $$("[data-business-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.businessPage) || 1;
    if (button.dataset.businessPageScope === "registry") state.businessRegistryPage = page;
    else state.businessLicensePage = page;
    render();
  }));
  $("#businessApplicationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/business/applications", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Business application submitted");
      event.currentTarget.reset();
      state.businessTab = "licenses";
      await loadAppData("business");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$(".business-review-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/business/applications/${form.dataset.applicationId}`, { method: "PATCH", body: Object.fromEntries(new FormData(form).entries()) });
      toast("Application decision saved");
      await loadAppData("business");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".business-license-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.insurance_required = formData.get("insurance_required") === "on";
    try {
      await api(`/api/business/licenses/${form.dataset.businessId}`, { method: "PATCH", body: payload });
      toast("Business license updated");
      await loadAppData("business");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".business-inspection-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/business/licenses/${form.dataset.businessId}/inspections`, { method: "POST", body: Object.fromEntries(new FormData(form).entries()) });
      toast("Inspection logged");
      await loadAppData("business");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".business-violation-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/business/licenses/${form.dataset.businessId}/violations`, { method: "POST", body: Object.fromEntries(new FormData(form).entries()) });
      toast("Violation issued");
      await loadAppData("business");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function renderContracts() {
  const data = state.cache.contracts || {};
  const ownerView = Boolean(data.owner_view);
  const tabs = ownerView
    ? [["all", "All"], ["open", "Open"]]
    : [["open", "Open"], ["posted", "Posted"], ["accepted", "Accepted"]];
  if (!tabs.some(([id]) => id === state.contractsTab)) state.contractsTab = ownerView ? "all" : "open";
  const rows = data[state.contractsTab] || [];
  const allRows = [...(data.open || []), ...(data.posted || []), ...(data.accepted || []), ...(data.all || [])];
  const proofContract = state.contractProofId ? allRows.find((item) => String(item.id) === String(state.contractProofId)) : null;
  const showInfo = state.contractsInfoOpen || !localStorage.getItem("rp_contracts_intro_seen");
  return `
    <div class="stack contracts-app">
      <div class="contract-hero">
        <div>
          <p class="eyebrow">${ownerView ? "Owner monitor" : "Dark board"}</p>
          <h3>Contracts</h3>
          <p>${ownerView ? "Read-only oversight feed" : "Anonymous RP work orders"}</p>
        </div>
        <button class="ghost" type="button" data-contract-info>How it works</button>
      </div>
      <div class="court-tabs">
        ${tabs.map(([id, label]) => `<button class="${state.contractsTab === id ? "active" : ""}" data-contract-tab="${id}">${label}</button>`).join("")}
      </div>
      ${ownerView ? "" : `
        <form id="contractForm" class="contract-compose form-grid">
          <div class="grid-2">
            <label>Target name<input name="target_name" placeholder="Exact RP character name" required /></label>
            <label>Price<input name="price" type="number" min="1" step="0.01" required /></label>
          </div>
          <div class="grid-2">
            <label>Target type<input name="target_context" maxlength="160" placeholder="LEO, politician, gang member, civilian" /></label>
            <label>Last known area<input name="last_known" maxlength="180" placeholder="City, postal, patrol zone, venue" /></label>
          </div>
          <label>Contract briefing<textarea name="details" maxlength="900" placeholder="What the contractor needs to know in RP" required></textarea></label>
          <label>Completion requirements<textarea name="requirements" maxlength="700" placeholder="Required clip angle, scene proof, or RP condition"></textarea></label>
          <button class="primary" type="submit">Post contract</button>
        </form>
      `}
      ${renderContractList(rows, ownerView)}
      ${proofContract ? renderContractProofModal(proofContract) : ""}
      ${showInfo ? renderContractsInfoModal(ownerView) : ""}
    </div>
  `;
}

function renderContractList(rows, ownerView) {
  return `
    <div class="list contract-list">
      ${rows.map((item) => renderContractCard(item, ownerView)).join("") || `<div class="empty">No contracts here</div>`}
    </div>
  `;
}

function renderContractCard(item, ownerView) {
  const statusClass = item.status === "open" ? "red" : item.status === "accepted" ? "amber" : item.status === "submitted" ? "green" : "";
  return `
    <article class="contract-card">
      <div class="row">
        <div>
          <p class="eyebrow">${escapeHtml(item.contract_number)}</p>
          <h3>${escapeHtml(item.target_name)}</h3>
        </div>
        <span class="pill ${statusClass}">${escapeHtml(item.status)}</span>
      </div>
      <div class="contract-meta">
        <div><span>Target</span><strong>${escapeHtml(item.target_name)}</strong></div>
        <div><span>Price</span><strong>${money(item.price)}</strong></div>
        <div><span>Type</span><strong>${escapeHtml(item.target_context || "Unlisted")}</strong></div>
        <div><span>Last seen</span><strong>${escapeHtml(item.last_known || "Unknown")}</strong></div>
        <div><span>Posted by</span><strong>${escapeHtml(item.poster_name)}</strong></div>
        <div><span>Accepted by</span><strong>${escapeHtml(item.accepter_name || "Open")}</strong></div>
      </div>
      <div class="contract-brief">
        <span>Briefing</span>
        <p>${escapeHtml(item.details)}</p>
      </div>
      ${item.requirements ? `<div class="contract-brief"><span>Completion requirements</span><p>${escapeHtml(item.requirements)}</p></div>` : ""}
      ${item.clip_url ? `<a class="clip-link" href="${escapeHtml(item.clip_url)}" target="_blank" rel="noopener">View proof clip</a>` : ""}
      ${item.proof_note ? `<p class="muted small">${escapeHtml(item.proof_note)}</p>` : ""}
      <div class="row">
        <p class="muted small">${new Date(item.created_at).toLocaleString()}</p>
        <div class="contract-actions">
          ${item.can_accept ? `<button class="secondary" type="button" data-accept-contract="${item.id}">Accept</button>` : ""}
          ${item.can_submit_proof ? `<button class="primary" type="button" data-open-proof="${item.id}">${item.status === "submitted" ? "Update clip" : "Submit clip"}</button>` : ""}
          ${ownerView && item.clip_url ? `<span class="pill green">proof</span>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderContractsInfoModal(ownerView) {
  return `
    <div class="modal-backdrop contract-info-backdrop" data-close-contract-info>
      <section class="mdt-modal contract-info-modal" role="dialog" aria-modal="true">
        <header class="row">
          <div><p class="eyebrow">Contracts protocol</p><h2>How contracts work</h2></div>
          <button class="icon-action" type="button" data-close-contract-info aria-label="Close">x</button>
        </header>
        <div class="contract-protocol">
          <p>Contracts are in-game roleplay work orders. They can target any RP character name in the server, including LEOs, politicians, or civilians.</p>
          <p>Only verified civilian accounts can post or accept contracts. Owners can monitor the board but cannot accept or edit from this app.</p>
          <p>The poster stays anonymous on open contracts. Once a civilian accepts, the accepted contractor can see the poster and must submit an in-game clip URL as proof.</p>
          <p>No email lookup is used here. Use the target's RP character name.</p>
        </div>
        <button class="primary" type="button" data-close-contract-info>${ownerView ? "Enter monitor" : "Enter board"}</button>
      </section>
    </div>
  `;
}

function renderContractProofModal(item) {
  return `
    <div class="modal-backdrop" data-close-proof>
      <section class="mdt-modal contract-proof-modal" role="dialog" aria-modal="true">
        <header class="row">
          <div><p class="eyebrow">${escapeHtml(item.contract_number)}</p><h2>Proof clip</h2></div>
          <button class="icon-action" type="button" data-close-proof aria-label="Close">x</button>
        </header>
        <form id="contractProofForm" class="form-grid" data-contract-id="${item.id}">
          <label>In-game clip URL<input name="clip_url" type="url" value="${escapeHtml(item.clip_url || "")}" placeholder="https://..." required /></label>
          <label>Proof note<textarea name="proof_note" maxlength="600">${escapeHtml(item.proof_note || "")}</textarea></label>
          <button class="primary" type="submit">Submit proof</button>
        </form>
      </section>
    </div>
  `;
}

function bindContracts() {
  $$("[data-contract-tab]").forEach((button) => button.addEventListener("click", () => {
    state.contractsTab = button.dataset.contractTab;
    state.contractProofId = null;
    render();
  }));
  $("[data-contract-info]")?.addEventListener("click", () => {
    state.contractsInfoOpen = true;
    render();
  });
  $$("[data-close-contract-info]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    localStorage.setItem("rp_contracts_intro_seen", "1");
    state.contractsInfoOpen = false;
    render();
  }));
  $("#contractForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/contracts", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Contract posted");
      event.currentTarget.reset();
      await loadAppData("contracts");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-accept-contract]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/contracts/${button.dataset.acceptContract}/accept`, { method: "POST" });
      state.contractsTab = "accepted";
      state.contractProofId = button.dataset.acceptContract;
      toast("Contract accepted");
      await loadAppData("contracts");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-open-proof]").forEach((button) => button.addEventListener("click", () => {
    state.contractProofId = button.dataset.openProof;
    render();
  }));
  $$("[data-close-proof]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.contractProofId = null;
    render();
  }));
  $("#contractProofForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/contracts/${event.currentTarget.dataset.contractId}/proof`, {
        method: "POST",
        body: Object.fromEntries(new FormData(event.currentTarget).entries()),
      });
      state.contractProofId = null;
      toast("Proof submitted");
      await loadAppData("contracts");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderCourtLegacy() {
  const isJudge = can("judge") || can("owner");
  const mine = state.cache.court?.mine?.cases || [];
  const judgeCases = state.cache.court?.judge?.cases || [];
  return `
    <div class="stack">
      ${isJudge ? `<div class="segmented">
        <button class="${state.courtTab === "mine" ? "active" : ""}" data-court-tab="mine">My cases</button>
        <button class="${state.courtTab === "judge" ? "active" : ""}" data-court-tab="judge">Judge</button>
        <button class="${state.courtTab === "rules" ? "active" : ""}" data-court-tab="rules">Codes</button>
      </div>` : ""}
      ${state.courtTab === "judge" && isJudge ? renderJudgeCases(judgeCases) : state.courtTab === "rules" ? renderCourtRules() : renderMyCases(mine)}
    </div>
  `;
}

function renderMyCasesLegacy(cases) {
  return `
    <div class="list">
      ${cases.map((item) => `
        <article class="case-card">
          <div class="row"><h3>${escapeHtml(item.charge_code)} · ${escapeHtml(item.charge_title)}</h3><span class="pill ${item.status === "paid" ? "green" : item.status === "contested" ? "amber" : "red"}">${escapeHtml(item.status)}</span></div>
          <p class="muted small">${escapeHtml(item.location)} · Officer ${escapeHtml(item.officer_name)} · ${money(item.fine_amount)}</p>
          <p>${escapeHtml(item.narrative)}</p>
          <div class="row">
            <button class="secondary" data-contest-case="${item.id}" ${["paid", "dismissed", "contested"].includes(item.status) ? "disabled" : ""}>Contest</button>
            <button class="primary" data-pay-case="${item.id}" ${["paid", "dismissed"].includes(item.status) ? "disabled" : ""}>Pay fine</button>
          </div>
        </article>
      `).join("") || `<div class="empty">No citations or court cases</div>`}
    </div>
  `;
}

function renderJudgeCasesLegacy(cases) {
  return `
    <div class="list">
      ${cases.map((item) => `
        <article class="case-card">
          <div class="row"><h3>#${item.id} ${escapeHtml(item.charge_code)}</h3><span class="pill ${item.status === "contested" ? "amber" : "red"}">${escapeHtml(item.status)}</span></div>
          <p class="muted small">${escapeHtml(item.civ_name)} · ${escapeHtml(item.civ_email)} · Officer ${escapeHtml(item.officer_name)}</p>
          <p><strong>${escapeHtml(item.charge_title)}</strong> · ${money(item.fine_amount)}</p>
          <p>${escapeHtml(item.narrative)}</p>
          <form class="form-grid judge-form" data-case-id="${item.id}">
            <div class="grid-2">
              <label>Status<select name="status"><option>reviewed</option><option>reduced</option><option>dismissed</option><option>paid</option><option>contested</option></select></label>
              <label>Fine<input name="fine_amount" type="number" step="0.01" value="${escapeHtml(item.fine_amount)}" /></label>
            </div>
            <label>Judgment notes<input name="judgment_notes" value="${escapeHtml(item.judgment_notes || "")}" /></label>
            <button class="primary" type="submit">Update case</button>
          </form>
        </article>
      `).join("") || `<div class="empty">No cases waiting for review</div>`}
    </div>
  `;
}

function renderCourtRules() {
  return `<div class="card"><h3>Citation workflow</h3><p class="muted">Officers issue citations from the MDT. Civilians can pay or contest them here. Judges see issued and contested cases, then review, reduce, dismiss, or mark paid.</p></div>`;
}

function myFaircroftTaxAccounts(rows) {
  const accounts = new Map();
  rows.filter((item) => item.status === "unpaid").forEach((item) => {
    if (!accounts.has(item.business_id)) {
      accounts.set(item.business_id, {
        business_id: item.business_id,
        business_name: item.business_name,
        license_number: item.license_number,
        amount: 0,
        assessments: 0,
        payment_batch_status: item.payment_batch_status,
        payment_batch_number: item.payment_batch_number,
      });
    }
    const account = accounts.get(item.business_id);
    account.amount += Number(item.amount || 0);
    account.assessments += 1;
    account.payment_batch_status ||= item.payment_batch_status;
    account.payment_batch_number ||= item.payment_batch_number;
  });
  return Array.from(accounts.values());
}

function myFaircroftFineIsDue(item) {
  return !["paid", "dismissed"].includes(item.status)
    && !["not_guilty", "dismissed"].includes(item.disposition)
    && Number(item.fine_amount || 0) > 0;
}

function paymentState(item) {
  if (item.payment_item_status === "paid" || item.payment_batch_status === "completed") return "Paid";
  if (item.payment_batch_status && item.payment_batch_status !== "cancelled") {
    return item.payment_batch_status === "draft" ? "Awaiting clerk" : "Processing";
  }
  return "";
}

function renderMyFaircroft() {
  const data = state.cache["my-faircroft"] || {};
  const cases = data.cases || [];
  const taxes = data.taxes || [];
  const summary = data.summary || {};
  const recordRequests = data.record_requests || [];
  const taxAccounts = myFaircroftTaxAccounts(taxes);
  const dueFines = cases.filter(myFaircroftFineIsDue);
  const scheduledCases = cases.filter((item) => ["issued", "contested", "reviewed", "reduced", "continued"].includes(item.status));
  const historyCases = cases.filter((item) => !myFaircroftFineIsDue(item) || item.disposition);
  const paidTaxes = taxes.filter((item) => item.status === "paid");
  const tabs = [["overview", "Overview"], ["court-dates", `Court dates (${scheduledCases.length})`], ["fines", "Fines"], ["taxes", "Taxes"], ["history", "Records"]];
  const body = {
    overview: `
      <section class="myfc-action-ledger">
        <button data-myfc-tab="fines"><span>Fine balance</span><strong>${money(summary.outstanding_fines)}</strong><small>${dueFines.length} open item${dueFines.length === 1 ? "" : "s"}</small></button>
        <button data-myfc-tab="taxes"><span>Tax balance</span><strong>${money(summary.outstanding_taxes)}</strong><small>${taxAccounts.length} business account${taxAccounts.length === 1 ? "" : "s"}</small></button>
        <button data-myfc-tab="history"><span>Payment queue</span><strong>${Number(summary.pending_payments || 0)}</strong><small>Awaiting verified game-bank settlement</small></button>
      </section>
      <section class="myfc-notice">
        <span class="myfc-notice-mark">FC</span>
        <div><strong>Verified payment process</strong><p>Payment requests lock the expected in-game balance. A clerk completes the transaction, and your record changes to paid only after the Arma bank sync confirms the exact balance.</p></div>
      </section>
    `,
    "court-dates": renderMyFaircroftCourtDates(scheduledCases),
    fines: renderMyFaircroftFines(dueFines),
    taxes: renderMyFaircroftTaxes(taxAccounts),
    history: renderMyFaircroftHistory(historyCases, paidTaxes, recordRequests),
  }[state.myFaircroftTab] || "";
  return `
    <div class="myfc-app">
      <header class="myfc-identity">
        <div class="myfc-seal">SF</div>
        <div>
          <p class="eyebrow">State of Faircroft resident services</p>
          <h3>MyFaircroft</h3>
          <p>One account for court obligations, business taxes, and verified payment records.</p>
        </div>
        <div class="myfc-bank">
          <span>Synced game bank</span>
          <strong>${money(data.bank?.bank_balance)}</strong>
          <small>${data.bank?.bank_balance_synced ? "Connected" : "Awaiting account link"}</small>
        </div>
      </header>
      <nav class="myfc-tabs">
        ${tabs.map(([id, label]) => `<button class="${state.myFaircroftTab === id ? "active" : ""}" data-myfc-tab="${id}">${label}</button>`).join("")}
      </nav>
      <div class="myfc-content">${body}</div>
    </div>
  `;
}

function renderMyFaircroftCourtDates(cases) {
  return `
    <section class="myfc-ledger">
      <header><div><p class="eyebrow">Official court calendar</p><h3>Your scheduled matters</h3></div><span>${cases.length} active</span></header>
      ${cases.map((item) => `
        <article class="myfc-ledger-row court-date">
          <div class="myfc-ledger-code"><strong>${escapeHtml(item.court_date ? new Date(`${item.court_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "TBD")}</strong><small>${item.court_date ? new Date(`${item.court_date}T12:00:00`).getFullYear() : "Date pending"}</small></div>
          <div class="myfc-ledger-main">
            <h4>${escapeHtml(item.charge_code)} / ${escapeHtml(item.charge_title)}</h4>
            <p>Case #${item.id} · ${escapeHtml(item.kind === "criminal" ? "Criminal matter" : "Citation hearing")}</p>
            <small>${item.status === "continued" ? "Hearing continued by the Court" : "Scheduled appearance"}${item.judge_name ? ` · Judge ${escapeHtml(item.judge_name)}` : ""}</small>
          </div>
          <div class="myfc-ledger-money"><strong>${escapeHtml(item.court_date || "Pending")}</strong><span>${escapeHtml(item.status)}</span></div>
        </article>
      `).join("") || `<div class="empty">You have no scheduled court matters</div>`}
    </section>
  `;
}

function renderMyFaircroftFines(cases) {
  return `
    <section class="myfc-ledger">
      <header><div><p class="eyebrow">Court obligations</p><h3>Fines & citations</h3></div><span>${cases.length} open</span></header>
      ${cases.map((item) => {
        const pending = paymentState(item);
        const canContest = ["issued", "reviewed", "reduced"].includes(item.status) && !item.payment_batch_status;
        const canPay = item.status !== "contested" && !item.payment_batch_status;
        return `
          <article class="myfc-ledger-row">
            <div class="myfc-ledger-code"><strong>${escapeHtml(item.charge_code)}</strong><small>Case #${item.id}</small></div>
            <div class="myfc-ledger-main">
              <h4>${escapeHtml(item.charge_title)}</h4>
              <p>${escapeHtml(item.location)} / Court ${escapeHtml(item.court_date || "date pending")}</p>
              <small>Issued by ${escapeHtml(item.officer_name)}${item.judge_name ? ` / Assigned to ${escapeHtml(item.judge_name)}` : ""}</small>
              ${item.kind === "criminal" ? `<small class="sentence-line">RP sentencing standard: ${item.minimum_sentence_minutes}-${item.maximum_sentence_minutes} minutes if convicted</small>` : ""}
            </div>
            <div class="myfc-ledger-money"><strong>${money(item.fine_amount)}</strong><span>${pending || escapeHtml(item.status)}</span></div>
            <div class="myfc-ledger-actions">
              <button class="secondary" data-contest-case="${item.id}" ${canContest ? "" : "disabled"}>Contest</button>
              <button class="primary" data-pay-case="${item.id}" ${canPay ? "" : "disabled"}>${pending || "Request payment"}</button>
            </div>
          </article>
        `;
      }).join("") || `<div class="empty">No outstanding fines or citations</div>`}
    </section>
  `;
}

function renderMyFaircroftTaxes(accounts) {
  return `
    <section class="myfc-ledger">
      <header><div><p class="eyebrow">Department of revenue</p><h3>Business taxes</h3></div><span>${accounts.length} account${accounts.length === 1 ? "" : "s"}</span></header>
      ${accounts.map((item) => {
        const pending = item.payment_batch_status && item.payment_batch_status !== "cancelled"
          ? (item.payment_batch_status === "draft" ? "Awaiting clerk" : "Processing")
          : "";
        return `
          <article class="myfc-ledger-row tax">
            <div class="myfc-ledger-code"><strong>TAX</strong><small>${escapeHtml(item.license_number)}</small></div>
            <div class="myfc-ledger-main"><h4>${escapeHtml(item.business_name)}</h4><p>${item.assessments} unpaid assessment${item.assessments === 1 ? "" : "s"}</p><small>${pending ? `Payment request ${escapeHtml(item.payment_batch_number || "")}` : "Eligible for verified game-bank settlement"}</small></div>
            <div class="myfc-ledger-money"><strong>${money(item.amount)}</strong><span>${pending || "Due"}</span></div>
            <div class="myfc-ledger-actions"><button class="primary" data-pay-tax="${item.business_id}" ${pending ? "disabled" : ""}>${pending || "Request payment"}</button></div>
          </article>
        `;
      }).join("") || `<div class="empty">No unpaid business taxes</div>`}
    </section>
  `;
}

function renderMyFaircroftHistory(cases, taxes, recordRequests = []) {
  const latestRequests = new Map();
  recordRequests.forEach((request) => {
    const key = `${request.citation_id}:${request.request_type}`;
    if (!latestRequests.has(key)) latestRequests.set(key, request);
  });
  const entries = [
    ...cases.map((item) => ({
      id: item.id,
      kind: "case",
      date: item.updated_at,
      reference: `CASE-${item.id}`,
      title: `${item.charge_code} / ${item.charge_title}`,
      result: item.final_result || item.disposition || item.status,
      amount: item.fine_amount,
      decided_at: item.decided_at,
      expunged_at: item.record_expunged_at,
    })),
    ...taxes.map((item) => ({
      kind: "tax",
      date: item.settled_at || item.assessed_at,
      reference: item.payment_batch_number || item.license_number,
      title: `${item.business_name} / ${item.period_label}`,
      result: "Business tax paid",
      amount: item.amount,
    })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return `
    <section class="myfc-ledger">
      <header><div><p class="eyebrow">Official account record</p><h3>Decisions & receipts</h3></div><span>${entries.length} records</span></header>
      ${entries.map((item) => `
        <article class="myfc-history-row">
          <div><strong>${escapeHtml(item.reference)}</strong><small>${item.date ? new Date(item.date).toLocaleDateString() : "Date pending"}</small></div>
          <div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.result)}</p></div>
          <strong>${money(item.amount)}</strong>
          ${item.kind === "case" && item.decided_at && !item.expunged_at ? `
            <div class="myfc-record-actions">
              ${["appeal", "expungement"].map((requestType) => {
                const request = latestRequests.get(`${item.id}:${requestType}`);
                return request
                  ? `<span class="pill ${request.status === "approved" ? "green" : request.status === "denied" ? "red" : "amber"}">${requestType} ${escapeHtml(request.status)}</span>`
                  : `<details><summary>Request ${requestType === "appeal" ? "appeal" : "expungement"}</summary><form class="myfc-record-request-form" data-case-id="${item.id}" data-request-type="${requestType}"><label>Basis for request<textarea name="reason" minlength="20" maxlength="2000" required></textarea></label><label>Supporting statement<textarea name="supporting_statement" maxlength="3000" placeholder="Optional supporting facts, rehabilitation, errors, or changed circumstances."></textarea></label><button class="primary" type="submit">Submit to Court</button></form></details>`;
              }).join("")}
            </div>
          ` : item.expunged_at ? `<span class="pill green">Record expunged</span>` : ""}
        </article>
      `).join("") || `<div class="empty">No previous court or tax records</div>`}
    </section>
  `;
}

function bindMyFaircroft() {
  $$("[data-myfc-tab]").forEach((button) => button.addEventListener("click", () => {
    state.myFaircroftTab = button.dataset.myfcTab;
    render();
  }));
  $$("[data-pay-case]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const result = await api(`/api/my-faircroft/fines/${button.dataset.payCase}/pay`, { method: "POST" });
      toast(`Payment request ${result.batch_number} sent`);
      await loadAppData("my-faircroft");
      render();
    } catch (error) {
      if (error.message) toast(error.message);
    }
  }));
  $$("[data-contest-case]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/my-faircroft/fines/${button.dataset.contestCase}/contest`, { method: "POST" });
      toast("Case sent to the Court docket");
      await loadAppData("my-faircroft");
      render();
    } catch (error) {
      if (error.message) toast(error.message);
    }
  }));
  $$("[data-pay-tax]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const result = await api(`/api/my-faircroft/taxes/${button.dataset.payTax}/pay`, { method: "POST" });
      toast(`Tax payment request ${result.batch_number} sent`);
      await loadAppData("my-faircroft");
      render();
    } catch (error) {
      if (error.message) toast(error.message);
    }
  }));
  $$(".myfc-record-request-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/my-faircroft/records/${form.dataset.caseId}/${form.dataset.requestType === "expungement" ? "expunge" : "appeal"}`, {
        method: "POST",
        body: Object.fromEntries(new FormData(form).entries()),
      });
      toast(`${form.dataset.requestType === "expungement" ? "Expungement" : "Appeal"} request sent to Court`);
      await loadAppData("my-faircroft");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function renderCourt() {
  const data = state.cache.court || {};
  const active = data.active || [];
  const decided = data.decided || [];
  const stats = data.stats || {};
  const petitions = data.petitions || [];
  const tabs = [["docket", "Active docket"], ["petitions", `Petitions (${Number(stats.petitions || 0)})`], ["decisions", `Completed docket (${Number(stats.decided || 0)})`], ["standards", "Sentencing"]];
  if (!tabs.some(([id]) => id === state.courtTab)) state.courtTab = "docket";
  if (!active.some((item) => Number(item.id) === Number(state.courtSelectedCaseId))) {
    state.courtSelectedCaseId = active[0]?.id || null;
  }
  const content = state.courtTab === "docket"
    ? renderCourtDocket(active)
    : state.courtTab === "petitions"
      ? renderCourtPetitions(petitions)
      : state.courtTab === "decisions"
        ? renderCourtDecisions(decided)
        : renderCourtStandards(data.standards || []);
  return `
    <div class="court-app court-bench">
      <header class="court-identity">
        <div class="court-seal">SF</div>
        <div><p class="eyebrow">State of Faircroft judiciary</p><h3>Court Operations</h3><p>Official judicial docket. Personal fines and taxes remain in MyFaircroft.</p></div>
        <dl>
          <div><dt>Open</dt><dd>${Number(stats.active || 0)}</dd></div>
          <div><dt>Contested</dt><dd>${Number(stats.contested || 0)}</dd></div>
          <div><dt>Criminal</dt><dd>${Number(stats.criminal || 0)}</dd></div>
          ${Number(stats.conflicts || 0) ? `<div class="court-conflict-stat"><dt>Conflicts</dt><dd>${Number(stats.conflicts)}</dd></div>` : ""}
        </dl>
      </header>
      ${Number(stats.conflicts || 0) ? `<div class="court-conflict-alert"><strong>CONFLICT-OF-INTEREST RECORDS DETECTED</strong><span>${Number(stats.conflicts)} active case${Number(stats.conflicts) === 1 ? "" : "s"} involve you as defendant or issuing officer. Judicial controls are locked on those records.</span></div>` : ""}
      <nav class="court-bench-tabs">${tabs.map(([id, label]) => `<button class="${state.courtTab === id ? "active" : ""}" data-court-tab="${id}">${label}</button>`).join("")}</nav>
      ${content}
    </div>
  `;
}

function renderCourtPetitions(petitions) {
  return `
    <section class="court-petitions">
      <header><div><p class="eyebrow">Post-judgment review</p><h3>Appeals & Expungement Petitions</h3></div><span>${petitions.filter((item) => item.status === "pending").length} pending</span></header>
      <div class="court-petition-list">
        ${petitions.map((item) => `
          <article class="court-petition ${item.status}">
            <header>
              <div><span>${escapeHtml(item.request_type)}</span><h4>Case #${item.citation_id} / ${escapeHtml(item.charge_code)} ${escapeHtml(item.charge_title)}</h4><small>${escapeHtml(item.civ_name)} / CIV ${escapeHtml(item.civ_number || "pending")} / filed ${new Date(item.created_at).toLocaleString()}</small></div>
              <span class="pill ${item.status === "pending" ? "amber" : item.status === "approved" ? "green" : "red"}">${escapeHtml(item.status)}</span>
            </header>
            <div class="court-petition-body"><strong>Basis for request</strong><p>${escapeHtml(item.reason)}</p>${item.supporting_statement ? `<strong>Supporting statement</strong><p>${escapeHtml(item.supporting_statement)}</p>` : ""}<small>Original result: ${escapeHtml(item.final_result || "Filed court decision")}</small></div>
            ${item.conflict_of_interest ? `<div class="court-conflict-lock"><span>JUDICIAL CONFLICT — ACTION LOCKED</span><strong>${escapeHtml((item.conflict_reasons || []).join(" · "))}</strong><p>This petition must be reviewed by another authorized court official.</p></div>` : item.status === "pending" ? `
              <form class="court-petition-form" data-petition-id="${item.id}">
                <label>Judicial decision notes<textarea name="decision_notes" rows="3" minlength="3" required placeholder="State the reason for approving or denying this petition."></textarea></label>
                <div><button class="secondary" type="submit" name="decision" value="denied">Deny petition</button><button class="primary" type="submit" name="decision" value="approved">Approve ${item.request_type}</button></div>
              </form>
            ` : `<div class="court-petition-decision"><strong>${escapeHtml(item.judge_name || "Court")}</strong><p>${escapeHtml(item.decision_notes || "Decision filed")}</p></div>`}
          </article>
        `).join("") || `<div class="empty">No appeal or expungement petitions have been filed.</div>`}
      </div>
    </section>
  `;
}

function renderCourtWorkspace() {
  return `
    <section class="court-workspace">
      <header class="court-workspace-topbar">
        <div>
          <p class="eyebrow">State of Faircroft Judiciary</p>
          <h1>Court Management System</h1>
          <p>Official docket, judicial findings, sentencing standards, and filed decisions.</p>
        </div>
        <div class="court-workspace-actions">
          <span class="court-session-status"><i></i> Judicial session active</span>
          <button class="secondary" type="button" data-refresh-court>Refresh docket</button>
          <button class="primary" type="button" data-close-court>Exit Court</button>
        </div>
      </header>
      <main class="court-workspace-content">${renderCourt()}</main>
    </section>
  `;
}

function bindCourtWorkspace() {
  bindCourt();
  $("[data-close-court]")?.addEventListener("click", async () => {
    state.activeApp = null;
    state.courtSelectedCaseId = null;
    await loadSession();
  });
  $("[data-refresh-court]")?.addEventListener("click", async () => {
    await loadAppData("court");
    render();
  });
}

function renderCourtDocket(cases) {
  const selected = cases.find((item) => Number(item.id) === Number(state.courtSelectedCaseId));
  return `
    <div class="court-bench-layout">
      <aside class="court-docket-list">
        <header><span>Assigned docket</span><strong>${cases.length}</strong></header>
        ${cases.map((item) => `
          <button class="${selected?.id === item.id ? "active" : ""} ${item.conflict_of_interest ? "conflict" : ""}" data-court-select="${item.id}">
            <span><strong>#${item.id} ${escapeHtml(item.charge_code)}</strong><small>${escapeHtml(item.civ_name)} / ${escapeHtml(item.kind)}</small></span>
            <i class="${item.conflict_of_interest ? "red" : item.status === "contested" ? "amber" : ""}">${item.conflict_of_interest ? "CONFLICT" : escapeHtml(item.status)}</i>
          </button>
        `).join("") || `<div class="empty">No cases awaiting court action</div>`}
      </aside>
      <section class="court-case-file">${selected ? renderCourtCaseFile(selected) : `<div class="court-file-empty"><span>COURT</span><h3>Docket clear</h3><p>No case is waiting for judicial action.</p></div>`}</section>
    </div>
  `;
}

function renderCourtCaseFile(item) {
  const criminal = item.kind === "criminal";
  const dispositions = criminal
    ? [["under_review", "Place under review"], ["continued", "Continue hearing"], ["guilty", "Guilty"], ["plea_agreement", "Accept plea agreement"], ["not_guilty", "Not guilty"], ["dismissed", "Dismiss case"]]
    : [["under_review", "Place under review"], ["continued", "Continue hearing"], ["liable", "Liable"], ["not_guilty", "Not liable"], ["dismissed", "Dismiss citation"]];
  return `
    <article class="court-file">
      <header>
        <div><p class="eyebrow">Case file FC-${item.id}</p><h3>${escapeHtml(item.charge_code)} / ${escapeHtml(item.charge_title)}</h3></div>
        <span class="pill ${item.status === "contested" ? "amber" : "red"}">${escapeHtml(item.status)}</span>
      </header>
      <dl class="court-file-meta">
        <div><dt>Defendant</dt><dd>${escapeHtml(item.civ_name)} <small>CIV ${escapeHtml(item.civ_number)}</small></dd></div>
        <div><dt>Filing officer</dt><dd>${escapeHtml(item.officer_name)}</dd></div>
        <div><dt>Hearing date</dt><dd>${escapeHtml(item.court_date || "Pending")}</dd></div>
        <div><dt>Matter</dt><dd>${criminal ? "Criminal" : "Citation"} / ${escapeHtml(item.severity)}</dd></div>
      </dl>
      <section class="court-allegation"><span>Filed narrative</span><p>${escapeHtml(item.narrative)}</p><small>${escapeHtml(item.location)}</small></section>
      ${item.conflict_of_interest ? `<section class="court-conflict-lock"><span>JUDICIAL CONFLICT — CASE LOCKED</span><strong>${escapeHtml((item.conflict_reasons || []).join(" · "))}</strong><p>You may review this record for disclosure purposes, but you cannot open judicial action controls, enter findings, sentence, dismiss, or otherwise affect this case. Another court official must preside.</p></section>` : ""}
      ${criminal ? `
        <section class="court-sentence-band">
          <div><span>Mandatory RP minimum</span><strong>${Number(item.minimum_sentence_minutes || 0)} min</strong></div>
          <div><span>Guideline maximum</span><strong>${Number(item.maximum_sentence_minutes || 0)} min</strong></div>
          <p>These are gameplay minutes for Faircroft RP. They are not real-world years or real legal sentencing.</p>
        </section>
      ` : ""}
      ${item.conflict_of_interest ? "" : `<form class="court-decision-form" data-case-id="${item.id}">
        <header><div><p class="eyebrow">Judicial action</p><h4>Findings & disposition</h4></div><span>Digitally filed to both parties</span></header>
        <p class="court-disposition-guidance">Final dispositions move this matter to the Completed docket. Only “Place under review” and “Continue hearing” keep it active.</p>
        <div class="grid-2">
          <label>Disposition<select name="disposition">${dispositions.map(([value, label]) => `<option value="${value}"${selectedAttr(value, item.disposition || "under_review")}>${label}</option>`).join("")}</select></label>
          <label>Fine amount<input name="fine_amount" type="number" min="0" step="0.01" value="${escapeHtml(item.fine_amount)}" required /></label>
        </div>
        <label class="court-continuance-date">Next court date<input name="court_date" type="date" min="${new Date().toISOString().slice(0, 10)}" value="${escapeHtml(item.court_date || "")}" /><small>Required when continuing the hearing. The new date is published immediately to the civilian's Court dates tab.</small></label>
        ${criminal ? `<label>RP sentence in minutes<input name="sentence_minutes" type="number" min="0" max="${Number(item.maximum_sentence_minutes || 999)}" value="${Number(item.sentence_minutes || item.minimum_sentence_minutes || 0)}" required /><small>Convictions cannot be filed below ${Number(item.minimum_sentence_minutes || 0)} minutes or above ${Number(item.maximum_sentence_minutes || 0)} minutes.</small></label>` : `<input name="sentence_minutes" type="hidden" value="0" />`}
        <label>Written findings<textarea name="judgment_notes" rows="5" maxlength="2000" placeholder="State the finding, evidence considered, and reason for the disposition.">${escapeHtml(item.judgment_notes || "")}</textarea></label>
        ${criminal ? `<label>Sentence conditions<textarea name="sentence_notes" rows="3" maxlength="1200" placeholder="Time served, release conditions, probation RP, or other court direction.">${escapeHtml(item.sentence_notes || "")}</textarea></label>` : ""}
        <button class="primary" type="submit">Sign & file court action</button>
      </form>`}
    </article>
  `;
}

function renderCourtDecisions(cases) {
  return `
    <section class="court-decisions">
      <header><div><p class="eyebrow">Filed orders</p><h3>Previous decisions</h3></div><span>${cases.length} records</span></header>
      ${cases.map((item) => `
        <article class="${item.conflict_of_interest ? "conflict" : ""}">
          <div><strong>FC-${item.id}</strong><small>${escapeHtml(item.decided_at ? new Date(item.decided_at).toLocaleDateString() : item.updated_at ? new Date(item.updated_at).toLocaleDateString() : "")}</small></div>
          <div><h4>${escapeHtml(item.charge_code)} / ${escapeHtml(item.civ_name)}</h4><p>${escapeHtml(item.final_result || item.disposition || item.status)}</p></div>
          <span>${item.conflict_of_interest ? "CONFLICT" : item.sentence_minutes ? `${item.sentence_minutes} min` : money(item.fine_amount)}</span>
        </article>
      `).join("") || `<div class="empty">No filed decisions</div>`}
    </section>
  `;
}

function renderCourtStandards(standards) {
  return `
    <section class="court-standards">
      <header><div><p class="eyebrow">Faircroft RP standard</p><h3>Mandatory sentencing schedule</h3></div><p>Custodial time is measured in playable RP minutes. Non-custodial findings, dismissals, and not-guilty decisions carry no jail time.</p></header>
      <div class="court-standard-table">
        <div class="head"><span>Offense class</span><span>Minimum</span><span>Maximum</span><span>Codes</span></div>
        ${standards.map((item) => `<div><strong>${escapeHtml(item.severity)}</strong><span>${Number(item.minimum_sentence_minutes || 0)} min</span><span>${Number(item.maximum_sentence_minutes || 0)} min</span><span>${Number(item.code_count || 0)}</span></div>`).join("")}
      </div>
    </section>
  `;
}

function bindCourt() {
  $$("[data-court-tab]").forEach((button) => button.addEventListener("click", () => {
    state.courtTab = button.dataset.courtTab;
    render();
  }));
  $$("[data-court-select]").forEach((button) => button.addEventListener("click", () => {
    state.courtSelectedCaseId = Number(button.dataset.courtSelect);
    render();
  }));
  $$(".court-decision-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Filing court action...";
    try {
      const result = await api(`/api/court/cases/${form.dataset.caseId}`, {
        method: "PATCH",
        body: Object.fromEntries(new FormData(form).entries()),
      });
      toast(result.final_decision
        ? `Case completed: ${result.final_result || result.disposition}`
        : result.disposition === "continued"
          ? `Hearing continued to ${result.court_date}`
          : `Case remains active: ${String(result.disposition || "").replaceAll("_", " ")}`);
      state.courtSelectedCaseId = null;
      if (result.final_decision) state.courtTab = "decisions";
      await loadAppData("court");
      render();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "Sign & file court action";
      if (error.message) toast(error.message);
    }
  }));
  $$(".court-petition-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    try {
      await api(`/api/court/petitions/${form.dataset.petitionId}`, {
        method: "PATCH",
        body: {
          decision: submitter?.value,
          decision_notes: new FormData(form).get("decision_notes"),
        },
      });
      toast(`Petition ${submitter?.value || "updated"}`);
      await loadAppData("court");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function renderMdtLegacy() {
  return `
    <div class="mdt-shell">
      <div class="mdt-banner">
        <h3>${escapeHtml(state.session.user.primary_agency || "LEO Console")}</h3>
        <p class="muted small">NCIC, DMV, ticketing, court queue, and emergency alerting.</p>
      </div>
      <div class="segmented">
        <button class="${state.mdtTab === "search" ? "active" : ""}" data-mdt-tab="search">NCIC</button>
        <button class="${state.mdtTab === "ticket" ? "active" : ""}" data-mdt-tab="ticket">Ticket</button>
        <button class="${state.mdtTab === "panic" ? "active" : ""}" data-mdt-tab="panic">Panic</button>
      </div>
      ${state.mdtTab === "ticket" ? renderTicketWriter() : state.mdtTab === "panic" ? renderPanic() : renderMdtSearch()}
    </div>
  `;
}

function renderMdtSearchLegacy() {
  const results = state.cache.mdt?.search || [];
  const canViewAccountEmail = canAny("owner", "admin");
  return `
    <form id="mdtSearch" class="card form-grid">
      <label>${canViewAccountEmail ? "Name, email, CIV, or plate" : "Name, CIV, or plate"}<input name="q" minlength="2" required /></label>
      <button class="primary" type="submit">Search NCIC</button>
    </form>
    <div class="list">
      ${results.map((item) => `
        <article class="record-card">
          <div class="row"><h3>${escapeHtml(item.name)}</h3><span class="pill ${item.verified ? "green" : "amber"}">${item.verified ? "verified" : "unverified"}</span></div>
          <p class="muted small">${canViewAccountEmail && item.email ? `${escapeHtml(item.email)} / ` : ""}${escapeHtml(item.plate || "No plate")}</p>
          <div class="grid-2">
            <div class="metric"><span>License</span><strong>${escapeHtml(item.license_status || "None")}</strong></div>
            <div class="metric"><span>Vehicle</span><strong>${escapeHtml([item.vehicle_color, item.vehicle_make, item.vehicle_model].filter(Boolean).join(" "))}</strong></div>
          </div>
          <div class="list">
            ${(item.open_cases || []).map((c) => `<div class="row"><span>${escapeHtml(c.charge_code)} ${escapeHtml(c.charge_title)}</span><strong>${money(c.fine_amount)}</strong></div>`).join("") || `<p class="muted small">No open citations</p>`}
          </div>
        </article>
      `).join("") || `<div class="empty">Run a search to pull DMV and case records</div>`}
    </div>
  `;
}

function renderTicketWriterLegacy() {
  const charges = state.cache.mdt?.charges?.charges || [];
  return `
    <form id="ticketForm" class="card form-grid">
      <label>Civilian user ID<input name="civ_id" type="number" required /></label>
      <label>Charge<select name="charge_id" required>
        ${charges.map((charge) => `<option value="${charge.id}">${escapeHtml(charge.code)} · ${escapeHtml(charge.title)} · ${money(charge.fine_amount)}</option>`).join("")}
      </select></label>
      <label>Location<input name="location" required /></label>
      <label>Court date<input name="court_date" type="date" /></label>
      <label>Narrative<textarea name="narrative" required></textarea></label>
      <button class="primary" type="submit">Issue citation</button>
    </form>
    <div class="list">
      ${charges.slice(0, 8).map((charge) => `<article class="charge-card"><div class="row"><strong>${escapeHtml(charge.code)}</strong><span class="pill">${escapeHtml(charge.severity)}</span></div><p class="muted small">${escapeHtml(charge.description)}</p></article>`).join("")}
    </div>
  `;
}

function renderPanicLegacy() {
  const alerts = state.cache.mdt?.alerts?.alerts || [];
  return `
    <form id="panicForm" class="card form-grid">
      <button class="panic-button pulse" type="submit">PANIC BUTTON</button>
      <label>Location<input name="location" placeholder="Nearest postal / street" /></label>
      <label>Note<input name="note" placeholder="Short emergency note" /></label>
    </form>
    <div class="list">
      ${alerts.map((alert) => `<article class="case-card"><div class="row"><h3>${escapeHtml(alert.officer_name)}</h3><span class="pill red">${escapeHtml(alert.status)}</span></div><p>${escapeHtml(alert.location)}</p><p class="muted small">${escapeHtml(alert.note)}</p></article>`).join("") || `<div class="empty">No panic activations</div>`}
    </div>
  `;
}

function bindMdtLegacy() {
  $$("[data-mdt-tab]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTab = button.dataset.mdtTab;
    render();
  }));
  $("#mdtSearch")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q");
    try {
      const results = await api(`/api/mdt/search?q=${encodeURIComponent(q)}`);
      state.cache.mdt.search = results.results;
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#ticketForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      await api("/api/mdt/citations", { method: "POST", body: payload });
      toast("Citation issued");
      event.currentTarget.reset();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#panicForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/mdt/panic", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("911 alert sent");
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderMdtWorkspace() {
  const charges = state.cache.mdt?.charges || {};
  const alerts = state.cache.mdt?.alerts?.alerts || [];
  const activeBolos = state.cache.mdt?.bolos?.active || [];
  const activeBookings = state.cache.mdt?.bookings?.active || [];
  const cid = state.cache.mdt?.cid;
  const mdtCommandEnabledNow = mdtCommandEnabled();
  const commandLabel = mdtCommandLabel();
  if (!mdtCommandEnabledNow && String(state.mdtTab || "").startsWith("cid-")) {
    state.mdtTab = "search";
  }
  const priorityCases = (cid?.investigations || []).filter((item) => ["critical", "elevated"].includes(item.priority));
  const cidWarrantModal = mdtCommandEnabledNow && state.cidWarrantModalId
    ? renderCidWarrantModal((cid?.warrants || []).find((item) => String(item.id) === String(state.cidWarrantModalId)))
    : "";
  const navItems = mdtCommandEnabledNow ? [
    ["cid-command", `${commandLabel} Command`],
    ["search", "NCIC / DMV"],
    ["cid-investigations", "Case Folders"],
    ["cid-warrants", "Warrant Ops"],
    ["cid-ia", "Internal Affairs"],
    ["bolos", "BOLOs"],
    ["cad-reports", "Reports"],
    ["ticket", "Issue"],
    ["booking", "Booking"],
    ["criminal", "Criminal"],
    ["citations", "Citations"],
    ["mdt-settings", "Settings"],
    ["panic", "Panic"],
  ] : [
    ["search", "NCIC / DMV"],
    ["bolos", "BOLOs"],
    ["cad-reports", "Reports"],
    ["ticket", "Issue"],
    ["booking", "Booking"],
    ["citations", "Citations"],
    ["criminal", "Criminal"],
    ["mdt-settings", "Settings"],
    ["panic", "Panic"],
  ];
  const activeNavLabel = navItems.find(([id]) => id === state.mdtTab)?.[1] || "NCIC / DMV";
  const terminalTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `
    <section class="mdt-workspace mdt-redesign ${mdtCommandEnabledNow ? "cid-workspace" : ""}">
      <header class="mdt-topbar">
        <div>
          <p class="eyebrow mdt-live-kicker"><span class="mdt-live-dot"></span>${mdtCommandEnabledNow ? commandLabel : "Law Enforcement"} <b>Secure session</b></p>
          <h1>${mdtCommandEnabledNow ? `${commandLabel} Command MDT` : "Mobile Data Terminal"}</h1>
          <p class="mdt-subtitle">${mdtCommandEnabledNow ? "Investigations / warrants / booking / internal affairs" : "NCIC / DMV / citations / reports / booking"}</p>
          <div class="mdt-status-line">
            <span>${escapeHtml(activeNavLabel)}</span>
            <span>${escapeHtml(terminalTime)}</span>
          </div>
        </div>
        <div class="mdt-top-actions">
          <button class="ghost mdt-mobile-action" data-open-mdt-nav>Menu</button>
          <button class="ghost mdt-mobile-action" data-open-mdt-side>Watch</button>
          ${canUseMdtMessages() ? `<button class="ghost mdt-mobile-action" data-open-mdt-messages>Messages</button>` : ""}
          <button class="ghost" data-refresh-mdt>Refresh</button>
          <button class="secondary" data-close-mdt>Exit MDT</button>
        </div>
      </header>
      ${renderMdtQuickRail()}
      <div class="mdt-stat-strip ${mdtCommandEnabledNow ? "cid-stat-strip" : "leo-stat-strip"}">
        ${mdtCommandEnabledNow ? `
          <div class="metric"><span>Case folders</span><strong>${cid?.stats?.open_investigations || 0}</strong></div>
          <div class="metric"><span>Priority watch</span><strong>${priorityCases.length}</strong></div>
          <div class="metric"><span>Active warrants</span><strong>${cid?.stats?.active_warrants || 0}</strong></div>
          <div class="metric"><span>Bookings</span><strong>${activeBookings.length}</strong></div>
          <div class="metric"><span>IA open</span><strong>${cid?.stats?.ia_open || 0}</strong></div>
          <div class="metric"><span>Active BOLOs</span><strong>${activeBolos.length}</strong></div>
        ` : `
          <div class="metric"><span>Citations</span><strong>${(charges.citations || []).length}</strong></div>
          <div class="metric"><span>Criminal Codes</span><strong>${(charges.criminal_charges || []).length}</strong></div>
          <div class="metric"><span>Bookings</span><strong>${activeBookings.length}</strong></div>
          <div class="metric"><span>Officer Alerts</span><strong>${alerts.filter((alert) => alert.status === "active").length}</strong></div>
          <div class="metric"><span>Active BOLOs</span><strong>${activeBolos.length}</strong></div>
        `}
      </div>
      <div class="mdt-layout">
        <aside class="mdt-nav ${state.mdtNavOpen ? "open" : ""}">
          <div class="mdt-drawer-head"><strong>MDT Menu</strong><button class="icon-action" data-close-mdt-drawers aria-label="Close">x</button></div>
          ${navItems.map(([id, label], index) => `<button class="${state.mdtTab === id ? "active" : ""}" data-mdt-tab="${id}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(label)}</strong></button>`).join("")}
        </aside>
        <main class="mdt-main">${renderMdtContent()}</main>
        <aside class="mdt-side ${state.mdtSideOpen ? "open" : ""}">
          <div class="mdt-drawer-head"><strong>Watch Panel</strong><button class="icon-action" data-close-mdt-drawers aria-label="Close">x</button></div>
          ${renderMdtSide()}
        </aside>
      </div>
      ${renderMdtMobileDrawer(navItems)}
      ${state.mdtCatalogOpen ? renderMdtCatalogModal() : ""}
      ${state.mdtNotice ? renderMdtNoticeModal() : ""}
      ${state.mdtTrafficStopActive ? renderTrafficStopAssistantModal() : ""}
      ${state.mdtProfileUserId ? renderMdtProfileModal() : ""}
      ${cidWarrantModal}
    </section>
  `;
}

function renderMdtMobileDrawer(navItems) {
  if (!state.mdtNavOpen && !state.mdtSideOpen) return "";
  const menuOpen = Boolean(state.mdtNavOpen);
  return `
    <div class="mdt-mobile-drawer-layer ${menuOpen ? "menu-open" : "watch-open"}" role="dialog" aria-modal="true" aria-label="${menuOpen ? "MDT Menu" : "Watch Panel"}">
      <button class="mdt-mobile-drawer-scrim" type="button" data-close-mdt-drawers aria-label="Close MDT drawer"></button>
      <aside class="mdt-mobile-drawer ${menuOpen ? "menu" : "watch"}">
        <div class="mdt-drawer-head">
          <strong>${menuOpen ? "MDT Menu" : "Watch Panel"}</strong>
          <button class="icon-action" type="button" data-close-mdt-drawers aria-label="Close">x</button>
        </div>
        ${menuOpen
          ? navItems.map(([id, label], index) => `<button class="${state.mdtTab === id ? "active" : ""}" data-mdt-tab="${id}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(label)}</strong></button>`).join("")
          : renderMdtSide()}
      </aside>
    </div>
  `;
}

function renderMdtQuickRail() {
  const unread = Number(state.session?.unread_messages || 0);
  return `
    <nav class="mdt-quick-rail" aria-label="MDT quick access">
      ${canUseMdtMessages() ? `
        <button type="button" data-open-mdt-messages aria-label="Open messages">
          ${iconSvg.message}
          <span>Messages${unread ? `<b>${unread}</b>` : ""}</span>
        </button>
      ` : ""}
      <button type="button" data-open-mdt-side aria-label="Open watch panel">
        ${iconSvg.target}
        <span>Watch</span>
      </button>
    </nav>
  `;
}

function bindMdtWorkspace() {
  $("[data-close-mdt]")?.addEventListener("click", async () => {
    state.activeApp = null;
    state.returnToMdtOnClose = false;
    state.mdtCatalogOpen = false;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    await loadSession();
  });
  $$("[data-open-mdt-messages]")?.forEach((button) => button.addEventListener("click", async () => {
    if (!canUseMdtMessages()) {
      toast("You must be verified to open Messages.");
      return;
    }
    state.returnToMdtOnClose = true;
    state.activeApp = "messages";
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    await loadAppData("messages");
    render();
  }));
  $$("[data-open-mdt-nav]").forEach((button) => button.addEventListener("click", () => {
    state.mdtNavOpen = true;
    state.mdtSideOpen = false;
    render();
  }));
  $$("[data-open-mdt-side]").forEach((button) => button.addEventListener("click", () => {
    state.mdtSideOpen = true;
    state.mdtNavOpen = false;
    render();
  }));
  $$("[data-close-mdt-drawers]").forEach((button) => button.addEventListener("click", () => {
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    render();
  }));
  $("[data-refresh-mdt]")?.addEventListener("click", async () => {
    await loadAppData("mdt");
    render();
  });
  bindMdt();
}

function dispatchStatusClass(status) {
  if (["cleared", "closed"].includes(status)) return "green";
  if (["held", "staged"].includes(status)) return "amber";
  if (["active", "responding", "on_scene"].includes(status)) return "red";
  return "amber";
}

function dispatchPriorityClass(priority) {
  if (priority === "critical") return "red";
  if (priority === "elevated") return "amber";
  return "green";
}

function dispatchCallAssignments(data, callId, includeDetached = false) {
  return (data.assignments || []).filter((item) =>
    String(item.alert_id) === String(callId) && (includeDetached || !item.detached_at)
  );
}

function dispatchCallNotes(data, callId) {
  return (data.notes || [])
    .filter((item) => String(item.alert_id) === String(callId))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

async function runDispatchNcicQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (!query) {
    toast("No caller details available to lookup.");
    return;
  }
  state.dispatchNcicQuery = query;
  try {
    const result = await api(`/api/mdt/search?q=${encodeURIComponent(query)}`);
    state.dispatchNcicResults = result.results || [];
    render();
  } catch (error) {
    toast(error.message);
  }
}

function renderDispatchWorkspace() {
  const data = state.cache.dispatch || {};
  const calls = data.calls || [];
  const canManageDispatch = Boolean(data.can_manage_dispatch);
  const canViewAccountEmail = canAny("owner", "admin");
  const ncicResults = state.dispatchNcicResults || [];
  const stats = data.stats || { active: 0, critical: 0, assigned_units: 0, police: 0, fire: 0, ems: 0 };
  const activeStatuses = ["active", "staged", "responding", "on_scene", "held"];
  const activeCalls = calls.filter((call) => activeStatuses.includes(call.status));
  const pastCalls = calls.filter((call) => !activeStatuses.includes(call.status));
  const visibleCalls = activeCalls;
  const selectedCandidate = calls.find((call) => String(call.id) === String(state.dispatchSelectedCallId));
  const selectedCandidateIsActive = selectedCandidate && activeStatuses.includes(selectedCandidate.status);
  const selected = state.dispatchViewingPastCall && selectedCandidate
    ? selectedCandidate
    : selectedCandidateIsActive
      ? selectedCandidate
      : visibleCalls[0] || null;
  if (selected && !activeStatuses.includes(selected.status)) {
    state.dispatchViewingPastCall = true;
  } else if (selected) {
    state.dispatchViewingPastCall = false;
  }
  state.dispatchSelectedCallId = selected?.id || null;
  const activeAssignments = selected ? dispatchCallAssignments(data, selected.id) : [];
  const allAssignments = selected ? dispatchCallAssignments(data, selected.id, true) : [];
  const notes = selected ? dispatchCallNotes(data, selected.id) : [];
  const assignedUnitIds = new Set(activeAssignments.map((item) => String(item.unit_id)));
  const availableUnits = (data.units || []).filter((unit) => !assignedUnitIds.has(String(unit.id)));
  const unitStatuses = ["assigned", "enroute", "on_scene", "staged", "cleared"];
  const priorities = ["standard", "elevated", "critical"];
  const callActionButtons = [
    ["active", "Reopen"],
    ["staged", "Stage"],
    ["responding", "Responding"],
    ["on_scene", "On Scene"],
    ["held", "Hold"],
    ["cleared", "Clear"],
    ["closed", "Close Ticket"],
  ];
  const departments = ["police", "fire", "ems"];
  const callTypes = ["911 Call", "Traffic Stop", "Robbery", "Shots Fired", "Medical", "Fire", "Welfare Check", "Disturbance", "Officer Assist", "Other"];
  const pastCallsMarkup = pastCalls.map((call) => {
    const callAssignments = dispatchCallAssignments(data, call.id, true);
    const callNotes = dispatchCallNotes(data, call.id);
    const latestNote = callNotes[callNotes.length - 1];
    const latestNoteText = latestNote ? String(latestNote.body || "").slice(0, 320) : "";
    return `
      <article class="dispatch-past-call">
        <div class="dispatch-past-call-head">
          <span class="dispatch-ticket-top">
            <strong>#${call.id} ${escapeHtml(call.call_type || "Emergency Call")}</strong>
            <span class="pill ${dispatchPriorityClass(call.priority)}">${escapeHtml(call.priority || "standard")}</span>
          </span>
          <span class="pill ${dispatchStatusClass(call.status)}">${escapeHtml(call.status || "active")}</span>
        </div>
        <div class="dispatch-past-call-meta">
          <div><span>Department</span><strong>${escapeHtml((call.department || "police").toUpperCase())}</strong></div>
          <div><span>Caller</span><strong>${escapeHtml(call.caller_name || call.created_by_name || "Unknown")}</strong></div>
          <div><span>Location</span><strong>${escapeHtml(call.location || "Unknown")}</strong></div>
          <div><span>Units</span><strong>${callAssignments.length}</strong></div>
          <div><span>Created</span><strong>${call.created_at ? new Date(call.created_at).toLocaleString() : "N/A"}</strong></div>
          <div><span>Updated</span><strong>${call.updated_at ? new Date(call.updated_at).toLocaleString() : "N/A"}</strong></div>
        </div>
        <div class="dispatch-call-note">
          <strong>Intake note</strong>
          <p>${escapeHtml(call.note || "No intake note")}</p>
        </div>
        <div class="dispatch-call-note">
          <strong>${latestNote ? escapeHtml(latestNote.note_type || "dispatch update") : "Latest dispatch note"}</strong>
          <p>${latestNoteText ? escapeHtml(latestNoteText) : "No dispatch notes yet"}</p>
        </div>
        <div class="row">
          <div class="muted small">Call ID ${call.id}</div>
          <button class="secondary" type="button" data-open-dispatch-past-call="${call.id}">Open in CAD</button>
        </div>
      </article>
    `;
  }).join("");
  const pastCallsModal = state.dispatchPastOpen ? `
    <div class="modal-backdrop dispatch-past-backdrop" data-close-dispatch-past>
      <section class="mdt-modal dispatch-past-modal" role="dialog" aria-modal="true" aria-label="Past dispatch calls">
        <header class="row">
          <div>
            <p class="eyebrow">Dispatch Archive</p>
            <h2>Past Calls</h2>
          </div>
          <button class="icon-action" type="button" data-close-dispatch-past aria-label="Close">x</button>
        </header>
        <div class="mdt-modal-list dispatch-past-list">
          ${pastCallsMarkup || `<div class="empty">No past calls yet.</div>`}
        </div>
      </section>
    </div>
  ` : "";
  return `
    <section class="mdt-workspace dispatch-workspace">
      <header class="mdt-topbar dispatch-topbar">
        <div>
          <p class="eyebrow">Dispatch control center</p>
          <h1>CAD Dispatch</h1>
          <p class="mdt-subtitle">911 intake / unit assignment / scene notes / status tracking</p>
        </div>
        <div class="mdt-top-actions">
          <button class="ghost" data-refresh-dispatch>Refresh</button>
          <button class="secondary" data-close-dispatch>Exit Dispatch</button>
        </div>
      </header>
      <div class="mdt-stat-strip dispatch-stat-strip">
        <div class="metric"><span>Active Calls</span><strong>${stats.active || 0}</strong></div>
        <div class="metric"><span>Critical</span><strong>${stats.critical || 0}</strong></div>
        <div class="metric"><span>Assigned Units</span><strong>${stats.assigned_units || 0}</strong></div>
        <div class="metric"><span>Police</span><strong>${stats.police || 0}</strong></div>
        <div class="metric"><span>Fire / EMS</span><strong>${(stats.fire || 0) + (stats.ems || 0)}</strong></div>
      </div>
      <div class="dispatch-layout">
        <aside class="dispatch-queue">
          <div class="dispatch-panel-head">
            <div>
              <p class="eyebrow">CAD queue</p>
              <h2>Calls</h2>
            </div>
            <button class="ghost dispatch-past-button" type="button" data-open-dispatch-past ${pastCalls.length ? "" : "disabled"}>Past Calls (${pastCalls.length})</button>
          </div>
          <div class="dispatch-call-list">
            ${visibleCalls.map((call) => {
              const count = dispatchCallAssignments(data, call.id).length;
              return `
                <button type="button" class="dispatch-call-ticket ${String(call.id) === String(selected?.id) ? "active" : ""}" data-dispatch-call="${call.id}">
                  <span class="dispatch-ticket-top"><strong>#${call.id} ${escapeHtml(call.call_type || "Emergency Call")}</strong><span class="pill ${dispatchPriorityClass(call.priority)}">${escapeHtml(call.priority || "standard")}</span></span>
                  <span>${escapeHtml(call.location || "Unknown location")}</span>
                  <small>${escapeHtml((call.department || "police").toUpperCase())} / ${escapeHtml(call.status || "active")} / ${count} units</small>
                </button>
              `;
            }).join("") || `<div class="empty">No CAD calls in this queue</div>`}
          </div>
        </aside>
        <main class="dispatch-main">
          ${selected ? `
            <section class="dispatch-call-command">
              <div class="dispatch-call-hero">
                <div>
                  <p class="eyebrow">Selected call #${selected.id}</p>
                  <h2>${escapeHtml(selected.call_type || "Emergency Call")}</h2>
                  <p>${escapeHtml(selected.location || "Unknown location")}</p>
                </div>
              <div class="dispatch-hero-pills">
                  <span class="pill ${dispatchPriorityClass(selected.priority)}">${escapeHtml(selected.priority || "standard")}</span>
                  <span class="pill ${dispatchStatusClass(selected.status)}">${escapeHtml(selected.status || "active")}</span>
                  <span class="pill">${escapeHtml((selected.department || "police").toUpperCase())}</span>
                </div>
                <div class="dispatch-hero-actions">
                  ${selected.caller_name ? `<button class="secondary" type="button" data-dispatch-ncic-lookup="${escapeHtml(String(selected.id))}" data-dispatch-ncic-query="${escapeHtml(selected.caller_name)}">Lookup caller in NCIC</button>` : ""}
                </div>
              </div>
              <div class="dispatch-call-grid">
                <div class="metric"><span>Caller</span><strong>${escapeHtml(selected.caller_name || selected.created_by_name || "Unknown")}</strong></div>
                <div class="metric"><span>Created</span><strong>${selected.created_at ? new Date(selected.created_at).toLocaleString() : "N/A"}</strong></div>
                <div class="metric"><span>Last Update</span><strong>${selected.updated_at ? new Date(selected.updated_at).toLocaleString() : "N/A"}</strong></div>
                <div class="metric"><span>Units Attached</span><strong>${activeAssignments.length}</strong></div>
              </div>
              <div class="dispatch-call-note">
                <strong>Original intake</strong>
                <p>${escapeHtml(selected.note || "No intake note")}</p>
              </div>
              ${canManageDispatch ? `
                <section class="dispatch-call-action-panel" data-call-id="${selected.id}">
                  <label class="dispatch-wide">Update note<input data-dispatch-update-note placeholder="Optional status note for units and dispatch log" /></label>
                  <div class="dispatch-action-row">
                    <span>Status</span>
                    <div class="dispatch-action-buttons">
                      ${callActionButtons.map(([status, label]) => `
                        <button class="${status === "closed" ? "danger" : status === selected.status ? "primary" : "secondary"}" type="button" data-dispatch-call-status="${status}" data-call-id="${selected.id}">
                          ${label}
                        </button>
                      `).join("")}
                    </div>
                  </div>
                  <div class="dispatch-action-row">
                    <span>Priority</span>
                    <div class="dispatch-action-buttons priority-buttons">
                      ${priorities.map((priority) => `
                        <button class="${priority === selected.priority ? "primary" : "secondary"} ${priority === "critical" ? "priority-critical" : ""}" type="button" data-dispatch-call-priority="${priority}" data-call-id="${selected.id}">
                          ${priority}
                        </button>
                      `).join("")}
                    </div>
                  </div>
                </section>
              ` : `
                <div class="empty">Dispatch staff only. Ask dispatcher for status updates.</div>
              `}
            </section>
            <section class="dispatch-units-panel">
              <div class="dispatch-panel-head">
                <div>
                  <p class="eyebrow">Unit control</p>
                  <h2>Attached Units</h2>
                </div>
                <span class="pill">${activeAssignments.length} active</span>
              </div>
                ${canManageDispatch ? `
                <form id="dispatchAttachUnitForm" class="dispatch-attach-form" data-call-id="${selected.id}">
                  <label>Available unit<select name="unit_id" required>
                    <option value="">Select unit</option>
                    ${availableUnits.map((unit) => `
                      <option value="${unit.id}" ${unit.callsign ? "" : "disabled"}>
                        ${escapeHtml(unit.name)} - ${escapeHtml(unit.primary_agency || "Emergency")} - CIV ${escapeHtml(unit.civ_number || "pending")} ${unit.callsign ? ` / ${escapeHtml(unit.callsign)}` : "/ Missing callsign"}
                      </option>
                    `).join("")}
                  </select></label>
                  <label>Status<select name="status">${renderOptions(unitStatuses, "assigned")}</select></label>
                  <label class="dispatch-wide">Assignment notes<input name="notes" placeholder="Scene direction, staging, channel, or tasking" /></label>
                  <button class="primary" type="submit">Attach Unit</button>
                </form>
                <section class="dispatch-quick-panel">
                  <p class="muted small">Quick assign active units (one click)</p>
                  <div class="row">
                    ${availableUnits.filter((unit) => unit.callsign).map((unit) => `
                      <button type="button" class="secondary compact-action" data-dispatch-quick-attach="${selected.id}" data-unit-id="${unit.id}">
                        Attach ${escapeHtml(unit.callsign || unit.name)} (${escapeHtml(unit.name)})
                      </button>
                    `).join("") || `<span class="muted small">No callable units available (callsign required)</span>`}
                  </div>
                </section>
              ` : `
                <div class="empty">Only dispatch staff can assign units.</div>
              `}
              <div class="dispatch-unit-list">
                ${allAssignments.map((assignment) => `
                  <article class="dispatch-unit-card ${assignment.detached_at ? "detached" : ""}">
                    <div>
                      <strong>${escapeHtml(assignment.unit_name)}${assignment.unit_callsign ? ` (${escapeHtml(assignment.unit_callsign)})` : ""}</strong>
                      <p>${escapeHtml(assignment.unit_agency || "Emergency unit")} / attached by ${escapeHtml(assignment.dispatcher_name || "Dispatch")}</p>
                    </div>
                    ${canManageDispatch ? `
                      <form class="dispatch-unit-form" data-assignment-id="${assignment.id}">
                        <select name="status" ${assignment.detached_at ? "disabled" : ""}>${renderOptions([...unitStatuses, "detached"], assignment.status || "assigned")}</select>
                        <input name="notes" value="${escapeHtml(assignment.notes || "")}" placeholder="Unit notes" ${assignment.detached_at ? "disabled" : ""} />
                        <button class="secondary" type="submit" ${assignment.detached_at ? "disabled" : ""}>Save</button>
                        <button class="danger" type="button" data-detach-unit="${assignment.id}" ${assignment.detached_at ? "disabled" : ""}>Detach</button>
                      </form>
                    ` : `
                      <p class="muted small">Status: ${escapeHtml(assignment.status || "assigned")} / Notes: ${escapeHtml(assignment.notes || "N/A")}</p>
                    `}
                  </article>
                `).join("") || `<div class="empty">No units attached yet</div>`}
                ${canManageDispatch ? "" : `<p class="muted small">Dispatch staff-only controls are locked.</p>`}
              </div>
            </section>
          ` : `<div class="empty">Create or select a call to open dispatch controls</div>`}
        </main>
        <aside class="dispatch-tools">
          ${canManageDispatch ? `
            <form id="dispatchCreateCallForm" class="dispatch-create-card">
              <div>
                <p class="eyebrow">Create call</p>
                <h2>New CAD Call</h2>
              </div>
              <label>Department<select name="department">${renderOptions(departments, "police")}</select></label>
              <label>Call type<select name="call_type">${renderOptions(callTypes, "911 Call")}</select></label>
              <label>Priority<select name="priority">${renderOptions(priorities, "standard")}</select></label>
              <label>Caller / RP source<input name="caller_name" placeholder="Caller, officer, or anonymous" /></label>
              <label>Location<input name="location" placeholder="Street, postal, grid, landmark" required /></label>
              <label>Intake notes<textarea name="note" rows="7" placeholder="What happened, suspect info, weapons, injuries, scene hazards, RP details" required></textarea></label>
              <button class="primary" type="submit">Create Call</button>
            </form>
          ` : `
            <section class="dispatch-create-card">
              <div>
                <p class="eyebrow">Create call</p>
                <h2>New CAD Call</h2>
              </div>
              <div class="empty">Dispatch staff only to open new CAD calls.</div>
            </section>
          `}
          <form id="dispatchNcicSearchForm" class="dispatch-create-card">
            <div>
              <p class="eyebrow">NCIC / DMV check</p>
              <h2>Run Lookup</h2>
            </div>
            <label>${canViewAccountEmail ? "Find person by name, CIV, email, or plate" : "Find person by name, CIV, or plate"}<input name="q" value="${escapeHtml(state.dispatchNcicQuery)}" placeholder="${canViewAccountEmail ? "Search civilian name, CIV, email, or plate" : "Search civilian name, CIV, or plate"}" /></label>
            <button class="secondary" type="submit">Search</button>
          </form>
          <section class="dispatch-log">
            <div class="dispatch-panel-head">
              <div>
                <p class="eyebrow">NCIC results</p>
                <h2>Latest hits</h2>
              </div>
              <span class="pill">${ncicResults.length}</span>
            </div>
            <div class="dispatch-note-list">
              ${ncicResults.map((item) => `
                <article>
                  <div class="row tight"><strong>${escapeHtml(item.name || "Unknown")}</strong><span>${escapeHtml(item.civ_number || "CIV pending")}</span></div>
                  <p>${escapeHtml(item.callsign ? `Callsign ${item.callsign}` : "No callsign set")} / ${escapeHtml(item.primary_agency || "Civilian")}</p>
                  <p>${escapeHtml(item.license_status || "No DMV record")} | Plate ${escapeHtml((item.vehicles?.[0] && item.vehicles[0].plate) || item.plate || "N/A")}</p>
                  <p class="muted small">${canViewAccountEmail && item.email ? `${escapeHtml(item.email)} / ` : ""}Car code ${escapeHtml(item.car_entry_code || "N/A")}</p>
                </article>
              `).join("") || `<div class="empty">No NCIC hits yet</div>`}
            </div>
          </section>
          ${selected ? `
            ${canManageDispatch ? `
              <form id="dispatchNoteForm" class="dispatch-create-card dispatch-note-card" data-call-id="${selected.id}">
                <div>
                  <p class="eyebrow">Scene updates</p>
                  <h2>Dispatch Notes</h2>
                </div>
                <label>Note type<select name="note_type">
                  <option>dispatch update</option>
                  <option>scene update</option>
                  <option>suspect info</option>
                  <option>unit instruction</option>
                  <option>crime scene</option>
                  <option>medical update</option>
                </select></label>
                <label>Note<textarea name="body" rows="6" placeholder="Update units with scene status, suspect details, perimeter, staging, hazards, or RP instructions" required></textarea></label>
                <button class="primary" type="submit">Post Note</button>
              </form>
            ` : `
              <section class="dispatch-create-card dispatch-note-card">
                <div>
                  <p class="eyebrow">Scene updates</p>
                  <h2>Dispatch Notes</h2>
                </div>
                <div class="empty">Notes are read-only for dispatch staff only.</div>
              </section>
            `}
            <section class="dispatch-log">
              <div class="dispatch-panel-head">
                <div>
                  <p class="eyebrow">Call log</p>
                  <h2>Updates</h2>
                </div>
                <span class="pill">${notes.length}</span>
              </div>
              <div class="dispatch-note-list">
                ${notes.map((note) => `
                  <article>
                    <div class="row tight"><strong>${escapeHtml(note.note_type)}</strong><span>${note.created_at ? new Date(note.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span></div>
                    <p>${escapeHtml(note.body)}</p>
                    <small>${escapeHtml(note.author_name || "Dispatch")}</small>
                  </article>
                `).join("") || `<div class="empty">No dispatch notes yet</div>`}
              </div>
            </section>
          ` : ""}
        </aside>
      </div>
      ${pastCallsModal}
    </section>
  `;
}

function bindDispatchWorkspace() {
  $("[data-close-dispatch]")?.addEventListener("click", async () => {
    if (state.returnToMdtOnClose) {
      state.returnToMdtOnClose = false;
      state.activeApp = "mdt";
      state.dispatchPastOpen = false;
      await loadAppData("mdt");
      render();
      return;
    }
    state.activeApp = null;
    state.dispatchPastOpen = false;
    await loadSession();
  });
  $("[data-refresh-dispatch]")?.addEventListener("click", async () => {
    await loadAppData("dispatch");
    render();
  });
  bindDispatch();
}

function bindDispatch() {
  $("[data-open-dispatch-past]")?.addEventListener("click", (event) => {
  if (event.currentTarget?.disabled) return;
    state.dispatchPastOpen = true;
    render();
  });
  $("#dispatchNcicSearchForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    state.dispatchNcicQuery = String(payload.q || "").trim();
    try {
      const result = await api(`/api/mdt/search?q=${encodeURIComponent(state.dispatchNcicQuery)}`);
      state.dispatchNcicResults = result.results || [];
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-close-dispatch-past]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.dispatchPastOpen = false;
    render();
  }));
  $$("[data-open-dispatch-past-call]").forEach((button) => button.addEventListener("click", () => {
    state.dispatchSelectedCallId = button.dataset.openDispatchPastCall;
    state.dispatchPastOpen = false;
    state.dispatchViewingPastCall = true;
    render();
  }));
  $$("[data-dispatch-call]").forEach((button) => button.addEventListener("click", () => {
    state.dispatchSelectedCallId = button.dataset.dispatchCall;
    state.dispatchViewingPastCall = false;
    render();
  }));
  $("#dispatchCreateCallForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/dispatch/calls", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(`CAD call #${result.alert_id} created`);
      state.dispatchSelectedCallId = result.alert_id;
      state.dispatchViewingPastCall = false;
      event.currentTarget.reset();
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-dispatch-call-status]").forEach((button) => button.addEventListener("click", async () => {
    const status = button.dataset.dispatchCallStatus;
    const callId = button.dataset.callId;
    const panel = button.closest(".dispatch-call-action-panel");
    const noteInput = panel?.querySelector("[data-dispatch-update-note]");
    const note = String(noteInput?.value || "").trim();
    try {
      await api(`/api/dispatch/calls/${callId}`, {
        method: "PATCH",
        body: {
          status,
          note: note || (status === "closed" ? "Ticket closed from dispatch dashboard." : ""),
        },
      });
      if (["closed", "cleared"].includes(status)) {
        state.dispatchSelectedCallId = null;
        state.dispatchViewingPastCall = false;
      } else {
        state.dispatchSelectedCallId = callId;
        state.dispatchViewingPastCall = false;
      }
      toast(status === "closed" ? "Ticket closed" : "Call updated");
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-dispatch-call-priority]").forEach((button) => button.addEventListener("click", async () => {
    const priority = button.dataset.dispatchCallPriority;
    const callId = button.dataset.callId;
    const panel = button.closest(".dispatch-call-action-panel");
    const noteInput = panel?.querySelector("[data-dispatch-update-note]");
    const note = String(noteInput?.value || "").trim();
    try {
      await api(`/api/dispatch/calls/${callId}`, {
        method: "PATCH",
        body: { priority, note },
      });
      state.dispatchSelectedCallId = callId;
      toast("Priority updated");
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#dispatchAttachUnitForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/dispatch/calls/${event.currentTarget.dataset.callId}/units`, { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Unit attached");
      event.currentTarget.reset();
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-dispatch-quick-attach]")?.forEach((button) => button.addEventListener("click", async () => {
    const unitId = button.dataset.unitId;
    const callId = button.dataset.dispatchQuickAttach;
    if (!unitId || !callId) return;
    try {
      await api(`/api/dispatch/calls/${callId}/units`, {
        method: "POST",
        body: {
          unit_id: unitId,
          status: "assigned",
        },
      });
      toast("Unit attached");
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-dispatch-ncic-lookup]")?.forEach((button) => button.addEventListener("click", async () => {
    await runDispatchNcicQuery(button.dataset.dispatchNcicQuery);
  }));
  $$(".dispatch-unit-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/dispatch/assignments/${form.dataset.assignmentId}`, { method: "PATCH", body: Object.fromEntries(new FormData(form).entries()) });
      toast("Unit updated");
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-detach-unit]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/dispatch/assignments/${button.dataset.detachUnit}`, { method: "PATCH", body: { detach: true } });
      toast("Unit detached");
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#dispatchNoteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/dispatch/calls/${event.currentTarget.dataset.callId}/notes`, { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Dispatch note posted");
      event.currentTarget.reset();
      await loadAppData("dispatch");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
}

function fireRigCode(name) {
  const parts = String(name || "Unit").trim().split(/\s+/);
  const prefix = (parts[0] || "Unit").slice(0, 3).toUpperCase();
  const number = parts.find((part) => /^\d+$/.test(part)) || "";
  return `${prefix}${number ? ` ${number}` : ""}`;
}

function renderFireRigAssignments(data) {
  const rigs = data.rigs || [];
  const personnel = data.personnel || [];
  const canManage = Boolean(data.can_manage_rigs || hasFireCommandAccess());
  const positionOptions = ["Fire Chief", "Deputy Chief", "Fire Marshal", "Battalion Chief", "Officer", "Driver", "Firefighter", "Medic", "Engineer"];
  return `
    <section class="fire-rig-panel fire-command-board">
      <div class="fire-rig-command-head">
        <div>
          <p class="eyebrow">Fire command board</p>
          <h2>Apparatus Assignments</h2>
          <p>${rigs.length} units indexed / ${personnel.length} fire personnel available</p>
        </div>
        <span class="pill ${canManage ? "green" : "amber"}">${canManage ? "Chief controls" : "Read only"}</span>
      </div>
      <div class="fire-board-table">
        <div class="fire-board-header" aria-hidden="true">
          <span>Unit</span>
          <span>Crew</span>
          <span>Role</span>
          <span>Status</span>
          <span>Command notes</span>
          <span>Action</span>
        </div>
        ${rigs.map((rig) => `
          ${canManage ? `
            <form class="fire-rig-form fire-board-row status-${escapeHtml(rig.status || "available")}" data-rig-name="${escapeHtml(rig.rig_name)}">
              <div class="fire-unit-cell">
                <span>${escapeHtml(fireRigCode(rig.rig_name))}</span>
                <strong>${escapeHtml(rig.rig_name)}</strong>
              </div>
              <label class="fire-board-field" data-label="Crew"><span>Crew</span><select name="user_id" aria-label="${escapeHtml(rig.rig_name)} assigned member">
                <option value="">Unassigned</option>
                ${personnel.map((person) => `<option value="${person.id}"${selectedAttr(person.id, rig.user_id)}>${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")}</option>`).join("")}
              </select></label>
              <label class="fire-board-field" data-label="Role"><span>Role</span><select name="position" aria-label="${escapeHtml(rig.rig_name)} position">
                ${renderOptions(positionOptions, rig.position || "Firefighter")}
              </select></label>
              <label class="fire-board-field" data-label="Status"><span>Status</span><select name="status" aria-label="${escapeHtml(rig.rig_name)} status">
                ${renderOptions(["available", "assigned", "out_of_service"], rig.status || "available")}
              </select></label>
              <label class="fire-board-field fire-board-notes" data-label="Notes"><span>Notes</span><input name="notes" value="${escapeHtml(rig.notes || "")}" placeholder="Crew notes or special assignment" aria-label="${escapeHtml(rig.rig_name)} notes" /></label>
              <button class="primary" type="submit">Save</button>
            </form>
          ` : `
            <article class="fire-board-row status-${escapeHtml(rig.status || "available")}">
              <div class="fire-unit-cell">
                <span>${escapeHtml(fireRigCode(rig.rig_name))}</span>
                <strong>${escapeHtml(rig.rig_name)}</strong>
              </div>
              <div class="fire-read-cell" data-label="Crew">${escapeHtml(rig.assigned_name || "Unassigned")} ${rig.assigned_civ_number ? `/ CIV ${escapeHtml(rig.assigned_civ_number)}` : ""}</div>
              <div class="fire-read-cell" data-label="Role">${escapeHtml(rig.position || "Firefighter")}</div>
              <div class="fire-read-cell" data-label="Status"><span class="pill ${rig.status === "assigned" ? "green" : rig.status === "out_of_service" ? "red" : "amber"}">${escapeHtml(rig.status || "available")}</span></div>
              <div class="fire-read-cell" data-label="Notes">${escapeHtml(rig.notes || "No command notes logged")}</div>
              <div class="fire-read-cell muted small">Locked</div>
            </article>
          `}
        `).join("") || `<div class="empty">No rigs configured</div>`}
      </div>
    </section>
  `;
}

function renderFireSettings() {
  const data = state.cache["fire-settings"] || state.cache.fire || {};
  const stats = data.stats || { active: 0, responding: 0, cleared: 0 };
  const commandRoles = ["Fire Chief", "Deputy Chief", "Fire Marshal"];
  const commandEnabled = Boolean(data.can_manage_rigs || hasFireCommandAccess());
  return `
    <div class="fire-settings-screen">
      <section class="fire-settings-hero">
        <div>
          <p class="eyebrow">Fire command settings</p>
          <h3>Department Control</h3>
          <p>Chief-level rig assignment, battalion coverage, and command staffing for Fire MDT operations.</p>
        </div>
        <div class="fire-hero-status">
          <span class="fire-hero-pulse"></span>
          <strong>${commandEnabled ? "Command enabled" : "Read only"}</strong>
          <small>${stats.active || 0} active / ${stats.responding || 0} responding</small>
        </div>
      </section>
      <div class="profile-grid compact fire-command-grid">
        <div><span>Active calls</span><strong>${stats.active || 0}</strong></div>
        <div><span>Responding</span><strong>${stats.responding || 0}</strong></div>
        <div><span>Cleared</span><strong>${stats.cleared || 0}</strong></div>
        <div><span>Command roles</span><strong>${commandRoles.join(", ")}</strong></div>
      </div>
      ${renderFireRigAssignments(data)}
    </div>
  `;
}

function renderFireWorkspace() {
  const data = state.cache.fire || {};
  const alerts = data.alerts || [];
  const stats = data.stats || { active: 0, responding: 0, cleared: 0 };
  const commandEnabled = Boolean(data.can_manage_rigs || hasFireCommandAccess());
  return `
    <section class="mdt-workspace fire-workspace">
      <header class="mdt-topbar">
        <div>
          <p class="eyebrow">${escapeHtml(state.session.user.primary_agency || "Fire Department")}</p>
          <h1>Fire Department MDT</h1>
          <p class="mdt-subtitle">${commandEnabled ? "Command controls active" : "Incident response mode"}</p>
        </div>
        <div class="mdt-top-actions">
          <span class="pill ${commandEnabled ? "green" : "amber"}">${commandEnabled ? "Chief controls" : "Read only"}</span>
          <button class="ghost" data-refresh-fire>Refresh</button>
          <button class="secondary" data-close-fire>Exit MDT</button>
        </div>
      </header>
      <div class="mdt-stat-strip">
        <div class="metric"><span>Active Calls</span><strong>${stats.active || 0}</strong></div>
        <div class="metric"><span>Responding</span><strong>${stats.responding || 0}</strong></div>
        <div class="metric"><span>Cleared</span><strong>${stats.cleared || 0}</strong></div>
      </div>
      <main class="mdt-main fire-main">
        ${renderFireRigAssignments(data)}
        <div class="mdt-section-head">
          <div><p class="eyebrow">911 Queue</p><h2>Fire / EMS Incidents</h2></div>
          <span class="pill">${alerts.length} calls</span>
        </div>
        <div class="mdt-code-grid">
          ${alerts.map((alert) => `
            <article class="mdt-return fire-call-card">
              <div class="row">
                <div>
                  <p class="eyebrow">${escapeHtml(alert.department || "fire")}</p>
                  <h3>${escapeHtml(alert.location)}</h3>
                </div>
                <span class="pill ${panicStatusClass(alert.status)}">${escapeHtml(alert.status)}</span>
              </div>
              <p>${escapeHtml(alert.note || "No notes supplied")}</p>
              <p class="muted small">Reported by ${escapeHtml(alert.officer_name || "Unknown")} - ${new Date(alert.created_at).toLocaleString()}</p>
              <div class="row">
                ${alert.status !== "responding" && alert.status !== "cleared" ? `<button class="secondary" data-fire-alert="${alert.id}" data-fire-status="responding">Responding</button>` : ""}
                ${alert.status !== "cleared" ? `<button class="primary" data-fire-alert="${alert.id}" data-fire-status="cleared">Clear</button>` : ""}
              </div>
            </article>
          `).join("") || `<div class="empty">No fire or EMS incidents</div>`}
        </div>
      </main>
    </section>
  `;
}

function bindFireWorkspace() {
  $("[data-close-fire]")?.addEventListener("click", async () => {
    state.activeApp = null;
    await loadSession();
  });
  $("[data-refresh-fire]")?.addEventListener("click", async () => {
    await loadAppData("fire");
    render();
  });
  bindFireMdt();
}

function renderFireMdt() {
  return renderFireWorkspace();
}

function bindFireMdt() {
  $$(".fire-rig-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      await api("/api/fire/rigs", { method: "PATCH", body: { ...payload, rig_name: form.dataset.rigName } });
      toast(`${form.dataset.rigName} assignment saved`);
      await loadAppData(state.activeApp || "fire");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-fire-alert]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/fire/alerts/${button.dataset.fireAlert}`, {
        method: "PATCH",
        body: { status: button.dataset.fireStatus },
      });
      toast(`Incident ${button.dataset.fireStatus}`);
      await loadAppData(state.activeApp || "fire");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function bindFireSettings() {
  bindFireMdt();
}

function renderMdt() {
  return `<div class="mdt-shell">${renderMdtContent()}</div>`;
}

function renderMdtContent() {
  if (state.mdtTab === "cid-command") return renderCidCommandCenter();
  if (state.mdtTab === "cid-investigations") return renderCidInvestigations();
  if (state.mdtTab === "cid-warrants") return renderCidWarrants();
  if (state.mdtTab === "cid-ia") return renderCidInternalAffairs();
  if (state.mdtTab === "bolos") return renderBolos();
  if (state.mdtTab === "cad-reports") return renderCadReports();
  if (state.mdtTab === "ticket") return renderTicketWriter();
  if (state.mdtTab === "booking") return renderBookingSystem();
  if (state.mdtTab === "citations") return renderCodeSection("citation");
  if (state.mdtTab === "criminal") return renderCodeSection("criminal");
  if (state.mdtTab === "mdt-settings") return renderMdtSettings();
  if (state.mdtTab === "panic") return renderPanic();
  return renderMdtSearch();
}

function renderCidCommandCenter() {
  const cid = state.cache.mdt?.cid || {};
  const commandLabel = mdtCommandLabel();
  const cases = cid.investigations || [];
  const warrants = cid.warrants || [];
  const iaCases = cid.ia_cases || [];
  const notes = cid.notes || [];
  const criticalCases = cases.filter((item) => item.priority === "critical");
  const elevatedCases = cases.filter((item) => item.priority === "elevated");
  const activeWarrants = warrants.filter((item) => item.status === "active");
  const activeIa = iaCases.filter((item) => !["closed", "sustained", "unfounded"].includes(item.status));
  return `
    <div class="cid-command-center">
      <section class="cid-command-hero">
        <div>
          <p class="eyebrow">${escapeHtml(`${commandLabel} Operations Center`)}</p>
          <h2>Command Overview</h2>
          <p>Case intelligence, warrant operations, internal affairs, and target tracking are consolidated here.</p>
        </div>
        <div class="cid-command-pulse">
          <span></span>
          <strong>${activeWarrants.length} warrants active</strong>
        </div>
      </section>
      <div class="cid-command-actions">
        <button type="button" data-mdt-tab="cid-investigations"><strong>Open Case Folder</strong><span>Create or update investigations</span></button>
        <button type="button" data-mdt-tab="cid-warrants"><strong>Warrant Operations</strong><span>Issue, serve, recall, track</span></button>
        <button type="button" data-mdt-tab="cid-ia"><strong>Internal Affairs</strong><span>Officer investigations and reviews</span></button>
        <button type="button" data-mdt-tab="bolos"><strong>BOLO Board</strong><span>Broadcast active lookouts to all LEOs</span></button>
        <button type="button" data-mdt-tab="cad-reports"><strong>CAD Reports</strong><span>After-call narratives and dispositions</span></button>
        <button type="button" data-mdt-tab="search"><strong>NCIC / DMV</strong><span>Run target and vehicle returns</span></button>
      </div>
      <div class="cid-command-grid">
        <section class="cid-command-card priority">
          <div class="row"><h3>Priority Case Watch</h3><span class="pill red">${criticalCases.length} critical</span></div>
          <div class="cid-mini-list">
            ${[...criticalCases, ...elevatedCases].slice(0, 8).map((item) => `
              <button type="button" class="cid-mini-case" data-cid-open-case="${item.id}" data-mdt-tab="cid-investigations">
                <span>${escapeHtml(item.case_number)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.case_type)} / ${escapeHtml(item.priority)} / ${escapeHtml(item.target_civ_name || item.target_name || "No target")}</small>
              </button>
            `).join("") || `<p class="muted small">No elevated or critical case folders</p>`}
          </div>
        </section>
        <section class="cid-command-card">
          <div class="row"><h3>Active Warrant Operations</h3><span class="pill red">${activeWarrants.length}</span></div>
          <div class="cid-mini-list">
            ${activeWarrants.slice(0, 8).map((item) => `
              <button type="button" class="cid-mini-case warrant" data-open-cid-warrant="${item.id}">
                <span>${escapeHtml(item.warrant_number)}</span>
                <strong>${escapeHtml(item.subject_civ_name || item.subject_name)}</strong>
                <small>${escapeHtml(item.warrant_type)} / ${escapeHtml(item.priority)} / ${escapeHtml(item.case_number || "No linked case")}</small>
              </button>
            `).join("") || `<p class="muted small">No active warrant operations</p>`}
          </div>
        </section>
        <section class="cid-command-card">
          <div class="row"><h3>Intelligence Feed</h3><span class="pill">${notes.length}</span></div>
          <div class="cid-feed-list">
            ${notes.slice(0, 8).map((note) => `
              <article>
                <div class="row tight"><strong>${escapeHtml(note.note_type)}</strong><span>${escapeHtml(note.case_number)}</span></div>
                <p>${escapeHtml(note.body)}</p>
                <small>${escapeHtml(note.author_name)} / ${new Date(note.created_at).toLocaleString()}</small>
              </article>
            `).join("") || `<p class="muted small">No recent case notes</p>`}
          </div>
        </section>
        <section class="cid-command-card">
          <div class="row"><h3>Internal Affairs Queue</h3><span class="pill amber">${activeIa.length}</span></div>
          <div class="cid-mini-list">
            ${activeIa.slice(0, 7).map((item) => `
              <button type="button" class="cid-mini-case ia" data-mdt-tab="cid-ia" data-cid-open-ia="${item.id}">
                <span>${escapeHtml(item.ia_number)}</span>
                <strong>${escapeHtml(item.subject_officer_name || item.subject_name)}</strong>
                <small>${escapeHtml(item.allegation_type)} / ${escapeHtml(item.status)} / ${escapeHtml(item.priority)}</small>
              </button>
            `).join("") || `<p class="muted small">No open IA matters</p>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderMdtSide() {
  const commandLabel = mdtCommandLabel();
  const alerts = state.cache.mdt?.alerts?.alerts || [];
  const reports = state.cache.mdt?.reports?.reports || [];
  const activeBolos = state.cache.mdt?.bolos?.active || [];
  const issued = state.cache.mdt?.search?.flatMap((person) => person.open_cases || []) || [];
  const cid = state.cache.mdt?.cid;
  const priorityCases = (cid?.investigations || []).filter((item) => ["critical", "elevated"].includes(item.priority));
  const activeWarrants = (cid?.warrants || []).filter((item) => item.status === "active");
  const canOpenMessages = canUseMdtMessages();
  const liveAlerts = alerts.filter((alert) => ["active", "responding", "on_scene"].includes(String(alert.status || "").toLowerCase()));
  return `
    <div class="mdt-side-panel mdt-command-index">
      <div class="mdt-side-heading"><span>Command index</span><small>Direct access</small></div>
      <div class="mdt-command-links">
        ${canOpenMessages ? `<button type="button" data-open-mdt-messages><span>01</span><strong>Messages</strong></button>` : ""}
        ${state.mdtProtocolAssistantEnabled ? `<button type="button" data-start-traffic-stop><span>02</span><strong>Traffic Stop</strong></button>` : ""}
        <button type="button" data-mdt-tab="ticket"><span>03</span><strong>Write Ticket</strong></button>
        <button type="button" data-mdt-tab="booking"><span>04</span><strong>Booking</strong></button>
        <button type="button" data-mdt-tab="citations"><span>05</span><strong>NYS Codes</strong></button>
        <button type="button" data-mdt-tab="mdt-settings"><span>06</span><strong>Settings</strong></button>
      </div>
    </div>
    ${cid ? `
      <div class="mdt-side-panel cid-side-panel">
        <h3>${escapeHtml(`${commandLabel} Command Tracker`)}</h3>
        <div class="list compact-list">
          <div class="row"><span>Open cases</span><strong>${cid.stats.open_investigations}</strong></div>
          <div class="row"><span>Active warrants</span><strong>${cid.stats.active_warrants}</strong></div>
          <div class="row"><span>IA open</span><strong>${cid.stats.ia_open}</strong></div>
        </div>
      </div>
      <div class="mdt-side-panel cid-side-panel">
        <h3>Priority Watch</h3>
        <div class="list compact-list">
          ${priorityCases.slice(0, 5).map((item) => `<button class="cid-side-link" data-mdt-tab="cid-investigations" data-cid-open-case="${item.id}"><strong>${escapeHtml(item.case_number)}</strong><span>${escapeHtml(item.title)}</span></button>`).join("") || `<p class="muted small">No priority cases</p>`}
        </div>
      </div>
      <div class="mdt-side-panel cid-side-panel">
        <h3>Warrant Watch</h3>
        <div class="list compact-list">
          ${activeWarrants.slice(0, 5).map((item) => `<button class="cid-side-link danger-link" data-open-cid-warrant="${item.id}"><strong>${escapeHtml(item.warrant_number)}</strong><span>${escapeHtml(item.subject_civ_name || item.subject_name)}</span></button>`).join("") || `<p class="muted small">No active warrants</p>`}
        </div>
      </div>
    ` : ""}
    <div class="mdt-side-panel mdt-rail-section">
      <div class="mdt-side-heading"><span>Active BOLOs</span><button type="button" data-mdt-tab="bolos">Open</button></div>
      <div class="list compact-list">
        ${activeBolos.slice(0, 3).map((bolo) => `<button class="cid-side-link danger-link" data-mdt-tab="bolos"><strong>${escapeHtml(bolo.bolo_number)}</strong><span>${escapeHtml(bolo.target_name)} / ${escapeHtml(bolo.caution_level)}</span></button>`).join("") || `<p class="mdt-rail-clear">No active BOLOs</p>`}
      </div>
    </div>
    <div class="mdt-side-panel mdt-rail-section">
      <div class="mdt-side-heading"><span>Live Watch</span><button type="button" data-mdt-tab="panic">Open</button></div>
      <div class="list compact-list">
        ${liveAlerts.slice(0, 4).map((alert) => `<div class="mdt-watch-line"><span>${escapeHtml(alert.officer_name)}</span><i></i><strong>${escapeHtml(alert.status)}</strong></div>`).join("") || `<p class="mdt-rail-clear">No active officer alerts</p>`}
      </div>
    </div>
    <div class="mdt-side-panel mdt-rail-section">
      <div class="mdt-side-heading"><span>Recent Reports</span><button type="button" data-mdt-tab="cad-reports">Open</button></div>
      <div class="list compact-list">
        ${reports.slice(0, 3).map((report) => `<button class="cid-side-link" data-mdt-tab="cad-reports"><strong>${escapeHtml(report.report_number)}</strong><span>${escapeHtml(report.call_type)} / ${escapeHtml(report.disposition)}</span></button>`).join("") || `<p class="mdt-rail-clear">No after-call reports</p>`}
      </div>
    </div>
    <div class="mdt-side-panel mdt-rail-section">
      <div class="mdt-side-heading"><span>Open Returns</span><button type="button" data-mdt-tab="search">NCIC</button></div>
      <div class="list compact-list">
        ${issued.slice(0, 3).map((item) => `<div class="mdt-return-line"><span>${escapeHtml(item.charge_code)}</span><strong>${money(item.fine_amount)}</strong></div>`).join("") || `<p class="mdt-rail-clear">No open NCIC returns</p>`}
      </div>
    </div>
  `;
}

function panicStatusClass(status) {
  return status === "active" ? "red" : "green";
}

function reportDispositionClass(disposition) {
  if (["unfounded", "false alarm", "unable to locate"].includes(disposition)) return "amber";
  if (["arrest made", "referred to CID"].includes(disposition)) return "red";
  return "green";
}

function boloCautionClass(level) {
  if (["armed", "high"].includes(level)) return "red";
  if (level === "elevated") return "amber";
  return "green";
}

function mdtStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (["valid", "verified", "approved", "active", "cleared", "served"].includes(normalized)) return "green";
  if (["suspended", "revoked", "denied", "cancelled", "expired", "recalled"].includes(normalized)) return "red";
  return "amber";
}

function syncCidWarrantSubject(form) {
  const select = form?.querySelector("[data-cid-warrant-subject]");
  const hidden = form?.querySelector("[name='subject_name']");
  if (!select || !hidden) return;
  hidden.value = select.selectedOptions[0]?.dataset.name || "";
}

function getMdtCivilians() {
  return state.cache.mdt?.reports?.civilians || state.cache.mdt?.cid?.civilians || state.cache.mdt?.charges?.civilians || [];
}

function syncCadReportCiv(form) {
  const select = form?.querySelector("[data-cad-report-civ]");
  const input = form?.querySelector("[data-cad-report-name]");
  if (!select || !input) return;
  const selectedName = select.selectedOptions[0]?.dataset.name || "";
  if (selectedName) {
    input.value = selectedName;
  }
}

function syncCadReportAlert(form) {
  const select = form?.querySelector("[data-cad-report-alert]");
  const location = form?.querySelector("[name='location']");
  if (!select || !location) return;
  const selectedLocation = select.selectedOptions[0]?.dataset.location || "";
  if (selectedLocation && !location.value.trim()) {
    location.value = selectedLocation;
  }
}

function syncBoloTarget(form) {
  const select = form?.querySelector("[data-bolo-target]");
  const input = form?.querySelector("[data-bolo-target-name]");
  if (!select || !input) return;
  const selectedName = select.selectedOptions[0]?.dataset.name || "";
  if (selectedName) {
    input.value = selectedName;
  }
}

function syncChargeWarrantSubject(form) {
  const select = form?.querySelector("[data-charge-warrant-subject]");
  const hidden = form?.querySelector("[name='subject_name']");
  if (!select || !hidden) return;
  hidden.value = select.selectedOptions[0]?.dataset.name || "";
}

function syncCidInvestigationTarget(form) {
  const select = form?.querySelector("[data-cid-investigation-target]");
  const input = form?.querySelector("[data-cid-investigation-name]");
  if (!select || !input) return;
  const selectedName = select.selectedOptions[0]?.dataset.name || "";
  if (selectedName) {
    input.value = selectedName;
  }
}

function renderBolos() {
  const data = state.cache.mdt?.bolos || {};
  const active = data.active || [];
  const recent = data.recent || [];
  const civilians = getMdtCivilians();
  const cautionOptions = ["standard", "elevated", "high", "armed"];
  const highRisk = active.filter((bolo) => ["armed", "high"].includes(bolo.caution_level)).length;
  return `
    <div class="bolo-console">
      <section class="bolo-hero">
        <div>
          <p class="eyebrow">All LEO broadcast</p>
          <h2>BOLO Board</h2>
          <p>${active.length} active / ${highRisk} high risk / ${recent.length} archived</p>
        </div>
        <div class="bolo-signal">
          <span></span>
          <strong>LIVE LOOKOUT</strong>
        </div>
      </section>
      <div class="bolo-grid">
        <form id="boloForm" class="cid-intake-board bolo-intake-board">
          <div class="cid-intake-head">
            <div>
              <p class="eyebrow">BOLO intake</p>
              <h3>Issue Active BOLO</h3>
              <p>Visible to every LEO MDT until cleared or cancelled.</p>
            </div>
            <span class="pill red">Broadcast</span>
          </div>
          <div class="cid-intake-grid">
            <label class="cid-field-wide">Known profile<select name="target_civ_id" data-bolo-target>
              <option value="">Unknown / alias / non-civilian target</option>
              ${civilians.map((person) => `<option value="${person.id}" data-name="${escapeHtml(person.name)}">${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No DMV")}</option>`).join("")}
            </select></label>
            <label>Target name<input name="target_name" data-bolo-target-name placeholder="Name, alias, unit, or organization" required /></label>
            <label>Caution level<select name="caution_level">${renderOptions(cautionOptions, "standard")}</select></label>
            <label>Last seen<input name="last_seen" placeholder="Area, postal, road, landmark, time" /></label>
            <label>Plate<input name="plate" placeholder="Optional plate" /></label>
            <label class="cid-field-wide">Target description<input name="target_description" placeholder="Clothing, build, known weapons, direction of travel" /></label>
            <label class="cid-field-wide">Vehicle description<input name="vehicle_description" placeholder="Make, model, color, damage, occupants, direction" /></label>
          </div>
          <label class="cid-summary-field">Probable reason / officer safety note<textarea name="reason" required rows="8" placeholder="Facts supporting the lookout, officer safety notes, charges suspected, and instructions for contact"></textarea></label>
          <div class="cid-intake-actions">
            <div>
              <span>Issuing officer</span>
              <strong>${escapeHtml(state.session?.user?.name || "Officer")}</strong>
            </div>
            <button class="primary" type="submit">Broadcast BOLO</button>
          </div>
        </form>
        <section class="bolo-active-board">
          <div class="mdt-section-head">
            <div>
              <p class="eyebrow">Active lookouts</p>
              <h2>Officer BOLO Feed</h2>
            </div>
            <span class="pill red">${active.length} active</span>
          </div>
          <div class="bolo-card-list">
            ${active.map((bolo) => `
              <article class="bolo-card caution-${escapeHtml(bolo.caution_level)}">
                <div class="bolo-card-head">
                  <div>
                    <p class="eyebrow">${escapeHtml(bolo.bolo_number)}</p>
                    <h3>${escapeHtml(bolo.target_name)}</h3>
                    <p class="muted small">Issued by ${escapeHtml(bolo.officer_name || "Unknown")} / ${bolo.created_at ? new Date(bolo.created_at).toLocaleString() : "N/A"}</p>
                  </div>
                  <span class="pill ${boloCautionClass(bolo.caution_level)}">${escapeHtml(bolo.caution_level)}</span>
                </div>
                <div class="bolo-meta-grid">
                  <div><span>Last seen</span><strong>${escapeHtml(bolo.last_seen || "Unknown")}</strong></div>
                  <div><span>Plate</span><strong>${escapeHtml(bolo.plate || "Not listed")}</strong></div>
                  <div><span>Vehicle</span><strong>${escapeHtml(bolo.vehicle_description || "Not listed")}</strong></div>
                  <div><span>Status</span><strong>${escapeHtml(bolo.status)}</strong></div>
                </div>
                ${bolo.target_description ? `<p class="bolo-description">${escapeHtml(bolo.target_description)}</p>` : ""}
                <p class="bolo-reason">${escapeHtml(bolo.reason)}</p>
                <div class="row-actions">
                  <button class="primary" type="button" data-bolo-status="${bolo.id}" data-status="cleared">Mark cleared</button>
                  <button class="secondary" type="button" data-bolo-status="${bolo.id}" data-status="cancelled">Cancel</button>
                </div>
              </article>
            `).join("") || `<div class="empty">No active BOLOs</div>`}
          </div>
        </section>
      </div>
      <section class="bolo-recent-panel">
        <div class="mdt-section-head">
          <div>
            <p class="eyebrow">BOLO archive</p>
            <h2>Recently Closed</h2>
          </div>
          <span class="pill">${recent.length} records</span>
        </div>
        <div class="bolo-recent-list">
          ${recent.map((bolo) => `
            <article>
              <div>
                <strong>${escapeHtml(bolo.bolo_number)} - ${escapeHtml(bolo.target_name)}</strong>
                <span>${escapeHtml(bolo.reason)}</span>
              </div>
              <span class="pill ${mdtStatusClass(bolo.status)}">${escapeHtml(bolo.status)}</span>
            </article>
          `).join("") || `<div class="empty">No closed BOLO records yet</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderCadReports() {
  const data = state.cache.mdt?.reports || {};
  const reports = data.reports || [];
  const alerts = data.alerts || state.cache.mdt?.alerts?.alerts || [];
  const civilians = data.civilians || getMdtCivilians();
  const activeCalls = alerts.filter((alert) => alert.status === "active" || alert.status === "responding");
  const unfoundedReports = reports.filter((report) => report.disposition === "unfounded");
  const selectedAlert = alerts.find((alert) => String(alert.id) === String(state.mdtReportAlertId));
  const callTypes = ["911 Response", "Traffic Stop", "Investigation", "Disturbance", "Welfare Check", "Assist EMS/Fire", "BOLO / Locate", "Other"];
  const dispositions = ["cleared", "founded", "unfounded", "report taken", "citation issued", "arrest made", "referred to CID", "false alarm", "unable to locate"];
  return `
    <div class="cad-report-console">
      <form id="cadReportForm" class="cid-intake-board cad-report-board">
        <div class="cid-intake-head">
          <div>
            <p class="eyebrow">CAD after-call reporting</p>
            <h2>Incident / Unfounded Report</h2>
            <p>${data.can_review_all ? "Command review enabled" : "Officer report log"} / ${reports.length} reports indexed</p>
          </div>
          <div class="cid-intake-signal cad-report-signal">
            <span></span>
            <strong>AFTER CALL</strong>
          </div>
        </div>
        <div class="cad-report-call-strip">
          <div class="metric"><span>Active CAD calls</span><strong>${activeCalls.length}</strong></div>
          <div class="metric"><span>Reports filed</span><strong>${reports.length}</strong></div>
          <div class="metric"><span>Unfounded</span><strong>${unfoundedReports.length}</strong></div>
        </div>
        <div class="cid-intake-grid cad-report-grid">
          <label class="cid-field-wide">Linked CAD call<select name="related_alert_id" data-cad-report-alert>
            <option value="">No linked call / officer initiated</option>
            ${alerts.map((alert) => `<option value="${alert.id}" data-location="${escapeHtml(alert.location || "")}"${selectedAttr(alert.id, state.mdtReportAlertId)}>${escapeHtml((alert.department || "police").toUpperCase())} #${alert.id} - ${escapeHtml(alert.location || "No location")} - ${escapeHtml(alert.status || "open")}</option>`).join("")}
          </select></label>
          <label>Call type<select name="call_type" required>${renderOptions(callTypes, "911 Response")}</select></label>
          <label>Disposition<select name="disposition" required>${renderOptions(dispositions, "cleared")}</select></label>
          <label class="cid-field-wide">Involved civilian<select name="involved_civ_id" data-cad-report-civ>
            <option value="">Unlisted / unknown / no civilian</option>
            ${civilians.map((person) => `<option value="${person.id}" data-name="${escapeHtml(person.name)}">${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No DMV")}</option>`).join("")}
          </select></label>
          <label>Involved name / alias<input name="involved_name" data-cad-report-name placeholder="Auto-fills from selected profile or type manually" /></label>
          <label>Location<input name="location" value="${escapeHtml(selectedAlert?.location || "")}" placeholder="Street, postal, grid, or landmark" required /></label>
        </div>
        <label class="cid-summary-field cad-narrative-field">Incident narrative<textarea name="narrative" required rows="10" placeholder="Document the call timeline, facts observed, statements, search results, conclusion, and why the incident was founded or unfounded."></textarea></label>
        <div class="grid-2 cad-report-text-grid">
          <label>Actions taken<textarea name="actions_taken" rows="6" placeholder="Units assigned, citations issued, warnings, arrests, medical/fire handoff, scene cleared, supervisor notified"></textarea></label>
          <label>Evidence / clip links<textarea name="evidence_links" rows="6" placeholder="In-game clip URLs, screenshots, evidence tags, bodycam references, witness names"></textarea></label>
        </div>
        <div class="cid-intake-actions">
          <div>
            <span>Reporting officer</span>
            <strong>${escapeHtml(state.session?.user?.name || "Officer")}</strong>
          </div>
          <button class="primary" type="submit">File after-call report</button>
        </div>
      </form>
      <section class="cad-report-history">
        <div class="mdt-section-head">
          <div>
            <p class="eyebrow">CAD report archive</p>
            <h2>Recent After-Call Reports</h2>
          </div>
          <span class="pill">${data.can_review_all ? "All officers" : "Your reports"}</span>
        </div>
        <div class="cad-report-list">
          ${reports.map((report) => `
            <article class="cad-report-card ${report.disposition === "unfounded" ? "unfounded" : ""}">
              <div class="row">
                <div>
                  <p class="eyebrow">${escapeHtml(report.report_number)}</p>
                  <h3>${escapeHtml(report.call_type)}</h3>
                </div>
                <span class="pill ${reportDispositionClass(report.disposition)}">${escapeHtml(report.disposition)}</span>
              </div>
              <div class="cad-report-meta">
                <span>Officer ${escapeHtml(report.officer_name || "Unknown")}</span>
                <span>${escapeHtml(report.location || "No location")}</span>
                <span>${new Date(report.created_at).toLocaleString()}</span>
                ${report.related_alert_id ? `<span>CAD #${report.related_alert_id} / ${escapeHtml(report.related_alert_status || "unknown")}</span>` : `<span>Officer initiated</span>`}
              </div>
              <div class="cad-report-subject">
                <strong>Involved</strong>
                <span>${escapeHtml(report.involved_civ_name || report.involved_name || "No named subject")}${report.involved_civ_number ? ` / CIV ${escapeHtml(report.involved_civ_number)}` : ""}</span>
              </div>
              <p class="cad-report-narrative">${escapeHtml(report.narrative)}</p>
              ${report.actions_taken ? `<div class="cad-report-note"><strong>Actions taken</strong><p>${escapeHtml(report.actions_taken)}</p></div>` : ""}
              ${report.evidence_links ? `<div class="cad-report-note"><strong>Evidence / clips</strong><p>${escapeHtml(report.evidence_links)}</p></div>` : ""}
            </article>
          `).join("") || `<div class="empty">No after-call reports filed yet</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderMdtSearch() {
  const results = state.cache.mdt?.search || [];
  const canViewAccountEmail = canAny("owner", "admin");
  return `
    <form id="mdtSearch" class="mdt-searchbar">
      <label>${canViewAccountEmail ? "Search name, email, plate, CIV, or car code" : "Search name, plate, CIV, or car code"}<input name="q" minlength="2" placeholder="${canViewAccountEmail ? "Search name, email, plate, CIV number, or car code" : "Search name, plate, CIV number, or car code"}" required /></label>
      <button class="primary" type="submit">Run NCIC</button>
    </form>
    <div class="mdt-results">
      ${results.map((item) => `
        <article class="mdt-return">
          <div class="row">
            <div>
              <h3>${escapeHtml(item.name)}</h3>
              <p class="muted small">CIV ${escapeHtml(item.civ_number || "pending")} / Record #${item.id}${canViewAccountEmail && item.email ? ` / ${escapeHtml(item.email)}` : ""}</p>
            </div>
            <span class="pill ${item.verified ? "green" : "amber"}">${item.verified ? "verified" : "unverified"}</span>
          </div>
          <div class="mdt-return-grid">
            <div class="metric"><span>License</span><strong>${escapeHtml(item.license_status || "None")}</strong></div>
            <div class="metric"><span>Class</span><strong>${escapeHtml(item.license_class || "None")}</strong></div>
            <div class="metric"><span>Primary Plate</span><strong>${escapeHtml(item.plate || "None")}</strong></div>
            <div class="metric"><span>Car Entry</span><strong>${escapeHtml(item.car_entry_code || "Not filed")}</strong></div>
          </div>
          <div class="mdt-subsection">
            <div class="row"><h4>Registered vehicles</h4><div class="row-actions"><button class="secondary" data-open-mdt-profile="${item.id}">Open master file</button><button class="secondary" data-use-civ="${item.id}">Attach to UTT</button><button class="secondary" data-use-civ-booking="${item.id}">Book arrest</button></div></div>
            ${(item.vehicles || []).map((vehicle) => `<p class="small">${escapeHtml(vehicle.vehicle_year)} ${escapeHtml(vehicle.vehicle_color)} ${escapeHtml(vehicle.vehicle_make)} ${escapeHtml(vehicle.vehicle_model)} - ${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.registration_status)}</p>`).join("") || `<p class="muted small">No registered vehicles on file</p>`}
          </div>
          <div class="mdt-subsection">
            <h4>Open court/citation returns</h4>
            ${(item.open_cases || []).map((c) => `<div class="row"><span>${escapeHtml(c.charge_code)} ${escapeHtml(c.charge_title)}</span><strong>${money(c.fine_amount)}</strong></div>`).join("") || `<p class="muted small">No open citations</p>`}
          </div>
          <div class="mdt-subsection">
            <h4>Booking returns</h4>
            ${(item.bookings || []).slice(0, 4).map((booking) => `<div class="row"><span>${escapeHtml(booking.booking_number)} - ${escapeHtml(booking.charge_code)} ${escapeHtml(booking.charge_title)}</span><span class="pill ${bookingStatusClass(booking.status)}">${escapeHtml(booking.status)}</span></div>`).join("") || `<p class="muted small">No booking history</p>`}
          </div>
          <div class="mdt-subsection ncic-criminal-record">
            <h4>Permanent criminal record</h4>
            ${(item.criminal_record || []).map((record) => `<div class="row"><span>${escapeHtml(record.charge_code)} ${escapeHtml(record.charge_title)} / ${escapeHtml(record.disposition || "decided")}</span><strong>${escapeHtml(record.final_result || `${record.sentence_minutes || 0} min`)}</strong></div>`).join("") || `<p class="muted small">No non-expunged criminal convictions on record</p>`}
          </div>
        </article>
      `).join("") || `
        <section class="mdt-launchpad" aria-label="MDT operations launchpad">
          <div class="mdt-launch-hero">
            <div>
              <p class="eyebrow">NCIC / DMV secure gateway</p>
              <h2>Ready for query</h2>
              <p>Search a civilian, plate, CIV number, or vehicle entry code above. Records open inside this secured workspace.</p>
            </div>
            <div class="mdt-radar" aria-hidden="true"><span></span><i></i></div>
          </div>
          <div class="mdt-launch-grid">
            <button type="button" data-mdt-tab="ticket">
              <span class="mdt-launch-index">01 / TRAFFIC</span>
              <strong>Issue Citation</strong>
              <small>Verify a subject, select a civil code, and complete the UTT workflow.</small>
              <i>Open writer</i>
            </button>
            <button type="button" data-mdt-tab="booking">
              <span class="mdt-launch-index">02 / CUSTODY</span>
              <strong>Booking Intake</strong>
              <small>Transport confirmation, criminal charge, property, and court packet.</small>
              <i>Open desk</i>
            </button>
            <button type="button" data-mdt-tab="bolos">
              <span class="mdt-launch-index">03 / INTELLIGENCE</span>
              <strong>BOLO Network</strong>
              <small>Review active alerts, caution levels, vehicles, and target information.</small>
              <i>Open board</i>
            </button>
            <button type="button" data-mdt-tab="cad-reports">
              <span class="mdt-launch-index">04 / REPORTING</span>
              <strong>After-Call Reports</strong>
              <small>File incident narratives, dispositions, involved parties, and evidence.</small>
              <i>Open reports</i>
            </button>
          </div>
          <div class="mdt-system-band">
            <span><b></b> NCIC link operational</span>
            <span><b></b> DMV index synchronized</span>
            <span><b></b> Court interface available</span>
            <span>Encrypted / role controlled</span>
          </div>
        </section>
      `}
    </div>
  `;
}

function renderMdtProfileModal() {
  const person = (state.cache.mdt?.search || []).find((item) => String(item.id) === String(state.mdtProfileUserId));
  if (!person) {
    return "";
  }
  const vehicles = person.vehicles || [];
  const applications = person.license_applications || [];
  const warrants = person.warrants || [];
  const bookings = person.bookings || [];
  const activeBookings = bookings.filter((item) => ["intake", "booked", "holding", "ready_for_court"].includes(item.status));
  const previousBookings = bookings.filter((item) => !["intake", "booked", "holding", "ready_for_court"].includes(item.status));
  const activeWarrants = warrants.filter((item) => ["active", "pending"].includes(item.status));
  const previousWarrants = warrants.filter((item) => !["active", "pending"].includes(item.status));
  const licenseStatus = person.license_status || "None";
  const canSuspendLicense = licenseStatus === "Valid";
  const canViewAccountEmail = canAny("owner", "admin");
  return `
    <div class="modal-backdrop mdt-profile-backdrop" data-close-mdt-profile>
      <section class="mdt-modal mdt-profile-modal" role="dialog" aria-modal="true" aria-label="Civilian MDT profile">
        <header class="row">
          <div>
            <p class="eyebrow">Civilian profile file</p>
            <h2>${escapeHtml(person.name)}</h2>
            <p class="muted small">CIV ${escapeHtml(person.civ_number || "pending")} / DB #${person.id}</p>
          </div>
          <button class="icon-action" type="button" data-close-mdt-profile aria-label="Close">${iconSvg.back}</button>
        </header>
        <div class="court-tabs">
          <button class="${state.mdtProfileTab === "profile" ? "active" : ""}" type="button" data-mdt-profile-tab="profile">Profile</button>
          <button class="${state.mdtProfileTab === "license" ? "active" : ""}" type="button" data-mdt-profile-tab="license">Driver License</button>
          <button class="${state.mdtProfileTab === "warrants" ? "active" : ""}" type="button" data-mdt-profile-tab="warrants">Warrants ${activeWarrants.length ? `(${activeWarrants.length})` : ""}</button>
          <button class="${state.mdtProfileTab === "bookings" ? "active" : ""}" type="button" data-mdt-profile-tab="bookings">Bookings ${activeBookings.length ? `(${activeBookings.length})` : ""}</button>
          <button class="${state.mdtProfileTab === "record" ? "active" : ""}" type="button" data-mdt-profile-tab="record">Criminal Record ${(person.criminal_record || []).length ? `(${person.criminal_record.length})` : ""}</button>
        </div>
        <div class="admin-account-scroll">
          ${state.mdtProfileTab === "record" ? `
            <section class="account-section ncic-master-record">
              <div class="row tight"><h3>Permanent Criminal Record</h3><span class="pill red">${(person.criminal_record || []).length} entries</span></div>
              ${(person.criminal_record || []).map((record) => `<article class="ncic-record-entry"><div class="row"><div><strong>${escapeHtml(record.charge_code)} — ${escapeHtml(record.charge_title)}</strong><p class="muted small">Case #${record.id} / decided ${record.decided_at ? new Date(record.decided_at).toLocaleDateString() : "date unavailable"} / Judge ${escapeHtml(record.judge_name || "Court")}</p></div><span class="pill">${escapeHtml(record.disposition || "decided")}</span></div><p>${escapeHtml(record.final_result || "Court decision filed")}</p></article>`).join("") || `<div class="empty">No non-expunged criminal convictions on this profile.</div>`}
            </section>
          ` : state.mdtProfileTab === "warrants" ? `
            <section class="account-section">
              <div class="row tight">
                <h3>Warrant Record</h3>
                <span class="pill red">${activeWarrants.length} active</span>
              </div>
              <div class="mdt-subsection">
                <h4>Active warrants</h4>
                ${activeWarrants.map((warrant) => `
                  <article class="warrant-file">
                    <div class="row">
                      <div>
                        <strong>${escapeHtml(warrant.warrant_number)} - ${escapeHtml(warrant.warrant_type)}</strong>
                        <p class="muted small">${escapeHtml(warrant.case_number || "No linked case")} - ${escapeHtml(warrant.priority)} - ${escapeHtml(warrant.creator_name || "Unknown issuer")}</p>
                      </div>
                      <span class="pill red">${escapeHtml(warrant.status)}</span>
                    </div>
                    <p>${escapeHtml(warrant.probable_cause)}</p>
                    <div class="row-actions">
                      <button class="secondary" type="button" data-profile-warrant-status="${warrant.id}" data-status="served">Mark served</button>
                      <button class="secondary" type="button" data-profile-warrant-status="${warrant.id}" data-status="recalled">Recall</button>
                    </div>
                  </article>
                `).join("") || `<p class="muted small">No active warrants attached to this profile</p>`}
              </div>
              <div class="mdt-subsection">
                <h4>Previous warrants</h4>
                ${previousWarrants.map((warrant) => `<div class="row"><span>${escapeHtml(warrant.warrant_number)} - ${escapeHtml(warrant.warrant_type)}</span><span class="pill ${mdtStatusClass(warrant.status)}">${escapeHtml(warrant.status)}</span></div>`).join("") || `<p class="muted small">No previous warrant history</p>`}
              </div>
            </section>
          ` : state.mdtProfileTab === "bookings" ? `
            <section class="account-section">
              <div class="row tight">
                <h3>Booking Record</h3>
                <span class="pill ${activeBookings.length ? "red" : "green"}">${activeBookings.length} active</span>
              </div>
              <div class="row-actions">
                <button class="danger" type="button" data-use-civ-booking="${person.id}">Create booking packet</button>
                <button class="secondary" type="button" data-use-civ="${person.id}">Write citation</button>
              </div>
              <div class="mdt-subsection">
                <h4>Active custody</h4>
                ${activeBookings.map((booking) => renderBookingCard({ ...booking, civ_name: person.name, civ_number: person.civ_number }, true)).join("") || `<p class="muted small">No active booking packets attached to this profile</p>`}
              </div>
              <div class="mdt-subsection">
                <h4>Previous bookings</h4>
                ${previousBookings.map((booking) => renderBookingCard({ ...booking, civ_name: person.name, civ_number: person.civ_number }, false)).join("") || `<p class="muted small">No previous booking history</p>`}
              </div>
            </section>
          ` : state.mdtProfileTab === "license" ? `
            <section class="account-section mdt-license-file">
              <div class="row tight">
                <h3>Driver License</h3>
                <span class="pill ${mdtStatusClass(licenseStatus)}">${escapeHtml(licenseStatus)}</span>
              </div>
              <div class="profile-grid compact">
                <div class="metric"><span>Class</span><strong>${escapeHtml(person.license_class || "None")}</strong></div>
                <div class="metric"><span>Primary Plate</span><strong>${escapeHtml(person.plate || "None")}</strong></div>
                <div class="metric"><span>Registration</span><strong>${escapeHtml(person.registration_status || "None")}</strong></div>
                <div class="metric"><span>Insurance</span><strong>${escapeHtml(person.insurance_status || "None")}</strong></div>
              </div>
              ${canSuspendLicense ? `
                <form class="mdt-license-suspend-form form-grid" data-user-id="${person.id}">
                  <label>Suspension reason<textarea name="reason" required placeholder="Probable cause or RP reason for the suspension"></textarea></label>
                  <button class="danger" type="submit">Suspend driver license</button>
                </form>
              ` : `<p class="muted small">Suspension action is available only when the license status is Valid.</p>`}
              <div class="mdt-subsection">
                <h4>License applications</h4>
                ${applications.map((item) => `<div class="row"><span>${escapeHtml(item.application_type)} / ${escapeHtml(item.license_class)}</span><span class="pill ${mdtStatusClass(item.status)}">${escapeHtml(item.status)}</span></div>`).join("") || `<p class="muted small">No license applications on file</p>`}
              </div>
            </section>
          ` : `
            <section class="account-section">
              <div class="row tight">
                <h3>Identity</h3>
                <span class="pill ${person.verified ? "green" : "amber"}">${person.verified ? "verified" : "unverified"}</span>
              </div>
              <div class="profile-grid compact">
                ${canViewAccountEmail && person.email ? `<div class="metric"><span>Email</span><strong>${escapeHtml(person.email)}</strong></div>` : ""}
                <div class="metric"><span>Roles</span><strong>${escapeHtml((person.roles || []).join(", ") || "civ")}</strong></div>
                <div class="metric"><span>Car Entry</span><strong>${escapeHtml(person.car_entry_code || "Not filed")}</strong></div>
                <div class="metric"><span>Bookings</span><strong>${bookings.length}</strong></div>
              </div>
              <div class="mdt-subsection">
                <div class="row"><h4>Registered vehicles</h4><div class="row-actions"><button class="secondary" data-use-civ="${person.id}">Use for ticket</button><button class="secondary" data-use-civ-booking="${person.id}">Book arrest</button></div></div>
                ${vehicles.map((vehicle) => `<p class="small">${escapeHtml(vehicle.vehicle_year)} ${escapeHtml(vehicle.vehicle_color)} ${escapeHtml(vehicle.vehicle_make)} ${escapeHtml(vehicle.vehicle_model)} - ${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.registration_status)}</p>`).join("") || `<p class="muted small">No registered vehicles on file</p>`}
              </div>
              <div class="mdt-subsection">
                <h4>Open court/citation returns</h4>
                ${(person.open_cases || []).map((c) => `<div class="row"><span>${escapeHtml(c.charge_code)} ${escapeHtml(c.charge_title)}</span><strong>${money(c.fine_amount)}</strong></div>`).join("") || `<p class="muted small">No open citations</p>`}
              </div>
            </section>
          `}
        </div>
      </section>
    </div>
  `;
}

function getMdtCatalog(kind) {
  const data = state.cache.mdt?.charges || {};
  if (kind === "criminal") return data.criminal_charges || [];
  return data.citations || [];
}

function renderChargeOptions(charges, selectedId = "") {
  const groups = new Map();
  charges.forEach((charge) => {
    const category = charge.category || "Other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(charge);
  });
  return Array.from(groups.entries()).map(([category, rows]) => `
    <optgroup label="${escapeHtml(category)}">
      ${rows.map((charge) => `<option value="${charge.id}"${selectedAttr(charge.id, selectedId)}>${escapeHtml(charge.code)} - ${escapeHtml(charge.title)} - ${money(charge.fine_amount)}</option>`).join("")}
    </optgroup>
  `).join("");
}

function renderTicketWriter() {
  const charges = getMdtCatalog(state.mdtCatalogMode);
  const civilians = getMdtCivilians();
  const criminalMode = state.mdtCatalogMode === "criminal";
  const defaultCourt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const selectedCharge = charges.find((charge) => String(charge.id) === String(state.mdtSelectedChargeId));
  const selectedCitationIds = (state.mdtCitationChargeIds || [state.mdtSelectedChargeId]).filter(Boolean).map(String);
  if (!criminalMode) {
    return `
      <form id="ticketForm" class="citation-writer">
        <header class="citation-writer-head">
          <div>
            <p class="eyebrow">New York State / Uniform Traffic Ticket</p>
            <h2>Issue Citation</h2>
            <p>Create a civil traffic or parking filing. Criminal counts must continue through Booking.</p>
          </div>
          <div class="citation-writer-ref">
            <span>Electronic filing</span>
            <strong>UTT / ${new Date().getFullYear()}</strong>
            <small>Officer authenticated</small>
          </div>
        </header>
        <nav class="citation-workflow-nav" aria-label="Citation workflow">
          <span class="active"><b>01</b> Subject</span>
          <span><b>02</b> Violation</span>
          <span><b>03</b> Statement</span>
          <span><b>04</b> File</span>
        </nav>
        <div class="citation-writer-layout">
          <div class="citation-form-body">
            <section class="citation-form-section">
              <header><span>01</span><div><strong>Subject and appearance</strong><small>Attach the civilian record and schedule the court appearance.</small></div></header>
              <div class="grid-2">
                <label>Civilian record<select name="civ_id" required data-issue-subject>
                  <option value="">Select civilian record</option>
                  ${civilians.map((person) => `<option value="${person.id}" data-name="${escapeHtml(person.name)}"${selectedAttr(person.id, state.mdtSelectedCiv)}>${escapeHtml(person.name)} — CIV ${escapeHtml(person.civ_number || "pending")} — ${escapeHtml(person.license_status || "No license")}</option>`).join("")}
                </select></label>
                <label>Court appearance<input name="court_date" type="date" value="${defaultCourt}" /></label>
              </div>
            </section>
            <section class="citation-form-section">
              <header><span>02</span><div><strong>Violation</strong><small>Select the applicable civil code and record where it occurred.</small></div></header>
              <fieldset class="citation-multi-picker">
                <legend>Citation codes <span data-citation-charge-count>${selectedCitationIds.length}</span> selected</legend>
                <label class="citation-picker-search">Find a violation<input type="search" data-citation-picker-search placeholder="Search code, offense, category, or description..." /></label>
                <div class="citation-picker-options">
                  ${charges.map((charge) => `
                    <label data-citation-picker-option data-citation-picker-text="${escapeHtml(`${charge.code} ${charge.title} ${charge.category} ${charge.description}`.toLowerCase())}">
                      <input type="checkbox" name="charge_ids" value="${charge.id}" ${selectedCitationIds.includes(String(charge.id)) ? "checked" : ""} />
                      <span><strong>${escapeHtml(charge.code)} — ${escapeHtml(charge.title)}</strong><small>${escapeHtml(charge.category)} / ${money(charge.fine_amount)} / ${Number(charge.points || 0)} pts</small></span>
                    </label>
                  `).join("")}
                </div>
              </fieldset>
              <label>Location of occurrence<input name="location" placeholder="Street, nearest cross street, postal, or landmark" required /></label>
              <div class="citation-code-actions">
                <button class="secondary" type="button" data-mdt-tab="citations">Search code table</button>
                <button class="ghost" type="button" data-open-catalog data-catalog-kind="citation">Open compact catalog</button>
              </div>
            </section>
            <section class="citation-form-section">
              <header><span>03</span><div><strong>Officer statement</strong><small>State the observed facts clearly and specifically.</small></div></header>
              <label>Narrative<textarea name="narrative" rows="6" required placeholder="Observed conduct, vehicle and driver details, direction of travel, conditions, and enforcement action..."></textarea></label>
              <div class="citation-narrative-note"><strong>Record standard</strong><span>Document facts—not conclusions. This statement is routed with the citation to the court docket.</span></div>
            </section>
          </div>
          <aside class="citation-review-panel">
            <div class="citation-review-title"><span>Filing review</span><b>Draft</b></div>
            <dl>
              <div><dt>Violations</dt><dd data-citation-review-count>${selectedCitationIds.length || "None"}</dd></div>
              <div><dt>Codes</dt><dd data-citation-review-code>${selectedCitationIds.map((id) => charges.find((charge) => String(charge.id) === id)?.code).filter(Boolean).join(", ") || "Not selected"}</dd></div>
              <div><dt>Total fines</dt><dd data-citation-review-fine>${money(charges.filter((charge) => selectedCitationIds.includes(String(charge.id))).reduce((sum, charge) => sum + Number(charge.fine_amount || 0), 0))}</dd></div>
              <div><dt>Total points</dt><dd data-citation-review-points>${charges.filter((charge) => selectedCitationIds.includes(String(charge.id))).reduce((sum, charge) => sum + Number(charge.points || 0), 0)}</dd></div>
            </dl>
            <div class="citation-review-rule"></div>
            <p>Submission creates the civil citation and routes it to the court queue. It does not create a warrant or booking.</p>
            <button class="citation-file-button" type="submit"><span>File Citation</span><small>Submit to court docket</small></button>
            <button class="citation-mode-link" type="button" data-catalog-mode="criminal">Criminal charge? Continue to Booking</button>
          </aside>
        </div>
      </form>
    `;
  }
  return `
    <form id="ticketForm" class="mdt-form criminal-booking-handoff-form">
      <section class="ticket-command-strip">
        <button type="button" data-open-catalog data-catalog-kind="citation"><strong>Citation Book</strong><span>Traffic, vehicle, and parking codes</span></button>
        <button type="button" data-catalog-mode="criminal"><strong>Criminal Charges</strong><span>Transport and continue to Booking</span></button>
        <button type="button" data-mdt-tab="citations"><strong>NYS Codes</strong><span>Browse citation cards</span></button>
      </section>
      <div class="mdt-section-head">
        <div><p class="eyebrow">${criminalMode ? "Custodial criminal process" : "Citation writer"}</p><h2>${criminalMode ? "Transport to Booking" : "Issue Citation"}</h2></div>
        <button class="secondary" type="button" data-open-catalog>Browse codes</button>
      </div>
      <div class="segmented mdt-code-switch">
        <button type="button" class="${state.mdtCatalogMode === "citation" ? "active" : ""}" data-catalog-mode="citation">Citations</button>
        <button type="button" class="${state.mdtCatalogMode === "criminal" ? "active" : ""}" data-catalog-mode="criminal">Criminal</button>
        <button type="button" data-open-catalog>Catalog</button>
      </div>
      <div class="grid-2">
        <label>${criminalMode ? "Subject civilian" : "Civilian record"}<select name="civ_id" required data-issue-subject>
          <option value="">Select civilian record</option>
          ${civilians.map((person) => `<option value="${person.id}" data-name="${escapeHtml(person.name)}"${selectedAttr(person.id, state.mdtSelectedCiv)}>${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No license")}</option>`).join("")}
        </select></label>
        <label>Court date<input name="court_date" type="date" value="${defaultCourt}" /></label>
      </div>
      <label>Code<select name="charge_id" required>
        <option value="">Select ${criminalMode ? "criminal charge" : "citation code"}</option>
        ${renderChargeOptions(charges, state.mdtSelectedChargeId)}
      </select></label>
      <label>Location<input name="location" placeholder="Street, postal, landmark" required /></label>
      ${criminalMode ? `
        <label>Probable cause<textarea name="probable_cause" required placeholder="Facts supporting custody, arrest, and the selected criminal charge"></textarea></label>
        <label>Transport destination<input name="holding_cell" required placeholder="Booking desk, Cell A1, hospital watch" /></label>
        <section class="mdt-subsection transport-confirm-section">
          <div class="row"><h4>Transport confirmation</h4><span class="pill red">Required</span></div>
          <label class="check-row"><input type="checkbox" name="transport_confirmed" value="true" required /> I confirm the suspect has been transported to the booking location.</label>
          <p class="muted small">Criminal charges are processed through Booking after transport. This action does not issue a warrant.</p>
        </section>
        <button class="danger" type="submit">Confirm Transport & Continue to Booking</button>
      ` : `
        <label>Narrative<textarea name="narrative" required placeholder="Observed violation, location, vehicle/driver details, and officer notes"></textarea></label>
        <button class="primary" type="submit">Issue citation</button>
      `}
    </form>
  `;
}

function renderCriminalWarrantWriter(charges) {
  const civilians = getMdtCivilians();
  const cases = state.cache.mdt?.cid?.investigations || [];
  const defaultCourt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `
    <form id="chargeWarrantForm" class="mdt-form charge-warrant-form">
      <div class="mdt-section-head">
        <div><p class="eyebrow">Criminal charge warrant</p><h2>Sign and Issue Warrant</h2></div>
        <span class="pill red">Active warrant</span>
      </div>
      <div class="grid-2">
        <label>Subject civilian<select name="civ_id" required data-charge-warrant-subject>
          <option value="">Select civilian record</option>
          ${civilians.map((person) => `<option value="${person.id}" data-name="${escapeHtml(person.name)}">${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No license")}</option>`).join("")}
        </select></label>
        <label>Court date<input name="court_date" type="date" value="${defaultCourt}" /></label>
        <input type="hidden" name="subject_name" />
      </div>
      <label>Criminal charge<select name="charge_id" required>
        <option value="">Select criminal charge</option>
        ${charges.map((charge) => `<option value="${charge.id}">${escapeHtml(charge.code)} - ${escapeHtml(charge.title)} - ${escapeHtml(charge.severity)}</option>`).join("")}
      </select></label>
      <div class="grid-2">
        <label>Priority<select name="priority"><option>elevated</option><option>standard</option><option>critical</option></select></label>
        <label>Linked CID case<select name="investigation_id"><option value="">None</option>${cases.map((item) => `<option value="${item.id}">${escapeHtml(item.case_number)} - ${escapeHtml(item.title)}</option>`).join("")}</select></label>
      </div>
      <label>Location<input name="location" placeholder="Street, postal, landmark" required /></label>
      <label>Probable cause<textarea name="probable_cause" required placeholder="Facts supporting the criminal charge and warrant"></textarea></label>
      <label>Operation plan<textarea name="operation_plan" placeholder="Optional service plan, unit notes, or court transport instructions"></textarea></label>
      <button class="danger" type="submit">Sign and issue warrant</button>
    </form>
  `;
}

function bookingStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (["released", "transferred"].includes(normalized)) return "green";
  if (["voided"].includes(normalized)) return "red";
  if (["holding", "ready_for_court"].includes(normalized)) return "amber";
  return "amber";
}

function renderBookingCard(booking, active = true) {
  const statusButtons = [
    ["booked", "Booked"],
    ["holding", "Holding"],
    ["ready_for_court", "Ready for Court"],
    ["released", "Release"],
    ["transferred", "Transfer"],
  ];
  return `
    <article class="booking-card status-${escapeHtml(booking.status || "intake")}" data-booking-card>
      <div class="booking-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(booking.booking_number || "Booking")}</p>
          <h3>${escapeHtml(booking.civ_name || "Unknown subject")}</h3>
          <p class="muted small">CIV ${escapeHtml(booking.civ_number || "pending")} / ${(booking.charges || [{ charge_code: booking.charge_code }]).length} criminal charge(s)</p>
        </div>
        <span class="pill ${bookingStatusClass(booking.status)}">${escapeHtml(booking.status || "intake")}</span>
      </div>
      <div class="booking-meta-grid">
        <div><span>Officer</span><strong>${escapeHtml(booking.officer_name || "Unknown")}</strong></div>
        <div><span>Location</span><strong>${escapeHtml(booking.arrest_location || "Not filed")}</strong></div>
        <div><span>Court Case</span><strong>${booking.court_case_id ? `#${booking.court_case_id}` : "Pending"}</strong></div>
        <div><span>Court Date</span><strong>${escapeHtml(booking.court_date || "Pending")}</strong></div>
        <div><span>Holding</span><strong>${escapeHtml(booking.holding_cell || "Unassigned")}</strong></div>
        <div><span>Transport</span><strong>${booking.transport_confirmed_at ? "Confirmed" : "Not confirmed"}</strong></div>
        <div><span>Bond</span><strong>${money(booking.bond_amount)}</strong></div>
      </div>
      <div class="booking-summary">
        <div class="booking-charge-stack">
          <strong>Filed charges</strong>
          ${(booking.charges || [{ charge_code: booking.charge_code, charge_title: booking.charge_title, severity: booking.severity, court_case_id: booking.court_case_id }]).map((charge) => `
            <div><span><b>${escapeHtml(charge.charge_code)}</b> ${escapeHtml(charge.charge_title)}</span><span class="pill">${escapeHtml(charge.severity || "criminal")}</span><small>${charge.court_case_id ? `Court #${charge.court_case_id}` : "Court pending"}</small></div>
          `).join("")}
        </div>
        <p><strong>Probable cause:</strong> ${escapeHtml(booking.probable_cause || "No probable cause narrative filed")}</p>
        ${booking.property_inventory ? `<p><strong>Property:</strong> ${escapeHtml(booking.property_inventory)}</p>` : ""}
        ${booking.medical_notes ? `<p><strong>Medical:</strong> ${escapeHtml(booking.medical_notes)}</p>` : ""}
        ${booking.booking_notes ? `<p><strong>Notes:</strong> ${escapeHtml(booking.booking_notes)}</p>` : ""}
        ${booking.release_notes ? `<p><strong>Disposition:</strong> ${escapeHtml(booking.release_notes)}</p>` : ""}
      </div>
      ${active ? `
        <div class="booking-action-panel">
          <label>Cell / unit<input data-booking-cell value="${escapeHtml(booking.holding_cell || "")}" placeholder="Cell A1, transport, supervisor hold" /></label>
          <label>Bond<input data-booking-bond type="number" min="0" step="1" value="${escapeHtml(booking.bond_amount || 0)}" /></label>
          <label class="booking-note-field">Status note<textarea data-booking-note rows="2" placeholder="Release condition, transfer destination, booking desk note">${escapeHtml(booking.release_notes || "")}</textarea></label>
        </div>
        <div class="booking-status-buttons">
          ${statusButtons.map(([status, label]) => `<button class="${status === "released" || status === "transferred" ? "danger" : "secondary"}" type="button" data-booking-status="${booking.id}" data-status="${status}" ${booking.status === status ? "disabled" : ""}>${label}</button>`).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function renderBookingSystem() {
  const bookingData = state.cache.mdt?.bookings || {};
  const activeBookings = bookingData.active || [];
  const recentBookings = bookingData.recent || [];
  const previousBookings = recentBookings.filter((item) => !["intake", "booked", "holding", "ready_for_court"].includes(item.status));
  const charges = getMdtCatalog("criminal");
  const civilians = getMdtCivilians();
  const defaultCourt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const draft = state.mdtBookingDraft || {};
  const selectedChargeIds = (draft.charge_ids || [draft.charge_id || state.mdtSelectedChargeId]).filter(Boolean).map(String);
  return `
    <div class="booking-workspace">
      <form id="bookingForm" class="mdt-form booking-intake-form">
        <div class="mdt-section-head">
          <div>
            <p class="eyebrow">Custodial arrest intake</p>
            <h2>Booking Desk</h2>
            <p class="muted small">Create a booking packet, attach a criminal code, and file the court case in one workflow.</p>
          </div>
          <span class="pill red">${activeBookings.length} active</span>
        </div>
        <div class="ticket-command-strip">
          <button type="button" data-mdt-tab="search"><strong>NCIC First</strong><span>Verify the subject record</span></button>
          <button type="button" data-mdt-tab="criminal"><strong>Criminal Codes</strong><span>Review charge definitions</span></button>
          <button type="button" data-mdt-tab="cad-reports"><strong>After-Call Report</strong><span>File incident narrative</span></button>
        </div>
        <div class="grid-2">
          <label>Arrestee<select name="civ_id" required data-booking-subject>
            <option value="">Select civilian record</option>
            ${civilians.map((person) => `<option value="${person.id}"${selectedAttr(person.id, draft.civ_id || state.mdtSelectedCiv)}>${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No license")}</option>`).join("")}
          </select></label>
          <fieldset class="booking-charge-picker">
            <legend>Criminal charges <span data-booking-charge-count>${selectedChargeIds.length}</span> selected</legend>
            <label class="booking-charge-search"><input type="search" data-booking-charge-search placeholder="Search criminal code or offense..." /></label>
            <div class="booking-charge-options">
              ${charges.map((charge) => `
                <label data-booking-charge-option data-booking-charge-text="${escapeHtml(`${charge.code} ${charge.title} ${charge.category} ${charge.description}`.toLowerCase())}">
                  <input type="checkbox" name="charge_ids" value="${charge.id}" ${selectedChargeIds.includes(String(charge.id)) ? "checked" : ""} />
                  <span><strong>${escapeHtml(charge.code)} — ${escapeHtml(charge.title)}</strong><small>${escapeHtml(charge.category)} / ${escapeHtml(charge.severity)}</small></span>
                </label>
              `).join("")}
            </div>
            <p class="muted small">Select every criminal count in this arrest. Each charge receives its own linked court case.</p>
          </fieldset>
          <label>Arrest location<input name="arrest_location" value="${escapeHtml(draft.arrest_location || "")}" required placeholder="Street, postal, landmark, or station" /></label>
          <label>Arrest date/time<input name="arrest_datetime" type="datetime-local" /></label>
          <label>Arresting agency<input name="arresting_agency" value="${escapeHtml(state.session?.user?.primary_agency || "")}" placeholder="Department / agency" /></label>
          <label>Incident / CAD number<input name="incident_number" placeholder="CAD call, report, or scene number" /></label>
          <label>Holding cell / transport destination<input name="holding_cell" value="${escapeHtml(draft.holding_cell || "")}" required placeholder="Cell A1, booking desk, hospital watch" /></label>
          <label>Bond amount<input name="bond_amount" type="number" min="0" step="1" value="0" /></label>
          <label>Court date<input name="court_date" type="date" value="${defaultCourt}" /></label>
        </div>
        <label>Probable cause<textarea name="probable_cause" rows="5" required placeholder="Facts supporting custody, arrest, and the selected criminal code">${escapeHtml(draft.probable_cause || "")}</textarea></label>
        <section class="mdt-subsection transport-confirm-section">
          <div class="row"><h4>Custody transport</h4><span class="pill red">Required</span></div>
          <label class="check-row"><input type="checkbox" name="transport_confirmed" value="true" ${draft.transport_confirmed ? "checked" : ""} required /> Confirm the suspect has arrived at the booking location and is ready for intake.</label>
        </section>
        <div class="grid-2">
          <label>Property inventory<textarea name="property_inventory" rows="4" placeholder="Cash, weapons, contraband, phone, keys, vehicle, evidence tags"></textarea></label>
          <label>Medical / safety notes<textarea name="medical_notes" rows="4" placeholder="Injuries, EMS check, intoxication, restraints, separation notes"></textarea></label>
        </div>
        <label>Booking notes<textarea name="booking_notes" rows="4" placeholder="Miranda/warnings, supervisor approval, transport route, jail desk notes"></textarea></label>
        <button class="danger" type="submit">Create booking packet</button>
      </form>
      <section class="booking-queue">
        <div class="mdt-section-head">
          <div>
            <p class="eyebrow">Custody queue</p>
            <h2>Active Bookings</h2>
          </div>
          <span class="pill amber">${bookingData.stats?.today || 0} today</span>
        </div>
        <div class="booking-card-list">
          ${activeBookings.map((booking) => renderBookingCard(booking, true)).join("") || `<div class="empty">No active bookings in custody</div>`}
        </div>
      </section>
      <section class="booking-history">
        <div class="mdt-section-head">
          <div>
            <p class="eyebrow">Booking archive</p>
            <h2>Recent Releases / Transfers</h2>
          </div>
        </div>
        <div class="booking-card-list compact">
          ${previousBookings.slice(0, 20).map((booking) => renderBookingCard(booking, false)).join("") || `<div class="empty">No previous booking dispositions</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderCodeSection(kind) {
  const rows = getMdtCatalog(kind);
  const categories = [...new Set(rows.map((charge) => String(charge.category || "Other").trim()).filter(Boolean))].sort();
  const savedCategory = kind === "citation" ? state.mdtCitationCategory : state.mdtCriminalCategory;
  const activeCategory = categories.includes(savedCategory) ? savedCategory : "All";
  const visibleRows = activeCategory === "All"
    ? rows
    : rows.filter((charge) => String(charge.category || "Other").trim() === activeCategory);
  return `
    <div class="mdt-section-head">
      <div><p class="eyebrow">${kind === "citation" ? "Traffic and parking" : "New York Penal Law"} catalog</p><h2>${kind === "citation" ? "Citation Code Finder" : "Criminal Charge Finder"}</h2></div>
      <button class="secondary" data-open-catalog data-catalog-kind="${kind}">Open catalog</button>
    </div>
      <section class="citation-code-finder ${kind === "criminal" ? "criminal-code-finder" : ""}">
        <label class="citation-code-search">
          <span>Search ${kind === "citation" ? "citation" : "criminal"} codes</span>
          <input type="search" data-code-search="${kind}" placeholder="Search code, offense, keyword, classification, or description..." autocomplete="off" />
          <kbd>/</kbd>
        </label>
        <nav class="citation-category-tabs" aria-label="Citation code categories">
          <button type="button" class="${activeCategory === "All" ? "active" : ""}" data-code-category="All" data-code-kind="${kind}">
            <strong>All codes</strong><span>${rows.length}</span>
          </button>
          ${categories.map((category) => {
            const count = rows.filter((charge) => String(charge.category || "Other").trim() === category).length;
            return `<button type="button" class="${activeCategory === category ? "active" : ""}" data-code-category="${escapeHtml(category)}" data-code-kind="${kind}"><strong>${escapeHtml(category)}</strong><span>${count}</span></button>`;
          }).join("")}
        </nav>
        <div class="citation-finder-status">
          <span>Showing <strong data-code-visible-count="${kind}">${visibleRows.length}</strong> of ${rows.length} codes</span>
          <span>${escapeHtml(activeCategory === "All" ? "All categories" : activeCategory)}</span>
        </div>
      </section>
    <div class="mdt-code-grid citation-code-results ${kind === "criminal" ? "criminal-code-results" : ""}">
      ${visibleRows.map((charge) => `
        <article class="charge-card mdt-code-card" data-code-card="${kind}" data-code-search-text="${escapeHtml(`${charge.code} ${charge.title} ${charge.category} ${charge.severity} ${charge.description} ${charge.fine_amount} ${charge.points}`.toLowerCase())}">
          <div class="row"><strong>${escapeHtml(charge.code)}</strong><span class="pill">${escapeHtml(charge.severity)}</span></div>
          <h3>${escapeHtml(charge.title)}</h3>
          <p class="muted small">${escapeHtml(charge.category)} - ${money(charge.fine_amount)} - ${charge.points} pts</p>
          <p>${escapeHtml(charge.description)}</p>
          ${kind === "criminal"
            ? `<button class="secondary" type="button" data-select-criminal-charge="${charge.id}">Use charge</button>`
            : `<button class="secondary" type="button" data-select-citation-charge="${charge.id}">Write ticket</button>`}
        </article>
      `).join("") || `<div class="empty">No ${kind} codes loaded</div>`}
      <div class="empty citation-search-empty" data-code-search-empty="${kind}" hidden>No ${kind === "citation" ? "citation" : "criminal"} codes match that search.</div>
    </div>
  `;
}

function renderMdtCatalogModal() {
  const rows = getMdtCatalog(state.mdtCatalogMode);
  return `
    <div class="modal-backdrop" data-close-catalog>
      <section class="mdt-modal" role="dialog" aria-modal="true">
        <header class="row">
          <div><p class="eyebrow">MDT code table</p><h2>${state.mdtCatalogMode === "citation" ? "Citation Codes" : "Criminal Charges"}</h2></div>
          <button class="icon-action" data-close-catalog aria-label="Close">x</button>
        </header>
        <div class="segmented">
          <button class="${state.mdtCatalogMode === "citation" ? "active" : ""}" data-catalog-mode="citation">Citations</button>
          <button class="${state.mdtCatalogMode === "criminal" ? "active" : ""}" data-catalog-mode="criminal">Criminal</button>
          <button data-close-catalog>Close</button>
        </div>
        <div class="mdt-modal-list">
          ${rows.map((charge) => `
            <article class="charge-card">
              <div class="row"><strong>${escapeHtml(charge.code)} - ${escapeHtml(charge.title)}</strong><span class="pill">${money(charge.fine_amount)}</span></div>
              <p class="muted small">${escapeHtml(charge.category)} - ${escapeHtml(charge.severity)} - ${charge.points} pts</p>
              <p>${escapeHtml(charge.description)}</p>
              <button class="secondary" type="button" ${state.mdtCatalogMode === "criminal" ? `data-select-criminal-charge="${charge.id}"` : `data-select-citation-charge="${charge.id}"`}>Use code</button>
            </article>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderMdtNoticeModal() {
  const notice = state.mdtNotice || {};
  return `
    <div class="modal-backdrop notice-backdrop" data-close-mdt-notice>
      <section class="mdt-modal mdt-notice" role="alertdialog" aria-modal="true">
        <header class="row">
          <div>
            <p class="eyebrow">Official NCIC return notice</p>
            <h2>Invalid or unavailable return</h2>
          </div>
          <button class="icon-action" data-close-mdt-notice aria-label="Close">x</button>
        </header>
        <div class="notice-body">
          <p>The name or identifier searched is coming back invalid in the civilian records system.</p>
          <p>This may be caused by misspelling, an unregistered civilian profile, restricted records, or a temporary system error.</p>
          <div class="grid-2">
            <div class="metric"><span>Search</span><strong>${escapeHtml(notice.query || "Unknown")}</strong></div>
            <div class="metric"><span>Reference</span><strong>${escapeHtml(notice.reference || "N/A")}</strong></div>
          </div>
        </div>
        <button class="primary" data-close-mdt-notice>Acknowledge notice</button>
      </section>
    </div>
  `;
}

function trafficStopStepIndex(key) {
  const index = TRAFFIC_STOP_STEPS.findIndex((item) => item.key === key);
  return index >= 0 ? index : 0;
}

function getTrafficStopDriverRecord() {
  const selectedId = String(state.mdtTrafficStopDriverId || "");
  if (!selectedId) return null;
  const pools = [
    state.mdtTrafficStopResults || [],
    state.cache.mdt?.search || [],
    getMdtCivilians(),
  ];
  for (const pool of pools) {
    const match = (pool || []).find((item) => String(item.id) === selectedId);
    if (match) return match;
  }
  return null;
}

function renderTrafficStopAttachedDriver() {
  const person = getTrafficStopDriverRecord();
  if (!state.mdtTrafficStopDriverId && !person) return "";
  const name = person?.name || state.mdtTrafficStopDriverName || "Attached driver";
  const openCases = person?.open_cases || [];
  const activeWarrants = (person?.warrants || []).filter((item) => ["active", "pending"].includes(String(item.status || "").toLowerCase()));
  return `
    <article class="traffic-attached-driver">
      <div>
        <p class="eyebrow">Driver attached to stop</p>
        <strong>${escapeHtml(name)}</strong>
        <span>CIV ${escapeHtml(person?.civ_number || "pending")} / DB #${escapeHtml(state.mdtTrafficStopDriverId)}</span>
      </div>
      <div class="traffic-driver-flags">
        <span class="pill ${mdtStatusClass(person?.license_status)}">${escapeHtml(person?.license_status || "License unknown")}</span>
        <span class="pill ${activeWarrants.length ? "red" : "green"}">${activeWarrants.length} warrants</span>
        <span class="pill ${openCases.length ? "amber" : "green"}">${openCases.length} open cases</span>
      </div>
      <button class="secondary" type="button" data-clear-traffic-driver>Change driver</button>
    </article>
  `;
}

function renderTrafficStopNcicTools() {
  const results = state.mdtTrafficStopResults || [];
  const searched = Boolean(String(state.mdtTrafficStopQuery || "").trim());
  const canViewAccountEmail = canAny("owner", "admin");
  return `
    <section class="traffic-stop-tools">
      <form id="trafficStopNcicForm" class="traffic-ncic-form">
        <label>NCIC / DMV driver search
          <input name="q" minlength="2" value="${escapeHtml(state.mdtTrafficStopQuery)}" placeholder="Name, CIV number, plate, or car entry code" required />
        </label>
        <button class="primary" type="submit">Run NCIC</button>
      </form>
      ${renderTrafficStopAttachedDriver()}
      <div class="traffic-ncic-results" aria-live="polite">
        ${results.map((item) => {
          const vehicles = item.vehicles || [];
          const primaryVehicle = vehicles[0] || {};
          const activeWarrants = (item.warrants || []).filter((warrant) => ["active", "pending"].includes(String(warrant.status || "").toLowerCase()));
          return `
            <article class="traffic-ncic-card">
              <div class="row">
                <div>
                  <h4>${escapeHtml(item.name)}</h4>
                  <p class="muted small">CIV ${escapeHtml(item.civ_number || "pending")} / DB #${item.id}${canViewAccountEmail && item.email ? ` / ${escapeHtml(item.email)}` : ""}</p>
                </div>
                <span class="pill ${item.verified ? "green" : "amber"}">${item.verified ? "verified" : "unverified"}</span>
              </div>
              <div class="traffic-ncic-meta">
                <span><strong>License</strong>${escapeHtml(item.license_status || "None")}</span>
                <span><strong>Plate</strong>${escapeHtml(item.plate || primaryVehicle.plate || "None")}</span>
                <span><strong>Car Code</strong>${escapeHtml(item.car_entry_code || "Not filed")}</span>
                <span><strong>Warrants</strong>${activeWarrants.length}</span>
              </div>
              <p class="muted small">${vehicles.length ? `${escapeHtml(primaryVehicle.vehicle_year || "")} ${escapeHtml(primaryVehicle.vehicle_color || "")} ${escapeHtml(primaryVehicle.vehicle_make || item.vehicle_make || "")} ${escapeHtml(primaryVehicle.vehicle_model || item.vehicle_model || "")}` : "No registered vehicles on file"}</p>
              <div class="row-actions">
                <button class="primary" type="button" data-attach-traffic-driver="${item.id}" data-driver-name="${escapeHtml(item.name)}">Attach driver</button>
              </div>
            </article>
          `;
        }).join("") || (searched
          ? `<div class="traffic-system-note red"><strong>No valid NCIC return</strong><span>The name, CIV, plate, or car code did not return a civilian record. Verify spelling and try again before continuing.</span></div>`
          : `<div class="traffic-system-note"><strong>Run the stop return</strong><span>Search the presented driver or plate, then attach the matching civilian profile to this stop.</span></div>`)}
      </div>
    </section>
  `;
}

function renderTrafficStopOutcomeTools() {
  const hasDriver = Boolean(state.mdtTrafficStopDriverId);
  const selected = state.mdtTrafficStopOutcome;
  return `
    <section class="traffic-stop-tools">
      ${renderTrafficStopAttachedDriver() || `<div class="traffic-system-note red"><strong>No driver attached</strong><span>Go back to the NCIC / DMV step and attach the driver before writing a citation or charge.</span></div>`}
      <div class="traffic-outcome-grid">
        <button class="${selected === "warning" ? "active" : ""}" type="button" data-traffic-stop-outcome="warning" ${hasDriver ? "" : "disabled"}>
          <strong>Warning / Release</strong>
          <span>Document the warning, return documents, and clear the stop.</span>
        </button>
        <button type="button" data-traffic-stop-open-ticket ${hasDriver ? "" : "disabled"}>
          <strong>Open Citation Writer</strong>
          <span>Attach this driver to a NYS traffic, vehicle, or parking ticket.</span>
        </button>
        <button type="button" data-traffic-stop-open-criminal ${hasDriver ? "" : "disabled"}>
          <strong>Criminal Offense</strong>
          <span>Move into the criminal charge and warrant writer.</span>
        </button>
        <button class="${selected === "arrest" ? "active" : ""}" type="button" data-traffic-stop-outcome="arrest" ${hasDriver ? "" : "disabled"}>
          <strong>Arrest Protocol</strong>
          <span>Continue into custody, transport, and criminal filing steps.</span>
        </button>
      </div>
    </section>
  `;
}

function renderTrafficStopArrestTools() {
  return `
    <section class="traffic-stop-tools">
      ${renderTrafficStopAttachedDriver() || `<div class="traffic-system-note red"><strong>No driver attached</strong><span>Attach the driver before proceeding with arrest protocol.</span></div>`}
      <div class="traffic-arrest-panel">
        <div>
          <p class="eyebrow">Arrest protocol</p>
          <h4>Custody and filing sequence</h4>
          <p>Use this when the stop turns into a custodial arrest, criminal warrant, or probable-cause filing.</p>
        </div>
        <ol class="traffic-arrest-list">
          <li>Notify dispatch of arrest status, location, and requested backup or supervisor.</li>
          <li>Order the driver out, secure cuffs when lawful, and search incident to arrest.</li>
          <li>Separate occupants, preserve evidence, and keep scene notes for the report.</li>
          <li>Transport or hand off custody under department protocol.</li>
          <li>File the criminal charge/warrant and after-call report before clearing.</li>
        </ol>
        <div class="traffic-arrest-actions">
          <button class="danger" type="button" data-traffic-stop-open-booking ${state.mdtTrafficStopDriverId ? "" : "disabled"}>Open Booking Desk</button>
          <button class="danger" type="button" data-traffic-stop-open-criminal ${state.mdtTrafficStopDriverId ? "" : "disabled"}>Open Criminal Writer</button>
          <button class="secondary" type="button" data-traffic-stop-open-report>Open After-Call Report</button>
        </div>
      </div>
    </section>
  `;
}

function renderTrafficStopStepTools(step) {
  if (step?.key === "ncic") return renderTrafficStopNcicTools();
  if (step?.key === "outcome") return renderTrafficStopOutcomeTools();
  if (step?.key === "arrest") return renderTrafficStopArrestTools();
  return renderTrafficStopAttachedDriver();
}

function renderTrafficStopAssistantModal() {
  const stepIndex = Math.max(0, Math.min(TRAFFIC_STOP_STEPS.length - 1, Number(state.mdtTrafficStopStep || 0)));
  const step = TRAFFIC_STOP_STEPS[stepIndex];
  const progress = Math.round(((stepIndex + 1) / TRAFFIC_STOP_STEPS.length) * 100);
  return `
    <div class="modal-backdrop traffic-stop-backdrop">
      <section class="mdt-modal traffic-stop-modal" role="dialog" aria-modal="true" aria-label="Traffic stop protocol assistant">
        <header class="traffic-stop-head">
          <div>
            <p class="eyebrow">Traffic stop protocol</p>
            <h2>${escapeHtml(step.title)}</h2>
          </div>
          <button class="icon-action" type="button" data-traffic-stop-close aria-label="Close">${iconSvg.back}</button>
        </header>
        <div class="traffic-progress" aria-label="Traffic stop progress">
          <span style="width:${progress}%"></span>
        </div>
        <div class="traffic-stop-body">
          <span class="pill green">Step ${stepIndex + 1} of ${TRAFFIC_STOP_STEPS.length}</span>
          <h3>${escapeHtml(step.callout)}</h3>
          <p>${escapeHtml(step.body)}</p>
        </div>
        ${renderTrafficStopStepTools(step)}
        <div class="traffic-step-list">
          ${TRAFFIC_STOP_STEPS.map((item, index) => `
            <button type="button" class="${index === stepIndex ? "active" : ""}" data-traffic-stop-step="${index}">
              <span>${String(index + 1).padStart(2, "0")}</span>
              <strong>${escapeHtml(item.title)}</strong>
            </button>
          `).join("")}
        </div>
        <footer class="traffic-stop-actions">
          <button class="secondary" type="button" data-traffic-stop-skip>Skip guide</button>
          <button class="secondary" type="button" data-traffic-stop-prev ${stepIndex === 0 ? "disabled" : ""}>Back</button>
          <button class="primary" type="button" data-traffic-stop-next>${stepIndex === TRAFFIC_STOP_STEPS.length - 1 ? "Finish stop" : "Next prompt"}</button>
        </footer>
      </section>
    </div>
  `;
}

function renderMdtSettings() {
  return `
    <section class="mdt-settings-console">
      <div class="mdt-section-head">
        <div>
          <p class="eyebrow">Officer workflow</p>
          <h2>MDT Settings</h2>
        </div>
        <button class="primary" type="button" data-start-traffic-stop>Initiate Traffic Stop</button>
      </div>
      <div class="traffic-settings-grid">
        <article class="traffic-settings-hero">
          <div>
            <p class="eyebrow">Guided protocol</p>
            <h3>Traffic Stop Assistant</h3>
            <p>Use this during a stop to keep the RP sequence clean: radio, approach, documents, NCIC/DMV, outcome, and documentation.</p>
          </div>
          <button class="primary" type="button" data-start-traffic-stop>Start stop prompts</button>
        </article>
        <article class="mdt-return traffic-setting-card">
          <div class="row">
            <div>
              <h3>Prompt preference</h3>
              <p class="muted small">This setting stays on this device for the logged-in officer.</p>
            </div>
            <span class="pill ${state.mdtProtocolAssistantEnabled ? "green" : "amber"}">${state.mdtProtocolAssistantEnabled ? "enabled" : "paused"}</span>
          </div>
          <label class="check-row"><input type="checkbox" data-mdt-protocol-toggle ${state.mdtProtocolAssistantEnabled ? "checked" : ""} /> Keep traffic stop assistant available in MDT quick tools</label>
        </article>
        <article class="mdt-return traffic-setting-card">
          <h3>Protocol cards</h3>
          <div class="traffic-protocol-preview">
            ${TRAFFIC_STOP_STEPS.map((item, index) => `
              <div>
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(item.title)}</strong>
              </div>
            `).join("")}
          </div>
        </article>
      </div>
    </section>
  `;
}

function getSelectedCidCase(cases) {
  if (!cases.length) {
    state.cidSelectedCaseId = null;
    return null;
  }
  const selected = cases.find((item) => String(item.id) === String(state.cidSelectedCaseId)) || cases[0];
  state.cidSelectedCaseId = selected.id;
  return selected;
}

function cidNotesForCase(cid, caseId) {
  return (cid?.notes || [])
    .filter((note) => String(note.investigation_id) === String(caseId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function cidIaNotesForCase(cid, iaId) {
  return (cid?.ia_notes || [])
    .filter((note) => String(note.ia_id) === String(iaId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function cidWarrantsForCase(cid, caseId) {
  return (cid?.warrants || [])
    .filter((warrant) => String(warrant.investigation_id || "") === String(caseId))
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
}

function renderCidCivilianOptions(civilians, current = "") {
  return civilians.map((person) => `
    <option value="${person.id}" data-name="${escapeHtml(person.name)}"${selectedAttr(person.id, current)}>
      ${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No DMV")}
    </option>
  `).join("");
}

function renderCidInvestigations() {
  const cid = state.cache.mdt?.cid;
  const cases = cid?.investigations || [];
  const civilians = cid?.civilians || [];
  const selectedCase = getSelectedCidCase(cases);
  const selectedNotes = selectedCase ? cidNotesForCase(cid, selectedCase.id) : [];
  const linkedWarrants = selectedCase ? cidWarrantsForCase(cid, selectedCase.id) : [];
  const statusOptions = ["open", "active", "pending warrant", "surveillance", "closed", "archived"];
  const priorityOptions = ["standard", "elevated", "critical"];
  const noteTypeOptions = ["case note", "surveillance log", "evidence", "interview", "operation update"];
  return `
    <div class="cid-tools">
      <form id="cidInvestigationForm" class="cid-intake-board">
        <div class="cid-intake-head">
          <div>
            <p class="eyebrow">CID command desk</p>
            <h2>Open Investigation</h2>
            <p>${cases.length} active folders / ${civilians.length} civilian profiles indexed</p>
          </div>
          <div class="cid-intake-signal">
            <span></span>
            <strong>CASE INTAKE</strong>
          </div>
        </div>
        <div class="cid-intake-grid">
          <label class="cid-field-wide">Case title<input name="title" placeholder="Operation name or investigative title" required /></label>
          <label>Case type<select name="case_type"><option>Surveillance</option><option>Narcotics</option><option>Organized Crime</option><option>Financial Crimes</option><option>Major Crimes</option><option>Intelligence</option><option>Internal Support</option><option>Warrant Operation</option></select></label>
          <label>Priority<select name="priority"><option>standard</option><option>elevated</option><option>critical</option></select></label>
          <label class="cid-field-wide">Target civilian<select name="target_civ_id" data-cid-investigation-target>
            <option value="">Unlisted / unknown target</option>
            ${renderCidCivilianOptions(civilians)}
          </select></label>
          <label>Target alias / name<input name="target_name" data-cid-investigation-name placeholder="Auto-fills from selected profile or type manually" /></label>
          <label>Location / area<input name="location" placeholder="Street, postal, grid, or operating area" /></label>
        </div>
        <label class="cid-summary-field">Investigation summary<textarea name="summary" required rows="12" placeholder="Full narrative, timeline, probable cause, intelligence notes, known associates, evidence references, and investigative plan"></textarea></label>
        <div class="cid-intake-actions">
          <div>
            <span>Lead investigator</span>
            <strong>${escapeHtml(state.session?.user?.name || "CID")}</strong>
          </div>
          <button class="primary" type="submit">Create CID case folder</button>
        </div>
      </form>
      <section class="cid-case-workspace">
        <nav class="cid-case-rail" aria-label="CID case folders">
          ${cases.map((item) => {
            const noteCount = Number(item.note_count ?? cidNotesForCase(cid, item.id).length);
            return `
              <button type="button" class="cid-case-tab ${String(item.id) === String(selectedCase?.id) ? "active" : ""}" data-cid-open-case="${item.id}">
                <span class="cid-case-tab-code">${escapeHtml(item.case_number)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.case_type)} / ${escapeHtml(item.status)}</span>
                <small>${noteCount} notes</small>
              </button>
            `;
          }).join("") || `<div class="empty">No CID investigations yet</div>`}
        </nav>
        ${selectedCase ? `
          <article class="cid-case-folder">
            <div class="cid-folder-head">
              <div>
                <p class="eyebrow">Case Folder</p>
                <h2>${escapeHtml(selectedCase.case_number)} - ${escapeHtml(selectedCase.title)}</h2>
                <p class="muted small">${escapeHtml(selectedCase.case_type)} / Lead ${escapeHtml(selectedCase.lead_name)} / ${escapeHtml(selectedCase.location || "No area logged")}</p>
              </div>
              <span class="pill ${selectedCase.priority === "critical" ? "red" : selectedCase.priority === "elevated" ? "amber" : "green"}">${escapeHtml(selectedCase.priority)}</span>
            </div>
            <div class="cid-folder-grid">
              <div class="metric"><span>Status</span><strong>${escapeHtml(selectedCase.status)}</strong></div>
              <div class="metric"><span>Target</span><strong>${escapeHtml(selectedCase.target_civ_name || selectedCase.target_name || "Unlisted")}</strong></div>
              <div class="metric"><span>Notes</span><strong>${Number(selectedCase.note_count ?? selectedNotes.length)}</strong></div>
              <div class="metric"><span>Warrants</span><strong>${Number(selectedCase.warrant_count ?? linkedWarrants.length)}</strong></div>
            </div>
            <div class="cid-summary">
              <strong>Investigation Summary</strong>
              <p>${escapeHtml(selectedCase.summary)}</p>
            </div>
            <div class="cid-tool-strip">
              <button type="button" data-cid-note-type="surveillance log" data-case-id="${selectedCase.id}"><strong>Surveillance</strong><span>Tail, scene, camera, or pattern log</span></button>
              <button type="button" data-cid-note-type="evidence" data-case-id="${selectedCase.id}"><strong>Evidence</strong><span>Clip, witness, property, or chain note</span></button>
              <button type="button" data-cid-note-type="interview" data-case-id="${selectedCase.id}"><strong>Interview</strong><span>Witness, suspect, or officer statement</span></button>
              <button type="button" data-cid-note-type="operation update" data-case-id="${selectedCase.id}"><strong>Operation</strong><span>Warrant, IA, raid, or command update</span></button>
            </div>
            <div class="cid-folder-columns">
              <div class="cid-folder-panel">
                <h3>Case Controls</h3>
                <form class="cid-case-update form-grid" data-case-id="${selectedCase.id}">
                  <label>Status<select name="status">${renderOptions(statusOptions, selectedCase.status)}</select></label>
                  <label>Priority<select name="priority">${renderOptions(priorityOptions, selectedCase.priority)}</select></label>
                  <button class="secondary" type="submit">Update case folder</button>
                </form>
                <form class="cid-note-form form-grid" data-case-id="${selectedCase.id}">
                  <label>Log type<select name="note_type">${renderOptions(noteTypeOptions, "case note")}</select></label>
                  <label>Case note<textarea name="body" required placeholder="Log the case-specific tracking note here"></textarea></label>
                  <button class="primary" type="submit">Add to this case</button>
                </form>
              </div>
              <div class="cid-folder-panel">
                <div class="row"><h3>Case Notes</h3><span class="pill">${selectedNotes.length}</span></div>
                <div class="cid-note-list">
                  ${selectedNotes.map((note) => `
                    <div class="message-card">
                      <div class="row"><strong>${escapeHtml(note.note_type)}</strong><span class="pill">${escapeHtml(note.author_name)}</span></div>
                      <p class="muted small">${new Date(note.created_at).toLocaleString()}</p>
                      <p>${escapeHtml(note.body)}</p>
                    </div>
                  `).join("") || `<p class="muted small">No notes logged inside this case folder</p>`}
                </div>
              </div>
            </div>
            <div class="cid-folder-panel">
              <div class="row"><h3>Linked Warrants</h3><span class="pill red">${linkedWarrants.filter((item) => item.status === "active").length} active</span></div>
              <div class="cid-linked-list">
                ${linkedWarrants.map((warrant) => `
                  <div class="cid-linked-item">
                    <strong>${escapeHtml(warrant.warrant_number)} - ${escapeHtml(warrant.subject_name)}</strong>
                    <span>${escapeHtml(warrant.warrant_type)} / ${escapeHtml(warrant.status)} / ${escapeHtml(warrant.priority)}</span>
                  </div>
                `).join("") || `<p class="muted small">No warrants linked to this investigation yet</p>`}
              </div>
            </div>
          </article>
        ` : `<div class="empty">Create a CID investigation to open a case folder</div>`}
      </section>
    </div>
  `;
}

function renderCidWarrants() {
  const cid = state.cache.mdt?.cid;
  const warrants = cid?.warrants || [];
  const activeWarrants = warrants.filter((item) => ["active", "pending"].includes(item.status));
  const previousWarrants = warrants.filter((item) => !["active", "pending"].includes(item.status));
  const cases = cid?.investigations || [];
  const civilians = cid?.civilians || [];
  return `
    <div class="cid-tools">
      <form id="cidWarrantForm" class="cid-intake-board warrant-ops-board">
        <div class="cid-intake-head">
          <div>
            <p class="eyebrow">CID warrant operations</p>
            <h2>Warrant Control</h2>
            <p>${activeWarrants.length} active operations / ${previousWarrants.length} previous warrant files</p>
          </div>
          <div class="cid-command-pulse">
            <span></span>
            <strong>WARRANT OPS</strong>
          </div>
        </div>
        <div class="cid-intake-grid">
          <label>Subject civilian<select name="subject_civ_id" required data-cid-warrant-subject>
            <option value="">Select civilian record</option>
            ${civilians.map((person) => `<option value="${person.id}" data-name="${escapeHtml(person.name)}">${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No license")}</option>`).join("")}
          </select></label>
          <label>Subject status<input value="Linked to selected civilian profile" disabled /></label>
          <input type="hidden" name="subject_name" />
          <label>Warrant type<select name="warrant_type"><option>Arrest Warrant</option><option>Search Warrant</option><option>Bench Warrant</option><option>BOLO / Locate</option><option>High Risk Operation</option></select></label>
          <label>Priority<select name="priority"><option>standard</option><option>elevated</option><option>critical</option></select></label>
          <label>Linked case<select name="investigation_id"><option value="">None</option>${cases.map((item) => `<option value="${item.id}">${escapeHtml(item.case_number)} - ${escapeHtml(item.title)}</option>`).join("")}</select></label>
          <label>Expires<input name="expires_at" type="date" /></label>
          <label class="cid-field-wide">Authorized by<input name="authorized_by" placeholder="Judge / command approval" /></label>
        </div>
        <label class="cid-summary-field">Probable cause<textarea name="probable_cause" required rows="8" placeholder="Facts, evidence, witness statements, case references, and legal basis"></textarea></label>
        <label>Operation plan<textarea name="operation_plan" rows="5" placeholder="Service plan, units, scene safety, transport or surveillance notes"></textarea></label>
        <button class="primary" type="submit">Create warrant record</button>
      </form>
      <section class="cid-folder-panel">
        <div class="row"><h3>Active Warrant Board</h3><span class="pill red">${activeWarrants.length} active</span></div>
        <div class="warrant-button-grid">
          ${activeWarrants.map((item) => `
            <button type="button" class="warrant-button" data-open-cid-warrant="${item.id}">
              <strong>${escapeHtml(item.warrant_number)}</strong>
              <span>${escapeHtml(item.subject_civ_name || item.subject_name)}</span>
              <small>${escapeHtml(item.warrant_type)} / ${escapeHtml(item.status)}</small>
            </button>
          `).join("") || `<div class="empty">No active warrants</div>`}
        </div>
      </section>
      <section class="cid-folder-panel">
        <div class="row"><h3>Previous Warrants</h3><span class="pill">${previousWarrants.length}</span></div>
        <div class="warrant-button-grid compact">
          ${previousWarrants.map((item) => `
            <button type="button" class="warrant-button previous" data-open-cid-warrant="${item.id}">
              <strong>${escapeHtml(item.warrant_number)}</strong>
              <span>${escapeHtml(item.subject_civ_name || item.subject_name)}</span>
              <small>${escapeHtml(item.status)}</small>
            </button>
          `).join("") || `<p class="muted small">No previous warrants</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderCidWarrantModal(item) {
  if (!item) return "";
  return `
    <div class="modal-backdrop" data-close-cid-warrant>
      <section class="mdt-modal warrant-detail-modal" role="dialog" aria-modal="true" aria-label="Warrant detail">
        <header class="row">
          <div>
            <p class="eyebrow">Warrant file</p>
            <h2>${escapeHtml(item.warrant_number)} - ${escapeHtml(item.subject_civ_name || item.subject_name)}</h2>
            <p class="muted small">${escapeHtml(item.subject_civ_number || "No CIV link")} / ${escapeHtml(item.case_number || "No linked case")}</p>
          </div>
          <button class="icon-action" type="button" data-close-cid-warrant aria-label="Close">${iconSvg.back}</button>
        </header>
        <div class="admin-account-scroll">
          <div class="profile-grid compact">
            <div class="metric"><span>Status</span><strong>${escapeHtml(item.status)}</strong></div>
            <div class="metric"><span>Priority</span><strong>${escapeHtml(item.priority)}</strong></div>
            <div class="metric"><span>Type</span><strong>${escapeHtml(item.warrant_type)}</strong></div>
            <div class="metric"><span>Issued</span><strong>${item.issued_at ? new Date(item.issued_at).toLocaleDateString() : "N/A"}</strong></div>
          </div>
          <div class="mdt-subsection">
            <h4>Probable cause</h4>
            <p>${escapeHtml(item.probable_cause)}</p>
          </div>
          <div class="mdt-subsection">
            <h4>Operation plan</h4>
            <p>${escapeHtml(item.operation_plan || "No operation plan logged")}</p>
          </div>
          <form class="cid-warrant-update form-grid" data-warrant-id="${item.id}">
            <div class="grid-2">
              <label>Status<select name="status">${renderOptions(["active", "pending", "served", "recalled", "expired"], item.status)}</select></label>
              <label>Priority<select name="priority">${renderOptions(["standard", "elevated", "critical"], item.priority)}</select></label>
            </div>
            <button class="secondary" type="submit">Update warrant</button>
          </form>
        </div>
      </section>
    </div>
  `;
}

function renderCidInternalAffairs() {
  const cid = state.cache.mdt?.cid;
  const ia = cid?.ia_cases || [];
  const openStatuses = ["intake", "active", "command review"];
  const activeIa = ia.filter((item) => openStatuses.includes(item.status));
  const previousIa = ia.filter((item) => !openStatuses.includes(item.status));
  const selectedIa = ia.find((item) => String(item.id) === String(state.cidSelectedIaId)) || activeIa[0] || ia[0] || null;
  const selectedIaNotes = selectedIa ? cidIaNotesForCase(cid, selectedIa.id) : [];
  state.cidSelectedIaId = selectedIa?.id || null;
  const statusOptions = ["intake", "active", "command review", "sustained", "unfounded", "closed"];
  const priorityOptions = ["standard", "elevated", "critical"];
  const noteTypeOptions = ["file note", "evidence", "interview", "command review", "finding", "discipline", "timeline update"];
  return `
    <div class="cid-tools ia-tools">
      <form id="cidIaForm" class="cid-intake-board ia-intake-board">
        <div class="cid-intake-head">
          <div>
            <p class="eyebrow">CID internal affairs</p>
            <h2>IA Intake</h2>
            <p>${activeIa.length} active folders / ${previousIa.length} previous IA files</p>
          </div>
          <div class="cid-intake-signal">
            <span></span>
            <strong>IA CONTROL</strong>
          </div>
        </div>
        <div class="cid-intake-grid">
          <label>Subject officer name<input name="subject_name" required /></label>
          <label>Subject officer user ID<input name="subject_officer_id" type="number" placeholder="Optional database ID" /></label>
          <label>Allegation type<select name="allegation_type"><option>Policy Violation</option><option>Use of Force Review</option><option>Corruption / Misconduct</option><option>Evidence Handling</option><option>Complaint Intake</option></select></label>
          <label>Priority<select name="priority"><option>standard</option><option>elevated</option><option>critical</option></select></label>
        </div>
        <label class="cid-summary-field">Summary<textarea name="summary" required rows="10" placeholder="Complaint, evidence, involved parties, timeline, policy issue, and command recommendations"></textarea></label>
        <button class="primary" type="submit">Create IA record</button>
      </form>
      <section class="cid-case-workspace ia-folder-workspace">
        <nav class="cid-case-rail ia-case-rail" aria-label="Internal affairs folders">
          <div class="ia-rail-label">Active IA</div>
          ${activeIa.map((item) => `
            <button type="button" class="cid-case-tab ia-case-tab ${String(item.id) === String(selectedIa?.id) ? "active" : ""}" data-cid-open-ia="${item.id}">
              <span class="cid-case-tab-code">${escapeHtml(item.ia_number)}</span>
              <strong>${escapeHtml(item.subject_officer_name || item.subject_name)}</strong>
              <span>${escapeHtml(item.allegation_type)} / ${escapeHtml(item.status)}</span>
              <small>${escapeHtml(item.priority)} priority / ${Number(item.note_count || 0)} entries</small>
            </button>
          `).join("") || `<div class="empty">No active IA folders</div>`}
          <div class="ia-rail-label previous">Previous IA</div>
          ${previousIa.map((item) => `
            <button type="button" class="cid-case-tab ia-case-tab previous ${String(item.id) === String(selectedIa?.id) ? "active" : ""}" data-cid-open-ia="${item.id}">
              <span class="cid-case-tab-code">${escapeHtml(item.ia_number)}</span>
              <strong>${escapeHtml(item.subject_officer_name || item.subject_name)}</strong>
              <span>${escapeHtml(item.allegation_type)} / ${escapeHtml(item.status)}</span>
              <small>${escapeHtml(item.priority)} priority / ${Number(item.note_count || 0)} entries</small>
            </button>
          `).join("") || `<p class="muted small">No previous IA files</p>`}
        </nav>
        ${selectedIa ? `
          <article class="cid-case-folder ia-case-folder">
            <div class="cid-folder-head">
              <div>
                <p class="eyebrow">Internal Affairs File</p>
                <h2>${escapeHtml(selectedIa.ia_number)} - ${escapeHtml(selectedIa.subject_officer_name || selectedIa.subject_name)}</h2>
                <p class="muted small">${escapeHtml(selectedIa.allegation_type)} / Assigned ${escapeHtml(selectedIa.assigned_name || "CID")} / Opened ${selectedIa.created_at ? new Date(selectedIa.created_at).toLocaleDateString() : "N/A"}</p>
              </div>
              <span class="pill ${selectedIa.priority === "critical" ? "red" : selectedIa.priority === "elevated" ? "amber" : "green"}">${escapeHtml(selectedIa.status)}</span>
            </div>
            <div class="cid-folder-grid">
              <div class="metric"><span>Status</span><strong>${escapeHtml(selectedIa.status)}</strong></div>
              <div class="metric"><span>Priority</span><strong>${escapeHtml(selectedIa.priority)}</strong></div>
              <div class="metric"><span>Allegation</span><strong>${escapeHtml(selectedIa.allegation_type)}</strong></div>
              <div class="metric"><span>File Entries</span><strong>${Number(selectedIa.note_count ?? selectedIaNotes.length)}</strong></div>
            </div>
            <div class="cid-summary ia-summary-file">
              <strong>IA Summary</strong>
              <p>${escapeHtml(selectedIa.summary)}</p>
            </div>
            <div class="cid-tool-strip ia-tool-strip">
              <button type="button" data-cid-ia-note-type="evidence" data-ia-id="${selectedIa.id}"><strong>Evidence</strong><span>Clip, statement, document, or chain note</span></button>
              <button type="button" data-cid-ia-note-type="interview" data-ia-id="${selectedIa.id}"><strong>Interview</strong><span>Officer, witness, complainant statement</span></button>
              <button type="button" data-cid-ia-note-type="command review" data-ia-id="${selectedIa.id}"><strong>Review</strong><span>Supervisor direction or command review</span></button>
              <button type="button" data-cid-ia-note-type="finding" data-ia-id="${selectedIa.id}"><strong>Finding</strong><span>Sustained, unfounded, policy outcome</span></button>
            </div>
            <div class="cid-folder-columns">
              <div class="cid-folder-panel">
                <h3>IA Controls</h3>
                <form class="cid-ia-update form-grid" data-ia-id="${selectedIa.id}">
                  <label>Status<select name="status">${renderOptions(statusOptions, selectedIa.status)}</select></label>
                  <label>Priority<select name="priority">${renderOptions(priorityOptions, selectedIa.priority)}</select></label>
                  <button class="secondary" type="submit">Update IA file</button>
                </form>
                <form class="cid-ia-note-form ia-chat-form" data-ia-id="${selectedIa.id}">
                  <label>Tool<select name="note_type">${renderOptions(noteTypeOptions, "file note")}</select></label>
                  <label class="ia-chat-input">Add to file<textarea name="body" rows="3" required placeholder="Add a file update, evidence note, interview summary, or command action to this IA folder"></textarea></label>
                  <button class="primary" type="submit">Add entry</button>
                </form>
              </div>
              <div class="cid-folder-panel ia-review-panel">
                <div class="row"><h3>File Handling</h3><span class="pill">${selectedIaNotes.length} entries</span></div>
                <div class="list compact-list">
                  <div class="row"><span>Subject</span><strong>${escapeHtml(selectedIa.subject_officer_name || selectedIa.subject_name)}</strong></div>
                  <div class="row"><span>Created by</span><strong>${escapeHtml(selectedIa.created_by_name || "CID")}</strong></div>
                  <div class="row"><span>Assigned</span><strong>${escapeHtml(selectedIa.assigned_name || "CID")}</strong></div>
                  <div class="row"><span>Last update</span><strong>${selectedIa.updated_at ? new Date(selectedIa.updated_at).toLocaleString() : "N/A"}</strong></div>
                </div>
              </div>
            </div>
            <div class="cid-folder-panel ia-file-log">
              <div class="row"><h3>IA File Log</h3><span class="pill amber">${selectedIaNotes.length}</span></div>
              <div class="ia-chat-list">
                ${selectedIaNotes.map((note) => `
                  <article class="ia-chat-entry ${String(note.author_id) === String(state.session?.user?.id) ? "mine" : ""}">
                    <div class="row">
                      <strong>${escapeHtml(note.note_type)}</strong>
                      <span class="pill">${escapeHtml(note.author_name || "CID")}</span>
                    </div>
                    <p>${escapeHtml(note.body)}</p>
                    <small>${note.created_at ? new Date(note.created_at).toLocaleString() : ""}</small>
                  </article>
                `).join("") || `<div class="empty">No investigator entries in this IA file yet</div>`}
              </div>
            </div>
          </article>
        ` : `<div class="empty">Create an IA record to open a file folder</div>`}
      </section>
    </div>
  `;
}

function renderPanic() {
  const alerts = state.cache.mdt?.alerts?.alerts || [];
  const canClearPanic = can("owner");
  return `
    <form id="panicForm" class="mdt-form">
      <button class="panic-button pulse" type="submit">911 ALERT</button>
      <label>Department<select name="department">
        <option value="police">Police</option>
        <option value="fire">Fire</option>
        <option value="ems">EMS</option>
      </select></label>
      <label>Location<input name="location" placeholder="Nearest postal / street" /></label>
      <label>Note<input name="note" placeholder="Short emergency note" /></label>
    </form>
    <div class="list">
      ${alerts.map((alert) => `
        <article class="case-card">
          <div class="row"><h3>${escapeHtml(alert.officer_name)}</h3><span class="pill ${panicStatusClass(alert.status)}">${escapeHtml(alert.department || "police")} - ${escapeHtml(alert.status)}</span></div>
          <p>${escapeHtml(alert.location)}</p>
          <p class="muted small">${escapeHtml(alert.note)}</p>
          <p class="muted small">Activated ${new Date(alert.created_at).toLocaleString()}${alert.resolved_at ? ` - Cleared ${new Date(alert.resolved_at).toLocaleString()}` : ""}</p>
          <div class="row-actions">
            <button class="secondary" type="button" data-use-alert-report="${alert.id}">Write report</button>
            ${canClearPanic && alert.status === "active" ? `<button class="secondary" type="button" data-clear-panic="${alert.id}">Clear panic</button>` : ""}
          </div>
        </article>
      `).join("") || `<div class="empty">No panic activations</div>`}
    </div>
  `;
}

function bindMdtFinders() {
  $("[data-citation-writer-code]")?.addEventListener("change", (event) => {
    const charge = getMdtCatalog("citation").find((item) => String(item.id) === String(event.currentTarget.value));
    const values = {
      "[data-citation-review-code]": charge?.code || "Not selected",
      "[data-citation-review-title]": charge?.title || "Select a violation",
      "[data-citation-review-severity]": charge?.severity || "—",
      "[data-citation-review-fine]": charge ? money(charge.fine_amount) : "—",
      "[data-citation-review-points]": charge ? String(Number(charge.points || 0)) : "—",
    };
    Object.entries(values).forEach(([selector, value]) => {
      const target = $(selector);
      if (target) target.textContent = value;
    });
  });
  const bookingChargeSearch = $("[data-booking-charge-search]");
  if (bookingChargeSearch) {
    const updateBookingCharges = () => {
      const query = bookingChargeSearch.value.trim().toLowerCase();
      $$("[data-booking-charge-option]").forEach((option) => {
        option.hidden = Boolean(query) && !String(option.dataset.bookingChargeText || "").includes(query);
      });
      const count = $("[data-booking-charge-count]");
      if (count) count.textContent = String($$('input[name="charge_ids"]:checked').length);
    };
    bookingChargeSearch.addEventListener("input", updateBookingCharges);
    $$('input[name="charge_ids"]').forEach((input) => input.addEventListener("change", updateBookingCharges));
  }
  const citationPickerSearch = $("[data-citation-picker-search]");
  if (citationPickerSearch) {
    const updateCitationPicker = () => {
      const query = citationPickerSearch.value.trim().toLowerCase();
      $$("[data-citation-picker-option]").forEach((option) => {
        option.hidden = Boolean(query) && !String(option.dataset.citationPickerText || "").includes(query);
      });
      const selectedIds = $$('input[name="charge_ids"]:checked').map((input) => String(input.value));
      state.mdtCitationChargeIds = selectedIds;
      const selectedCharges = getMdtCatalog("citation").filter((charge) => selectedIds.includes(String(charge.id)));
      const values = {
        "[data-citation-charge-count]": String(selectedIds.length),
        "[data-citation-review-count]": selectedIds.length ? String(selectedIds.length) : "None",
        "[data-citation-review-code]": selectedCharges.map((charge) => charge.code).join(", ") || "Not selected",
        "[data-citation-review-fine]": money(selectedCharges.reduce((sum, charge) => sum + Number(charge.fine_amount || 0), 0)),
        "[data-citation-review-points]": String(selectedCharges.reduce((sum, charge) => sum + Number(charge.points || 0), 0)),
      };
      Object.entries(values).forEach(([selector, value]) => {
        const target = $(selector);
        if (target) target.textContent = value;
      });
    };
    citationPickerSearch.addEventListener("input", updateCitationPicker);
    $$('input[name="charge_ids"]').forEach((input) => input.addEventListener("change", updateCitationPicker));
  }
  $$("[data-code-category]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.codeKind === "criminal") {
      state.mdtCriminalCategory = button.dataset.codeCategory || "All";
    } else {
      state.mdtCitationCategory = button.dataset.codeCategory || "All";
    }
    render();
  }));
  $$("[data-code-search]").forEach((codeSearch) => {
    codeSearch.addEventListener("input", () => {
      const kind = codeSearch.dataset.codeSearch;
      const query = codeSearch.value.trim().toLowerCase();
      const cards = $$(`[data-code-card="${kind}"]`);
      let visible = 0;
      cards.forEach((card) => {
        const match = !query || String(card.dataset.codeSearchText || "").includes(query);
        card.hidden = !match;
        if (match) visible += 1;
      });
      const count = $(`[data-code-visible-count="${kind}"]`);
      const empty = $(`[data-code-search-empty="${kind}"]`);
      if (count) count.textContent = String(visible);
      if (empty) empty.hidden = visible !== 0;
    });
  });
  if (!document.documentElement.dataset.citationShortcutBound) {
    document.documentElement.dataset.citationShortcutBound = "true";
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || /input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
      const currentSearch = $("[data-code-search]");
      if (!currentSearch) return;
      event.preventDefault();
      currentSearch.focus();
    });
  }
}

function bindMdt() {
  bindMdtFinders();
  $$("[data-mdt-tab]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTab = button.dataset.mdtTab;
    if (button.dataset.cidOpenCase) {
      state.cidSelectedCaseId = button.dataset.cidOpenCase;
    }
    if (button.dataset.cidOpenIa) {
      state.cidSelectedIaId = button.dataset.cidOpenIa;
    }
    state.mdtCatalogOpen = false;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    render();
  }));
  $$("[data-catalog-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mdtCatalogMode = button.dataset.catalogMode;
    render();
  }));
  $$("[data-open-catalog]").forEach((button) => button.addEventListener("click", () => {
    state.mdtCatalogMode = button.dataset.catalogKind || state.mdtCatalogMode;
    state.mdtCatalogOpen = true;
    render();
  }));
  $$("[data-close-catalog]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.mdtCatalogOpen = false;
    render();
  }));
  $$("[data-close-mdt-notice]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.mdtNotice = null;
    render();
  }));
  $$("[data-start-traffic-stop]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTrafficStopActive = true;
    state.mdtTrafficStopStep = 0;
    state.mdtTrafficStopQuery = "";
    state.mdtTrafficStopResults = [];
    state.mdtTrafficStopDriverId = "";
    state.mdtTrafficStopDriverName = "";
    state.mdtTrafficStopOutcome = "";
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    render();
  }));
  $("#trafficStopNcicForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") || "").trim();
    if (q.length < 2) {
      toast("Enter at least 2 characters for NCIC");
      return;
    }
    state.mdtTrafficStopQuery = q;
    try {
      const results = await api(`/api/mdt/search?q=${encodeURIComponent(q)}`);
      state.mdtTrafficStopResults = results.results || [];
      state.cache.mdt = state.cache.mdt || {};
      state.cache.mdt.search = results.results || [];
      if (!state.mdtTrafficStopResults.some((item) => String(item.id) === String(state.mdtTrafficStopDriverId))) {
        state.mdtTrafficStopDriverId = "";
        state.mdtTrafficStopDriverName = "";
        state.mdtTrafficStopOutcome = "";
      }
      if (!state.mdtTrafficStopResults.length) {
        toast("No valid NCIC return for that search");
      }
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-attach-traffic-driver]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTrafficStopDriverId = button.dataset.attachTrafficDriver;
    state.mdtTrafficStopDriverName = button.dataset.driverName || "Attached driver";
    state.mdtSelectedCiv = state.mdtTrafficStopDriverId;
    state.mdtTrafficStopOutcome = "";
    state.mdtTrafficStopStep = trafficStopStepIndex("outcome");
    toast("Driver attached to traffic stop");
    render();
  }));
  $("[data-clear-traffic-driver]")?.addEventListener("click", () => {
    state.mdtTrafficStopDriverId = "";
    state.mdtTrafficStopDriverName = "";
    state.mdtTrafficStopOutcome = "";
    state.mdtTrafficStopStep = trafficStopStepIndex("ncic");
    render();
  });
  $$("[data-traffic-stop-outcome]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTrafficStopOutcome = button.dataset.trafficStopOutcome;
    if (state.mdtTrafficStopOutcome === "arrest") {
      state.mdtTrafficStopStep = trafficStopStepIndex("arrest");
    } else {
      state.mdtTrafficStopStep = trafficStopStepIndex("close");
    }
    render();
  }));
  $$("[data-traffic-stop-open-ticket]").forEach((button) => button.addEventListener("click", () => {
    if (!state.mdtTrafficStopDriverId) {
      toast("Attach a driver before writing a citation");
      return;
    }
    state.mdtSelectedCiv = state.mdtTrafficStopDriverId;
    state.mdtCatalogMode = "citation";
    state.mdtSelectedChargeId = "";
    state.mdtTab = "ticket";
    state.mdtTrafficStopOutcome = "ticket";
    state.mdtTrafficStopActive = false;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    toast("Driver attached to citation writer");
    render();
  }));
  $$("[data-traffic-stop-open-criminal]").forEach((button) => button.addEventListener("click", () => {
    if (!state.mdtTrafficStopDriverId) {
      toast("Attach a driver before filing criminal charges");
      return;
    }
    state.mdtSelectedCiv = state.mdtTrafficStopDriverId;
    state.mdtCatalogMode = "criminal";
    state.mdtSelectedChargeId = "";
    state.mdtTab = "ticket";
    state.mdtTrafficStopOutcome = "criminal";
    state.mdtTrafficStopActive = false;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    toast("Driver attached to criminal Booking handoff");
    render();
  }));
  $$("[data-traffic-stop-open-booking]").forEach((button) => button.addEventListener("click", () => {
    if (!state.mdtTrafficStopDriverId) {
      toast("Attach a driver before opening booking");
      return;
    }
    state.mdtSelectedCiv = state.mdtTrafficStopDriverId;
    state.mdtCatalogMode = "criminal";
    state.mdtSelectedChargeId = "";
    state.mdtTab = "booking";
    state.mdtTrafficStopOutcome = "arrest";
    state.mdtTrafficStopActive = false;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    toast("Driver attached to booking desk");
    render();
  }));
  $("[data-traffic-stop-open-report]")?.addEventListener("click", () => {
    state.mdtTab = "cad-reports";
    state.mdtTrafficStopActive = false;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    toast("After-call report opened");
    render();
  });
  $$("[data-traffic-stop-step]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTrafficStopStep = Number(button.dataset.trafficStopStep || 0);
    render();
  }));
  $("[data-traffic-stop-prev]")?.addEventListener("click", () => {
    state.mdtTrafficStopStep = Math.max(0, Number(state.mdtTrafficStopStep || 0) - 1);
    render();
  });
  $("[data-traffic-stop-next]")?.addEventListener("click", () => {
    const currentIndex = Number(state.mdtTrafficStopStep || 0);
    const currentStep = TRAFFIC_STOP_STEPS[currentIndex] || {};
    if (currentStep.key === "ncic" && !state.mdtTrafficStopDriverId) {
      toast("Attach the driver from NCIC before moving forward");
      return;
    }
    if (currentStep.key === "outcome" && !state.mdtTrafficStopOutcome) {
      toast("Choose the stop outcome first");
      return;
    }
    let nextStep = currentIndex + 1;
    if (currentStep.key === "outcome" && !["arrest", "criminal"].includes(state.mdtTrafficStopOutcome)) {
      nextStep = trafficStopStepIndex("close");
    }
    if (nextStep >= TRAFFIC_STOP_STEPS.length) {
      state.mdtTrafficStopActive = false;
      state.mdtTrafficStopStep = 0;
      toast("Traffic stop guide complete");
    } else {
      state.mdtTrafficStopStep = nextStep;
    }
    render();
  });
  $$("[data-traffic-stop-skip], [data-traffic-stop-close]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTrafficStopActive = false;
    state.mdtTrafficStopStep = 0;
    toast("Traffic stop guide skipped");
    render();
  }));
  $("[data-mdt-protocol-toggle]")?.addEventListener("change", (event) => {
    state.mdtProtocolAssistantEnabled = event.currentTarget.checked;
    localStorage.setItem("rp.mdt.protocolAssistant", state.mdtProtocolAssistantEnabled ? "1" : "0");
    toast(state.mdtProtocolAssistantEnabled ? "Traffic stop assistant enabled" : "Traffic stop assistant paused");
    render();
  });
  $$("[data-use-civ]").forEach((button) => button.addEventListener("click", () => {
    state.mdtSelectedCiv = button.dataset.useCiv;
    state.mdtTab = "ticket";
    state.mdtProfileUserId = null;
    render();
  }));
  $$("[data-use-civ-booking]").forEach((button) => button.addEventListener("click", () => {
    state.mdtSelectedCiv = button.dataset.useCivBooking;
    state.mdtCatalogMode = "criminal";
    state.mdtSelectedChargeId = "";
    state.mdtTab = "booking";
    state.mdtProfileUserId = null;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    render();
  }));
  $$("[data-use-alert-report]").forEach((button) => button.addEventListener("click", () => {
    state.mdtReportAlertId = button.dataset.useAlertReport;
    state.mdtTab = "cad-reports";
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    render();
  }));
  $$("[data-open-mdt-profile]").forEach((button) => button.addEventListener("click", () => {
    state.mdtProfileUserId = button.dataset.openMdtProfile;
    state.mdtProfileTab = "profile";
    render();
  }));
  $$("[data-close-mdt-profile]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.mdtProfileUserId = null;
    render();
  }));
  $$("[data-mdt-profile-tab]").forEach((button) => button.addEventListener("click", () => {
    state.mdtProfileTab = button.dataset.mdtProfileTab;
    render();
  }));
  $$("[data-profile-warrant-status]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const currentPerson = (state.cache.mdt?.search || []).find((item) => String(item.id) === String(state.mdtProfileUserId));
      const currentWarrant = (currentPerson?.warrants || []).find((item) => String(item.id) === String(button.dataset.profileWarrantStatus));
      await api(`/api/cid/warrants/${button.dataset.profileWarrantStatus}`, {
        method: "PATCH",
        body: { status: button.dataset.status, priority: currentWarrant?.priority || "standard" },
      });
      toast(`Warrant ${button.dataset.status}`);
      const activeSearch = state.cache.mdt?.search || [];
      if (activeSearch.length) {
        const q = activeSearch.find((item) => String(item.id) === String(state.mdtProfileUserId))?.name || "";
        if (q) {
          const refreshed = await api(`/api/mdt/search?q=${encodeURIComponent(q)}`);
          state.cache.mdt.search = refreshed.results;
        }
      }
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".mdt-license-suspend-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      const result = await api(`/api/mdt/users/${form.dataset.userId}/license`, { method: "PATCH", body: { ...payload, status: "Suspended" } });
      const target = (state.cache.mdt?.search || []).find((item) => String(item.id) === String(form.dataset.userId));
      if (target) target.license_status = result.license_status || "Suspended";
      toast("Driver license suspended");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#chargeWarrantForm [data-charge-warrant-subject]")?.addEventListener("change", (event) => {
    syncChargeWarrantSubject(event.currentTarget.closest("form"));
  });
  $$("[data-select-criminal-charge]").forEach((button) => button.addEventListener("click", () => {
    state.mdtCatalogMode = "criminal";
    state.mdtSelectedChargeId = button.dataset.selectCriminalCharge;
    state.mdtTab = "ticket";
    state.mdtCatalogOpen = false;
    render();
  }));
  $$("[data-select-citation-charge]").forEach((button) => button.addEventListener("click", () => {
    state.mdtCatalogMode = "citation";
    state.mdtSelectedChargeId = button.dataset.selectCitationCharge;
    state.mdtCitationChargeIds = [button.dataset.selectCitationCharge];
    state.mdtTab = "ticket";
    state.mdtCatalogOpen = false;
    render();
  }));
  $("#chargeWarrantForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      syncChargeWarrantSubject(event.currentTarget);
      const result = await api("/api/mdt/charge-warrants", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(`Warrant ${result.warrant_number} signed - court ${result.court_date}`);
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#bookingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(event.currentTarget);
      const payload = Object.fromEntries(formData.entries());
      payload.charge_ids = formData.getAll("charge_ids");
      if (!payload.charge_ids.length) {
        toast("Select at least one criminal charge");
        return;
      }
      const result = await api("/api/mdt/bookings", { method: "POST", body: payload });
      toast(`Booking ${result.booking_number} filed with ${result.charge_count} charge(s)`);
      state.mdtSelectedChargeId = "";
      state.mdtSelectedCiv = "";
      state.mdtBookingDraft = null;
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-booking-status]").forEach((button) => button.addEventListener("click", async () => {
    const card = button.closest("[data-booking-card]");
    try {
      await api(`/api/mdt/bookings/${button.dataset.bookingStatus}`, {
        method: "PATCH",
        body: {
          status: button.dataset.status,
          holding_cell: card?.querySelector("[data-booking-cell]")?.value || "",
          bond_amount: card?.querySelector("[data-booking-bond]")?.value || 0,
          release_notes: card?.querySelector("[data-booking-note]")?.value || "",
        },
      });
      toast(`Booking marked ${button.dataset.status}`);
      if (state.mdtProfileUserId) {
        const activeSearch = state.cache.mdt?.search || [];
        const q = activeSearch.find((item) => String(item.id) === String(state.mdtProfileUserId))?.name || "";
        if (q) {
          const refreshed = await api(`/api/mdt/search?q=${encodeURIComponent(q)}`);
          state.cache.mdt.search = refreshed.results;
        }
      }
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-cid-open-case]").forEach((button) => button.addEventListener("click", () => {
    state.cidSelectedCaseId = button.dataset.cidOpenCase;
    render();
  }));
  $$("[data-cid-open-ia]").forEach((button) => button.addEventListener("click", () => {
    state.cidSelectedIaId = button.dataset.cidOpenIa;
    render();
  }));
  $$("[data-cid-note-type]").forEach((button) => button.addEventListener("click", () => {
    const form = $$(".cid-note-form").find((item) => String(item.dataset.caseId) === String(button.dataset.caseId));
    const select = form?.querySelector("[name='note_type']");
    const body = form?.querySelector("[name='body']");
    if (select) select.value = button.dataset.cidNoteType;
    body?.focus();
  }));
  $$("[data-cid-ia-note-type]").forEach((button) => button.addEventListener("click", () => {
    const form = $$(".cid-ia-note-form").find((item) => String(item.dataset.iaId) === String(button.dataset.iaId));
    const select = form?.querySelector("[name='note_type']");
    const body = form?.querySelector("[name='body']");
    if (select) select.value = button.dataset.cidIaNoteType;
    body?.focus();
  }));
  $("#cidInvestigationForm [data-cid-investigation-target]")?.addEventListener("change", (event) => {
    syncCidInvestigationTarget(event.currentTarget.closest("form"));
  });
  $("#cadReportForm [data-cad-report-civ]")?.addEventListener("change", (event) => {
    syncCadReportCiv(event.currentTarget.closest("form"));
  });
  $("#cadReportForm [data-cad-report-alert]")?.addEventListener("change", (event) => {
    syncCadReportAlert(event.currentTarget.closest("form"));
  });
  $("#cadReportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      syncCadReportCiv(event.currentTarget);
      syncCadReportAlert(event.currentTarget);
      const result = await api("/api/mdt/reports", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(`After-call report ${result.report_number} filed`);
      event.currentTarget.reset();
      state.mdtReportAlertId = "";
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#boloForm [data-bolo-target]")?.addEventListener("change", (event) => {
    syncBoloTarget(event.currentTarget.closest("form"));
  });
  $("#boloForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      syncBoloTarget(event.currentTarget);
      const result = await api("/api/mdt/bolos", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(`BOLO ${result.bolo_number} broadcast`);
      event.currentTarget.reset();
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-bolo-status]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/mdt/bolos/${button.dataset.boloStatus}`, {
        method: "PATCH",
        body: { status: button.dataset.status },
      });
      toast(`BOLO ${button.dataset.status}`);
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#mdtSearch")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q");
    try {
      const results = await api(`/api/mdt/search?q=${encodeURIComponent(q)}`);
      state.cache.mdt = state.cache.mdt || {};
      state.cache.mdt.search = results.results;
      if (results.results.length) {
        state.mdtProfileUserId = results.results[0].id;
        state.mdtProfileTab = "profile";
      }
      state.mdtNotice = results.results.length
        ? null
        : { query: q, reference: `NCIC-${Math.floor(100000 + Math.random() * 900000)}` };
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#ticketForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (state.mdtCatalogMode === "criminal") {
        if (payload.transport_confirmed !== "true") {
          toast("Confirm transport before continuing to Booking");
          return;
        }
        state.mdtSelectedCiv = payload.civ_id;
        state.mdtSelectedChargeId = payload.charge_id;
        state.mdtBookingDraft = {
          civ_id: payload.civ_id,
          charge_id: payload.charge_id,
          charge_ids: [payload.charge_id],
          arrest_location: payload.location,
          probable_cause: payload.probable_cause,
          holding_cell: payload.holding_cell,
          transport_confirmed: true,
        };
        state.mdtTab = "booking";
        state.mdtCatalogOpen = false;
        toast("Transport confirmed - complete the Booking intake");
        render();
        return;
      } else {
        const formData = new FormData(event.currentTarget);
        payload.charge_ids = formData.getAll("charge_ids");
        if (!payload.charge_ids.length) {
          toast("Select at least one citation code");
          return;
        }
        const result = await api("/api/mdt/citations", { method: "POST", body: payload });
        toast(`${result.citation_count} citation(s) issued - court ${result.court_date}`);
      }
      event.currentTarget.reset();
      state.mdtSelectedCiv = "";
      state.mdtSelectedChargeId = "";
      state.mdtCitationChargeIds = [];
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#panicForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/mdt/panic", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Panic alert sent");
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-clear-panic]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/mdt/alerts/${button.dataset.clearPanic}`, { method: "PATCH" });
      toast("Panic alert cleared");
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#cidInvestigationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      syncCidInvestigationTarget(event.currentTarget);
      const result = await api("/api/cid/investigations", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(`CID case opened ${result.case_number}`);
      state.cidSelectedCaseId = result.id;
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$(".cid-case-update").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/cid/investigations/${form.dataset.caseId}`, { method: "PATCH", body: Object.fromEntries(new FormData(form).entries()) });
      toast("CID case updated");
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".cid-note-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/cid/investigations/${form.dataset.caseId}/notes`, { method: "POST", body: Object.fromEntries(new FormData(form).entries()) });
      toast("CID note logged");
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#cidWarrantForm [data-cid-warrant-subject]")?.addEventListener("change", (event) => {
    syncCidWarrantSubject(event.currentTarget.closest("form"));
  });
  $("#cidWarrantForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      syncCidWarrantSubject(event.currentTarget);
      const result = await api("/api/cid/warrants", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(`Warrant tracked ${result.warrant_number}`);
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$("[data-open-cid-warrant]").forEach((button) => button.addEventListener("click", () => {
    state.cidWarrantModalId = button.dataset.openCidWarrant;
    render();
  }));
  $$("[data-close-cid-warrant]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.cidWarrantModalId = null;
    render();
  }));
  $$(".cid-warrant-update").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/cid/warrants/${form.dataset.warrantId}`, { method: "PATCH", body: Object.fromEntries(new FormData(form).entries()) });
      toast("Warrant updated");
      state.cidWarrantModalId = null;
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("#cidIaForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/cid/internal-affairs", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(`IA record opened ${result.ia_number}`);
      state.cidSelectedIaId = result.id;
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  $$(".cid-ia-update").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/cid/internal-affairs/${form.dataset.iaId}`, { method: "PATCH", body: Object.fromEntries(new FormData(form).entries()) });
      toast("IA record updated");
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".cid-ia-note-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/cid/internal-affairs/${form.dataset.iaId}/notes`, { method: "POST", body: Object.fromEntries(new FormData(form).entries()) });
      toast("IA file entry added");
      form.reset();
      await loadAppData("mdt");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function devUserOptions(users) {
  return (users || []).map((user) => (
    `<option value="${user.id}">${escapeHtml(user.name)} / CIV ${escapeHtml(user.civ_number || "pending")} / ${escapeHtml(user.email)}</option>`
  )).join("");
}

function renderBetaTasks() {
  const data = state.cache["beta-tasks"] || { tasks: [], reports: [] };
  return `
    <div class="stack beta-tasks-app">
      <section class="beta-hero">
        <div><p class="eyebrow">Faircroft early access</p><h3>Beta Testing Tasks</h3><p>Follow each test brief, reproduce issues carefully, and report what actually happened.</p></div>
        <span class="beta-badge">&beta;</span>
      </section>
      <div class="beta-task-list">
        ${(data.tasks || []).map((task) => `
          <article class="beta-task-card">
            <div class="row tight"><div><p class="eyebrow">${escapeHtml(task.test_area)}</p><h3>${escapeHtml(task.title)}</h3></div><span class="pill ${task.priority === "critical" ? "red" : task.priority === "high" ? "amber" : ""}">${escapeHtml(task.priority)}</span></div>
            <p>${escapeHtml(task.instructions)}</p>
            <details class="job-application-drawer">
              <summary><span>Found a problem?</span><strong>Report bug</strong></summary>
              <form class="form-grid beta-report-form" data-beta-task="${task.id}">
                <label>Short summary<input name="summary" maxlength="180" required /></label>
                <label>Severity<select name="severity"><option>low</option><option selected>standard</option><option>high</option><option>critical</option></select></label>
                <label>Steps to reproduce<textarea name="steps" minlength="10" maxlength="4000" required></textarea></label>
                <label>Expected result<textarea name="expected_result" maxlength="3000"></textarea></label>
                <label>Actual result<textarea name="actual_result" minlength="5" maxlength="3000" required></textarea></label>
                <button class="primary" type="submit">Send Bug Report</button>
              </form>
            </details>
          </article>`).join("") || `<div class="empty">No beta tasks are active right now. Check back after the next test release.</div>`}
      </div>
      <details class="jobs-history">
        <summary><span>My bug reports</span><strong>${(data.reports || []).length}</strong></summary>
        <div class="list">${(data.reports || []).map((report) => `<article class="card"><div class="row"><strong>${escapeHtml(report.summary)}</strong><span class="pill">${escapeHtml(report.status)}</span></div><p class="muted small">${escapeHtml(report.task_title || "General beta report")} · ${escapeHtml(report.created_at)}</p></article>`).join("") || `<div class="empty">No reports submitted yet</div>`}</div>
      </details>
    </div>`;
}

function bindBetaTasks() {
  $$(".beta-report-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/beta/reports", { method: "POST", body: { ...Object.fromEntries(new FormData(form).entries()), task_id: Number(form.dataset.betaTask) } });
      toast("Bug report sent to the development team");
      await loadAppData("beta-tasks");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $("[data-citation-writer-code]")?.addEventListener("change", (event) => {
    const charge = getMdtCatalog("citation").find((item) => String(item.id) === String(event.currentTarget.value));
    const values = {
      "[data-citation-review-code]": charge?.code || "Not selected",
      "[data-citation-review-title]": charge?.title || "Select a violation",
      "[data-citation-review-severity]": charge?.severity || "—",
      "[data-citation-review-fine]": charge ? money(charge.fine_amount) : "—",
      "[data-citation-review-points]": charge ? String(Number(charge.points || 0)) : "—",
    };
    Object.entries(values).forEach(([selector, value]) => {
      const target = $(selector);
      if (target) target.textContent = value;
    });
  });
  const bookingChargeSearch = $("[data-booking-charge-search]");
  if (bookingChargeSearch) {
    const updateBookingChargePicker = () => {
      const query = bookingChargeSearch.value.trim().toLowerCase();
      $$("[data-booking-charge-option]").forEach((option) => {
        option.hidden = Boolean(query) && !String(option.dataset.bookingChargeText || "").includes(query);
      });
      const count = $("[data-booking-charge-count]");
      if (count) count.textContent = String($$('input[name="charge_ids"]:checked').length);
    };
    bookingChargeSearch.addEventListener("input", updateBookingChargePicker);
    $$('input[name="charge_ids"]').forEach((input) => input.addEventListener("change", updateBookingChargePicker));
  }
  $$("[data-citation-category]").forEach((button) => button.addEventListener("click", () => {
    state.mdtCitationCategory = button.dataset.citationCategory;
    render();
  }));
  const citationSearch = $("[data-citation-code-search]");
  if (citationSearch) {
    citationSearch.addEventListener("input", () => {
      const query = citationSearch.value.trim().toLowerCase();
      const cards = $$("[data-citation-code-card]");
      let visible = 0;
      cards.forEach((card) => {
        const match = !query || String(card.dataset.citationSearch || "").includes(query);
        card.hidden = !match;
        if (match) visible += 1;
      });
      const count = $("[data-citation-visible-count]");
      const empty = $("[data-citation-search-empty]");
      if (count) count.textContent = String(visible);
      if (empty) empty.hidden = visible !== 0;
    });
    if (!document.documentElement.dataset.citationShortcutBound) {
      document.documentElement.dataset.citationShortcutBound = "true";
      document.addEventListener("keydown", (event) => {
        if (event.key !== "/" || /input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
        const currentSearch = $("[data-citation-code-search]");
        if (!currentSearch) return;
        event.preventDefault();
        currentSearch.focus();
      });
    }
  }
}

function renderDevToolsLegacy() {
  const data = state.cache["dev-tools"] || {};
  const users = data.users || [];
  const sanctions = data.sanctions || [];
  const warnings = data.warnings || [];
  const logs = data.audit_logs || [];
  const codes = data.unlink_codes || [];
  return `
    <div class="stack dev-tools-app">
      <section class="profile-hero dev-tools-hero">
        <div><p class="eyebrow">Restricted engineering console</p><h3>Developer Tools</h3><p>Account linking support, moderation controls, internal warnings, and immutable staff activity.</p></div>
        <span class="pill amber">DEV</span>
      </section>
      <div class="profile-grid">
        <div><span>Accounts</span><strong>${users.length}</strong></div>
        <div><span>Active sanctions</span><strong>${Number(data.active_sanctions || 0)}</strong></div>
        <div><span>Open warnings</span><strong>${warnings.filter((item) => !item.resolved_at).length}</strong></div>
        <div><span>Audit events</span><strong>${logs.length}</strong></div>
      </div>

      <section class="profile-link-card">
        <div class="row"><div><p class="eyebrow">Secure account unlink</p><h3>One-time Developer Code</h3><p class="muted small">Codes are shown once, stored as hashes, and expire automatically.</p></div><span class="pill red">restricted</span></div>
        <form id="devCodeForm" class="form-grid">
          <label>Expires in minutes<input name="expiry_minutes" type="number" min="5" max="1440" value="30" required /></label>
          <button class="primary" type="submit">Generate One-Time Code</button>
        </form>
        ${state.generatedDevCode ? `<div class="referral-code-box dev-generated-code"><span>Give this code directly to the guided user</span><strong>${escapeHtml(state.generatedDevCode.code)}</strong><small>Expires ${escapeHtml(state.generatedDevCode.expires_at)}</small></div>` : ""}
        <div class="list">${codes.slice(0, 8).map((item) => `<div class="row"><span>••••-${escapeHtml(item.code_hint)} / ${escapeHtml(item.created_by_name)}</span><strong>${item.uses_remaining ? "available" : "used"}</strong></div>`).join("") || `<div class="empty">No developer codes generated</div>`}</div>
      </section>

      <section class="profile-link-card">
        <div class="row"><div><p class="eyebrow">Account enforcement</p><h3>Create Sanction</h3></div><span class="pill red">staff action</span></div>
        <form id="devSanctionForm" class="form-grid">
          <label>Account<select name="user_id" required><option value="">Select account</option>${devUserOptions(users)}</select></label>
          <label>Action<select name="sanction_type" required><option value="timeout">Timeout</option><option value="ban">Ban</option><option value="sanction">Recorded sanction</option></select></label>
          <label>Duration minutes<input name="duration_minutes" type="number" min="1" max="525600" value="60" /></label>
          <label>Public reason<textarea name="reason" maxlength="1200" required></textarea></label>
          <label>Internal notes<textarea name="internal_notes" maxlength="2000"></textarea></label>
          <button class="danger" type="submit">Apply Enforcement Action</button>
        </form>
        <div class="list dev-record-list">${sanctions.slice(0, 30).map((item) => `
          <article class="card">
            <div class="row"><strong>${escapeHtml(item.target_name)} / ${escapeHtml(item.sanction_type)}</strong><span class="pill ${item.revoked_at ? "" : "red"}">${item.revoked_at ? "revoked" : "active"}</span></div>
            <p>${escapeHtml(item.reason)}</p>
            <p class="muted small">By ${escapeHtml(item.created_by_name)} · ${escapeHtml(item.created_at)}${item.expires_at ? ` · expires ${escapeHtml(item.expires_at)}` : ""}</p>
            ${item.revoked_at ? "" : `<button class="secondary" type="button" data-revoke-sanction="${item.id}">Revoke / Unban</button>`}
          </article>
        `).join("") || `<div class="empty">No sanctions recorded</div>`}</div>
      </section>

      <section class="profile-link-card">
        <div class="row"><div><p class="eyebrow">Staff-only case notes</p><h3>Internal Warning</h3></div><span class="pill amber">not player-visible</span></div>
        <form id="devWarningForm" class="form-grid">
          <label>Account<select name="user_id" required><option value="">Select account</option>${devUserOptions(users)}</select></label>
          <label>Severity<select name="severity"><option>low</option><option selected>standard</option><option>high</option><option>critical</option></select></label>
          <label>Subject<input name="subject" maxlength="160" required /></label>
          <label>Internal warning<textarea name="body" maxlength="3000" required></textarea></label>
          <button class="secondary" type="submit">Record Internal Warning</button>
        </form>
        <div class="list dev-record-list">${warnings.slice(0, 30).map((item) => `
          <article class="card">
            <div class="row"><strong>${escapeHtml(item.target_name)} / ${escapeHtml(item.subject)}</strong><span class="pill ${item.severity === "critical" ? "red" : "amber"}">${escapeHtml(item.severity)}</span></div>
            <p>${escapeHtml(item.body)}</p>
            <p class="muted small">By ${escapeHtml(item.created_by_name)} · ${escapeHtml(item.created_at)}</p>
            ${item.resolved_at ? `<span class="pill green">resolved</span>` : `<button class="secondary" type="button" data-resolve-warning="${item.id}">Resolve Warning</button>`}
          </article>
        `).join("") || `<div class="empty">No internal warnings</div>`}</div>
      </section>

      <section class="profile-link-card">
        <div class="row"><div><p class="eyebrow">Administrative accountability</p><h3>Audit Log</h3></div><span class="pill green">${logs.length} events</span></div>
        <div class="list dev-audit-list">${logs.map((item) => `
          <div class="card"><div class="row"><strong>${escapeHtml(item.action)}</strong><span>${escapeHtml(item.actor_name)}</span></div><p class="muted small">${escapeHtml(item.target_name || "System")} · ${escapeHtml(item.created_at)}</p><code>${escapeHtml(item.details || "{}")}</code></div>
        `).join("") || `<div class="empty">No audited actions yet</div>`}</div>
      </section>
    </div>
  `;
}

const FAIRCRAFT_RULES = [
  ["1.1", "Respect", "Harassment, discrimination, hate speech, excessive toxicity, and real-life threats are prohibited."],
  ["1.2", "Staff Authority", "Respect staff decisions; use the designated support system for appeals instead of arguing publicly."],
  ["1.3", "Exploiting", "Do not use bugs, glitches, or unintended mechanics for an advantage; report discovered exploits."],
  ["1.4", "Cheating", "Hacks, cheats, macros, scripts, and unfair third-party software are forbidden."],
  ["2.1", "Stay In Character", "Remain in character, use OOC only when necessary, and avoid breaking immersion."],
  ["2.2", "FearRP", "Value your character's life and respond realistically to overwhelming force."],
  ["2.3", "Metagaming", "Do not use information learned outside roleplay, including streams or Discord, in character."],
  ["2.5", "Random Deathmatch (RDM)", "Do not kill or attack players without a valid roleplay reason."],
  ["2.6", "Vehicle Deathmatch (VDM)", "Do not use a vehicle as a weapon without a valid roleplay reason."],
  ["2.7", "New Life Rule (NLR)", "Forget events leading to death and do not return to the scene for 15 minutes unless roleplay justifies it."],
  ["2.8", "Combat Logging", "Do not disconnect to avoid roleplay, arrest, injury, or consequences."],
  ["3.1", "Character Names", "Use realistic names; troll and celebrity names are not allowed."],
  ["3.2", "Character Development", "Maintain a consistent character and complete two interactions before a shootout."],
  ["3.3", "Character Knowledge", "Use only information your character learned through roleplay."],
  ["4.1", "Robberies", "Robberies require roleplay interaction; instant robbery demands are prohibited."],
  ["4.2", "Hostage Situations", "Use real players when possible, treat hostages realistically, and avoid unjustified excessive harm."],
  ["4.3", "Gang Activity", "Gang wars require roleplay buildup; constant kill-on-sight behavior is prohibited."],
  ["4.4", "Kidnapping", "Kidnapping requires a valid roleplay reason and victims cannot be held indefinitely."],
  ["4.5", "After Killing a Cop", "Only the pistol and rifle may be taken; uniform theft and police impersonation are prohibited."],
  ["4.6", "Lockers and Arsenals", "Do not take items from arsenals, boxes, or lockers without admin permission or faction authorization."],
];

function devRuleOptions() {
  return FAIRCRAFT_RULES.map(([code, title, description]) =>
    `<option value="${code}" data-title="${escapeHtml(title)}" data-description="${escapeHtml(description)}">${code} — ${escapeHtml(title)}</option>`
  ).join("");
}

function renderDevWorkspace() {
  const activeTab = {
    dashboard: ["Operations Overview", "Current account-linking and enforcement status"],
    enforcement: ["Enforcement Cases", "File, review, and revoke player sanctions"],
    warnings: ["Internal Notes", "Staff-only account history and observations"],
    linking: ["Account Linking", "Linked identities, recent claims, and unlink authorization"],
    anticheat: ["Anti-Cheat Intelligence", "Live presence, detection history, and linked identity analysis"],
    audit: ["Activity Log", "Chronological record of staff actions"],
    settings: ["App Visibility", "Control which application icons appear for users"],
  }[state.devTab] || ["Staff Operations", "Faircroft administrative console"];
  return `<section class="dev-workspace">
    <aside class="dev-sidebar">
      <div class="dev-brand"><img class="dev-emblem" src="/static/brand/faircroft-emblem.webp" alt="" /><div><strong>Faircroft RP</strong><small>Staff Operations</small></div></div>
      <p class="dev-nav-label">Operations index</p>
      <nav>${[["dashboard","Overview"],["anticheat","Anti-Cheat"],["enforcement","Cases"],["warnings","Internal Notes"],["linking","Account Linking"],["audit","Activity Log"],["settings","Settings"]].map(([id,label], index) => `<button class="${state.devTab === id ? "active" : ""}" data-dev-tab="${id}"><small>${String(index + 1).padStart(2, "0")}</small><span>${label}</span><i></i></button>`).join("")}</nav>
      <div class="dev-sidebar-footer"><span class="dev-access-dot"></span><div><strong>Authorized Staff</strong><small>${escapeHtml(state.session?.user?.name || "Staff member")}</small></div></div>
    </aside>
    <main class="dev-main">
      <header class="dev-topbar"><div><span class="dev-topbar-kicker">FC / STAFF OPERATIONS</span><h1>${activeTab[0]}</h1><p>${activeTab[1]}</p></div><div class="dev-toolbar"><span class="dev-system-status"><i></i>Systems nominal</span><button class="secondary" data-refresh-dev>Sync records</button><button class="primary" data-close-dev>Exit workspace</button></div></header>
      <div class="dev-content">${renderDevTools()}</div>
    </main>
    ${state.devAccount ? renderDevAccountModal(state.devAccount) : ""}
    ${state.devAntiCheatUid ? renderAntiCheatModal(state.cache["dev-tools"]?.anti_cheat || {}, state.devAntiCheatUid) : ""}
  </section>`;
}

function devMetrics(data, warnings) {
  return `<div class="dev-metrics">
    <div class="dev-metric red-tone"><span>Active bans</span><strong>${Number(data.active_bans || 0)}</strong><small>Currently blocked</small></div>
    <div class="dev-metric amber-tone"><span>Timeouts</span><strong>${Number(data.active_timeouts || 0)}</strong><small>Currently active</small></div>
    <div class="dev-metric green-tone"><span>Linked</span><strong>${Number(data.linked_accounts || 0)}</strong><small>Arma identities</small></div>
    <div class="dev-metric blue-tone"><span>Unlinked</span><strong>${Number(data.unlinked_accounts || 0)}</strong><small>No Arma identity</small></div>
    <div class="dev-metric"><span>Verified</span><strong>${Number(data.verified_accounts || 0)}</strong><small>Website accounts</small></div>
    <div class="dev-metric"><span>Needs linking</span><strong>${Number(data.verified_unlinked || 0)}</strong><small>Verified accounts</small></div>
  </div>`;
}

function devSanctionRow(item) {
  const isGameBan = item.sanction_type === "ban" || item.sanction_type === "timeout";
  return `<article class="dev-case dev-case-record">
    <span class="dev-record-rail ${item.revoked_at ? "closed" : "active"}"></span>
    <div class="dev-case-reference"><small>${escapeHtml(item.report_number || "LEGACY")}</small><strong>${escapeHtml(item.target_name)}</strong></div>
    <div class="dev-case-summary"><strong>${escapeHtml(item.rule_code || "Unclassified")}</strong><p>${escapeHtml(item.reason)}</p></div>
    <div class="dev-case-provenance"><span>${escapeHtml(item.created_by_name)}</span><small>${escapeHtml(item.created_at)}${item.expires_at ? ` · expires ${escapeHtml(item.expires_at)}` : ""}</small></div>
    <span class="dev-record-status ${item.revoked_at ? "closed" : "alert"}">${item.revoked_at ? "Revoked" : escapeHtml(item.sanction_type)}</span>
    ${item.revoked_at ? "" : `<button class="${isGameBan ? "danger" : "secondary"}" type="button" data-revoke-sanction="${item.id}" data-game-unban="${isGameBan ? "true" : "false"}">${isGameBan ? "Unban" : "Revoke"}</button>`}
  </article>`;
}

function devAudit(logs) {
  return `<div class="dev-audit-list dev-activity-ledger">${logs.map((item, index) => `<article class="dev-audit-event">
    <div class="dev-audit-sequence"><span>${String(index + 1).padStart(2, "0")}</span><i></i></div>
    <div class="dev-audit-primary"><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.target_name || "System record")}</small></div>
    <div class="dev-audit-actor"><span>Performed by</span><strong>${escapeHtml(item.actor_name || "Deleted account")}</strong></div>
    <time>${escapeHtml(item.created_at)}</time>
    <details><summary>Inspect event</summary><code>${escapeHtml(item.details || "{}")}</code></details>
  </article>`).join("") || `<div class="empty">No audited actions yet</div>`}</div>`;
}

function renderDevTools() {
  const data = state.cache["dev-tools"] || {};
  const users = data.users || [], sanctions = data.sanctions || [], warnings = data.warnings || [], logs = data.audit_logs || [], codes = data.unlink_codes || [];
  const metrics = devMetrics(data, warnings);
  if (state.devTab === "anticheat") return renderDevAntiCheat(data.anti_cheat || {});
  if (state.devTab === "dashboard") return `<div class="stack dev-overview">${metrics}<div class="dev-section-heading"><div><h2>Work queue</h2><p>Items requiring staff attention and recent review.</p></div></div><div class="dev-overview-queue"><section class="dev-card dev-queue-card enforcement"><div class="dev-card-header"><div><span>ENFORCEMENT</span><h2>Active cases</h2></div><button class="secondary" data-dev-go="enforcement">View cases</button></div>${sanctions.filter((x) => !x.revoked_at).slice(0,8).map(devSanctionRow).join("") || `<div class="dev-queue-clear"><i></i><div><strong>Queue clear</strong><span>No active enforcement cases require review.</span></div></div>`}</section><section class="dev-card dev-queue-card identity"><div class="dev-card-header"><div><span>IDENTITY</span><h2>Recent Arma links</h2></div><button class="secondary" data-dev-go="linking">View accounts</button></div>${devRecentLinks(data.recent_links || [])}</section></div><section class="dev-card dev-activity-panel"><div class="dev-card-header"><div><span>STAFF RECORD</span><h2>Latest activity</h2></div><button class="secondary" data-dev-go="audit">View complete log</button></div>${devAudit(logs.slice(0,10))}</section></div>`;
  if (state.devTab === "enforcement") return `<div class="dev-ops-view dev-cases-view"><div class="dev-view-intro"><div><span>ENFORCEMENT CONTROL</span><h2>Case administration</h2><p>Document an incident, apply a proportionate action, and preserve the complete decision record.</p></div><strong>${sanctions.filter((x) => !x.revoked_at).length} ACTIVE</strong></div><div class="dev-grid-enforcement"><section class="dev-card dev-editor-panel"><div class="row"><div><p class="eyebrow">Required incident documentation</p><h2>Open enforcement report</h2><p class="muted">A ban or timeout cannot be issued until this report is complete.</p></div><span class="pill red">required</span></div>
    <form id="devSanctionForm" class="dev-report-form">
      <label>Account<select name="user_id" required><option value="">Select account</option>${devUserOptions(users)}</select></label>
      <label>Action<select name="sanction_type" required><option value="timeout">Timeout</option><option value="ban">Ban</option><option value="sanction">Recorded sanction</option></select></label>
      <label>Duration (minutes)<input name="duration_minutes" type="number" min="1" max="525600" value="60" /></label>
      <label>Bail amount<input name="bail_amount" type="number" min="0" max="10000000" step="0.01" value="0" /></label>
      <label>Rule violated<select name="rule_code" id="devRuleSelect" required><option value="">Select rule</option>${devRuleOptions()}</select></label>
      <label class="wide">Public reason<textarea name="reason" id="devPublicReason" maxlength="1200" required></textarea></label>
      <label>Incident date/time<input name="incident_at" type="datetime-local" required /></label>
      <label>Witnesses / staff<input name="witness_names" maxlength="1200" placeholder="Names, callsigns, or none" /></label>
      <label class="wide">Detailed incident narrative<textarea name="incident_summary" minlength="40" maxlength="5000" required placeholder="Sequence of events, location, player actions, staff response, and context."></textarea></label>
      <label class="wide">Evidence and log references<textarea name="evidence" minlength="10" maxlength="5000" required placeholder="Video, screenshots, server timestamps, witnesses, case IDs."></textarea></label>
      <label class="wide">Staff findings and proportionality<textarea name="staff_findings" minlength="30" maxlength="5000" required placeholder="What was substantiated and why this action is proportionate."></textarea></label>
      <label>Player statement<textarea name="player_statement" maxlength="3000" placeholder="Response, admission, denial, or not available."></textarea></label>
      <label>Appeal guidance<textarea name="appeal_guidance" maxlength="2000" required>Appeal through the designated Faircroft support system. Include the report number and counter-evidence.</textarea></label>
      <label class="wide">Confidential staff notes<textarea name="internal_notes" maxlength="2000"></textarea></label>
      <label class="dev-certify wide"><input type="checkbox" required /> I certify this report is accurate, evidence-based, and complete.</label>
      <button class="danger wide" type="submit">Submit Report and Apply Action</button>
    </form></section><section class="dev-card dev-record-panel"><div class="dev-card-header"><div><span>CASE LEDGER</span><h2>Enforcement records</h2></div><strong>${sanctions.length}</strong></div><div class="dev-record-list">${sanctions.map(devSanctionRow).join("") || `<div class="empty">No reports</div>`}</div></section></div></div>`;
  if (state.devTab === "warnings") return `<div class="dev-ops-view dev-notes-view"><div class="dev-view-intro"><div><span>INTERNAL INTELLIGENCE</span><h2>Staff observation ledger</h2><p>Restricted operational context. Notes are never shown on the player-facing account.</p></div><strong>${warnings.filter((x) => !x.resolved_at).length} OPEN</strong></div><div class="dev-grid-2"><section class="dev-card dev-editor-panel"><div class="row"><div><p class="eyebrow">New observation</p><h2>Record internal note</h2></div><span class="pill amber">staff only</span></div><form id="devWarningForm" class="form-grid"><label>Account<select name="user_id" required><option value="">Select account</option>${devUserOptions(users)}</select></label><label>Severity<select name="severity"><option>low</option><option selected>standard</option><option>high</option><option>critical</option></select></label><label>Subject<input name="subject" maxlength="160" required /></label><label>Internal note<textarea name="body" maxlength="3000" required></textarea></label><button class="primary">Commit note</button></form></section><section class="dev-card dev-record-panel"><div class="dev-card-header"><div><span>HISTORICAL RECORD</span><h2>Note history</h2></div><strong>${warnings.length}</strong></div><div class="dev-record-list">${warnings.map((x) => `<article class="dev-note-record"><span class="dev-note-severity ${escapeHtml(x.severity || "standard")}"></span><div><small>${escapeHtml(x.target_name)} · ${escapeHtml(x.severity || "standard")}</small><strong>${escapeHtml(x.subject)}</strong><p>${escapeHtml(x.body)}</p><time>${escapeHtml(x.created_by_name)} · ${escapeHtml(x.created_at)}</time></div>${x.resolved_at ? `<span class="dev-record-status closed">Resolved</span>` : `<button class="secondary" data-resolve-warning="${x.id}">Resolve</button>`}</article>`).join("") || `<div class="empty">No internal notes</div>`}</div></section></div></div>`;
  if (state.devTab === "linking") return `<div class="stack dev-ops-view dev-linking-view"><div class="dev-view-intro"><div><span>IDENTITY CONTROL</span><h2>Account-link registry</h2><p>Review verified identity claims and issue tightly scoped unlink authorization.</p></div><strong>${users.filter((x) => x.arma_linked).length} LINKED</strong></div>${metrics}<div class="dev-grid-2"><section class="dev-card dev-access-panel"><p class="eyebrow">Secure unlink authorization</p><h2>One-time developer code</h2><p class="muted">Single-purpose credentials for supervised identity maintenance.</p><form id="devCodeForm" class="form-grid"><label>Validity window<input name="expiry_minutes" type="number" min="5" max="1440" value="30" required /><small>Minutes until automatic expiration</small></label><button class="primary">Generate authorization</button></form>${state.generatedDevCode ? `<div class="dev-generated-code"><span>Shown once</span><strong>${escapeHtml(state.generatedDevCode.code)}</strong><small>Expires ${escapeHtml(state.generatedDevCode.expires_at)}</small></div>` : ""}<div class="dev-code-ledger">${codes.slice(0,12).map((x) => `<div><code>••••-${escapeHtml(x.code_hint)}</code><span>${escapeHtml(x.created_by_name)}</span><strong class="${x.uses_remaining ? "available" : ""}">${x.uses_remaining ? "Available" : "Consumed"}</strong></div>`).join("") || `<div class="empty">No authorization codes issued</div>`}</div></section><section class="dev-card dev-record-panel"><div class="dev-card-header"><div><span>RECENT CLAIMS</span><h2>Identity activity</h2></div></div>${devRecentLinks(data.recent_links || [])}</section></div><section class="dev-card dev-linked-registry"><div class="dev-card-header"><div><span>VERIFIED DIRECTORY</span><h2>Linked accounts</h2></div><strong>${users.filter((x) => x.arma_linked).length}</strong></div>${devLinkedAccounts(users)}</section></div>`;
  if (state.devTab === "settings") {
    const visibilityApps = data.app_visibility?.apps || [];
    const beta = data.beta_program || { recruiting_enabled: false, recruiting_message: "", members: 0, member_roster: [], tasks: [], reports: [] };
    return `<div class="stack">
      <section class="dev-card beta-dev-console">
        <div class="dev-card-header"><div><p class="eyebrow">Release planning</p><h2>Beta Program</h2><p class="muted">Recruit testers, publish test assignments, and review incoming bug reports.</p></div><span class="pill ${beta.recruiting_enabled ? "green" : "amber"}">${beta.recruiting_enabled ? "seeking testers" : "recruitment off"}</span></div>
        <div class="dev-metrics beta-dev-metrics">
          <div class="dev-metric"><span>Beta members</span><strong>${Number(beta.members || 0)}</strong><small>Opted-in testers</small></div>
          <div class="dev-metric"><span>Active tasks</span><strong>${(beta.tasks || []).filter((task) => task.active).length}</strong><small>Published briefs</small></div>
          <div class="dev-metric"><span>Bug reports</span><strong>${(beta.reports || []).length}</strong><small>Submitted findings</small></div>
        </div>
        <form id="devBetaProgramForm" class="form-grid">
          <label class="check-row"><input type="checkbox" name="enabled" ${beta.recruiting_enabled ? "checked" : ""} /> Seek new beta testers on login</label>
          <label>Invitation message<textarea name="message" minlength="20" maxlength="600" required>${escapeHtml(beta.recruiting_message || "")}</textarea></label>
          <button class="primary" type="submit">Save Beta Recruitment</button>
        </form>
      </section>
      <div class="dev-grid-2">
        <section class="dev-card">
          <div><p class="eyebrow">New assignment</p><h2>Publish Beta Task</h2></div>
          <form id="devBetaTaskForm" class="form-grid">
            <label>Task title<input name="title" minlength="3" maxlength="140" required /></label>
            <label>Test area<input name="test_area" maxlength="80" placeholder="Banking, MDT, mobile UI..." /></label>
            <label>Priority<select name="priority"><option>low</option><option selected>standard</option><option>high</option><option>critical</option></select></label>
            <label>Testing instructions<textarea name="instructions" minlength="10" maxlength="5000" required></textarea></label>
            <button class="primary" type="submit">Publish Task</button>
          </form>
        </section>
        <section class="dev-card"><div class="row"><h2>Published Tasks</h2><span class="pill">${(beta.tasks || []).length}</span></div>
          <div class="dev-record-list">${(beta.tasks || []).map((task) => `<article class="dev-case"><div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.test_area)} · ${escapeHtml(task.priority)}</p></div><button class="secondary" type="button" data-beta-task-toggle="${task.id}" data-active="${task.active ? "false" : "true"}">${task.active ? "Close" : "Reopen"}</button></article>`).join("") || `<div class="empty">No beta tasks published</div>`}</div>
        </section>
      </div>
      <section class="dev-card beta-team-roster">
        <div class="dev-card-header">
          <div><p class="eyebrow">Current membership</p><h2>Beta Testing Team</h2><p class="muted">Everyone currently holding the Beta Tester role.</p></div>
          <span class="pill green">${(beta.member_roster || []).length} testers</span>
        </div>
        <div class="beta-roster-list">
          ${(beta.member_roster || []).map((member) => `
            <article class="beta-roster-member">
              <div class="beta-roster-avatar">${escapeHtml((member.name || "B").slice(0, 1).toUpperCase())}</div>
              <div class="beta-roster-identity">
                <strong>${escapeHtml(member.name || "Beta Tester")}</strong>
                <small>CIV ${escapeHtml(member.civ_number || "pending")} · ${escapeHtml(member.email || "")}</small>
              </div>
              <div class="beta-roster-status">
                <span class="pill ${member.verified ? "green" : "amber"}">${member.verified ? "verified" : "unverified"}</span>
                <span class="pill ${member.arma_linked ? "green" : ""}">${member.arma_linked ? "Arma linked" : "not linked"}</span>
              </div>
              <small class="beta-roster-joined">Joined ${member.beta_joined_at ? new Date(member.beta_joined_at).toLocaleString() : "before campaign tracking"}</small>
            </article>`).join("") || `<div class="empty">No users have joined the Beta Testing Team yet.</div>`}
        </div>
      </section>
      <section class="dev-card"><div class="row"><div><p class="eyebrow">Tester findings</p><h2>Beta Bug Reports</h2></div><span class="pill red">${(beta.reports || []).length}</span></div>
        <div class="dev-record-list">${(beta.reports || []).map((report) => `<article class="dev-case"><div><strong>${escapeHtml(report.summary)}</strong><p>${escapeHtml(report.reporter_name)} · ${escapeHtml(report.task_title || "General")} · ${escapeHtml(report.severity)}</p><small>${escapeHtml(report.actual_result)}</small></div><span class="pill">${escapeHtml(report.status)}</span></article>`).join("") || `<div class="empty">No beta bug reports</div>`}</div>
      </section>
      <section class="dev-card dev-visibility-intro">
        <div><p class="eyebrow">Global user interface controls</p><h2>Application Icon Visibility</h2><p class="muted">Checked applications appear for users who have permission. Unchecked applications vanish from every user home screen.</p></div>
        <span class="pill amber">global setting</span>
      </section>
      <form id="devAppVisibilityForm" class="dev-card">
        <div class="dev-visibility-grid">
          ${visibilityApps.map((item) => `
            <label class="dev-visibility-toggle">
              <span><strong>${escapeHtml(item.label)}</strong><small>${item.enabled ? "Visible to eligible users" : "Hidden from all users"}</small></span>
              <input type="checkbox" name="${escapeHtml(item.id)}" ${item.enabled ? "checked" : ""} />
              <i aria-hidden="true"></i>
            </label>`).join("") || `<div class="empty">No configurable applications found.</div>`}
        </div>
        <div class="dev-visibility-footer">
          <p><strong>Protected:</strong> Profile, Dev Tools, System Settings, and Restriction access cannot be hidden.</p>
          <button class="primary" type="submit">Save icon visibility</button>
        </div>
      </form>
    </div>`;
  }
  return `<div class="dev-ops-view dev-audit-view"><div class="dev-view-intro"><div><span>IMMUTABLE STAFF RECORD</span><h2>Administrative activity</h2><p>Chronological accountability across enforcement, identity, moderation, and system controls.</p></div><strong>${logs.length} EVENTS</strong></div><section class="dev-card dev-audit-panel"><div class="dev-card-header"><div><span>EVENT STREAM</span><h2>Activity ledger</h2></div><span class="dev-live-indicator"><i></i>Current</span></div>${devAudit(logs)}</section></div>`;
}

function devRecentLinks(links) {
  return `<div class="dev-link-ledger">
    <div class="dev-link-ledger-head"><span>Identity</span><span>Bohemia link</span><span>Linked</span></div>
    ${links.slice(0, 12).map((x) => {
      const name = x.account_name || x.player_name || "Unknown";
      const linkedDate = x.linked_at ? new Date(x.linked_at) : null;
      const validDate = linkedDate && !Number.isNaN(linkedDate.getTime());
      return `<button class="dev-link-entry" type="button" data-dev-account="${x.account_id}">
        <span class="dev-link-avatar">${escapeHtml(name.slice(0, 2).toUpperCase())}</span>
        <span class="dev-link-person"><strong>${escapeHtml(name)}</strong><small>CIV ${escapeHtml(x.civ_number || "pending")}</small></span>
        <span class="dev-link-identity"><strong>${escapeHtml(x.arma_id || "No identity ID")}</strong><small>Verified account match</small></span>
        <time datetime="${escapeHtml(x.linked_at || "")}"><strong>${validDate ? linkedDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "Date unavailable"}</strong><small>${validDate ? linkedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</small></time>
        <i aria-hidden="true">›</i>
      </button>`;
    }).join("") || `<div class="dev-queue-clear"><i></i><div><strong>No completed links</strong><span>New identity claims will appear here.</span></div></div>`}
  </div>`;
}

function renderDevAntiCheat(data) {
  const metrics = data.metrics || {};
  const query = state.devAntiCheatSearch.trim().toLowerCase();
  const players = (data.players || []).filter((player) =>
    !query || [player.player_name, player.uid, player.account_name, player.civ_number]
      .some((value) => String(value || "").toLowerCase().includes(query))
  );
  const sync = data.sync_status || [];
  return `<div class="stack anticheat-console dev-ops-view">
    <section class="anticheat-command">
      <div><span class="anticheat-command-mark">TB</span><div><p class="eyebrow">Thunder Buddies Security Network</p><h2>Live player intelligence</h2><p>Anti-cheat telemetry correlated against verified Faircroft identities.</p></div></div>
      <div class="anticheat-sync">${sync.map((item) => `<span class="pill ${item.status === "synced" ? "green" : "amber"}">${escapeHtml(item.source_key)} · ${Number(item.records || 0)} · ${escapeHtml(item.status)}</span>`).join("") || `<span class="pill amber">awaiting first SFTP sync</span>`}</div>
    </section>
    <div class="dev-metrics">
      <div class="dev-metric green-tone"><span>Live now</span><strong>${Number(metrics.online || 0)}</strong><small>Heartbeat active</small></div>
      <div class="dev-metric"><span>Known players</span><strong>${Number(metrics.players || 0)}</strong><small>Anti-cheat records</small></div>
      <div class="dev-metric red-tone"><span>Flagged</span><strong>${Number(metrics.flagged || 0)}</strong><small>Aim or movement</small></div>
      <div class="dev-metric amber-tone"><span>Alt groups</span><strong>${Number(metrics.alt_groups || 0)}</strong><small>Known associations</small></div>
      <div class="dev-metric blue-tone"><span>Events</span><strong>${Number(metrics.events || 0)}</strong><small>Recent evidence</small></div>
    </div>
    <section class="dev-card anticheat-directory">
      <div class="anticheat-directory-head"><div><p class="eyebrow">IDENTITY DIRECTORY</p><h2>Players & telemetry</h2><p class="muted">${players.length} matching records</p></div><label class="dev-command-search"><span>Search records</span><input id="antiCheatSearch" type="search" value="${escapeHtml(state.devAntiCheatSearch)}" placeholder="Name, UID, account, or CIV…" /></label></div>
      <div class="anticheat-player-head"><span></span><span>Player identity</span><span>Faircroft account</span><span>Telemetry</span><span>Operational status</span></div>
      <div class="anticheat-player-list">${players.map((player) => {
        const flags = Number(player.teleport_flags || 0) + Number(player.aim_flags || 0);
        const platform = devPlatformIdentity(player.reported_system, player.detected_system);
        return `<button class="anticheat-player-row" data-anticheat-player="${escapeHtml(player.uid)}">
          <span class="anticheat-presence ${player.online ? "online" : ""}"></span>
          <div class="anticheat-player-id"><strong>${escapeHtml(player.player_name || "Unknown player")}</strong><small>${escapeHtml(player.uid)}</small></div>
          <div><span>${player.linked_user_id ? escapeHtml(player.account_name || "Linked account") : "No CAD link"}</span><small>${player.civ_number ? `CIV ${escapeHtml(player.civ_number)}` : "Bohemia UID unmatched"}</small></div>
          <div><span>${Number(player.ticket_count || 0)} tickets</span><small>${flags} detection flags</small></div>
          <div><span class="dev-record-status ${player.online ? "verified" : "closed"}">${player.online ? "Live" : "Offline"}</span><span class="dev-platform-mini">${escapeHtml(platform.mark)} · ${escapeHtml(platform.label)}</span>${Number(player.alt_group_count || 0) ? `<span class="dev-record-status alert">${Number(player.alt_group_count)} alt group</span>` : ""}<i>›</i></div>
        </button>`;
      }).join("") || `<div class="empty">No anti-cheat players match this search.</div>`}</div>
    </section>
  </div>`;
}

function renderAntiCheatModal(data, uid) {
  const player = (data.players || []).find((item) => item.uid === uid);
  if (!player) return "";
  const events = (data.events || []).filter((item) => item.player_uid === uid);
  const memberships = (data.alt_members || []).filter((item) => item.uid === uid);
  const groups = memberships.map((member) => {
    const group = (data.alt_groups || []).find((item) => item.group_key === member.group_key) || {};
    const members = (data.alt_members || []).filter((item) => item.group_key === member.group_key);
    return { ...group, members };
  });
  return `<div class="dev-profile-backdrop" data-close-anticheat>
    <section class="dev-profile-modal anticheat-profile" role="dialog" aria-modal="true">
      <header class="dev-profile-header"><div><p class="eyebrow">Anti-Cheat Intelligence File</p><h2>${escapeHtml(player.player_name || "Unknown player")}</h2><p>${escapeHtml(player.uid)}</p></div><div class="row">${player.linked_user_id ? `<button class="danger" data-dev-enforce="${player.linked_user_id}">Ban / Timeout</button>` : ""}<button class="secondary" data-close-anticheat>Close</button></div></header>
      <div class="dev-profile-scroll">
        <div class="dev-profile-summary">
          <div><span>Presence</span><strong>${player.online ? "Online now" : "Offline"}</strong></div>
          <div><span>Reported system</span><strong>${escapeHtml(player.detected_system || "Unknown")}</strong></div>
          <div><span>CAD account</span><strong>${escapeHtml(player.account_name || "Not linked")}</strong></div>
          <div><span>CIV number</span><strong>${escapeHtml(player.civ_number || "Not matched")}</strong></div>
          <div><span>Tickets</span><strong>${Number(player.ticket_count || 0)}</strong></div>
          <div><span>Teleport flags</span><strong>${Number(player.teleport_flags || 0)}</strong></div>
          <div><span>Aim flags</span><strong>${Number(player.aim_flags || 0)}</strong></div>
          <div><span>Last heartbeat</span><strong>${escapeHtml(player.last_heartbeat_at || "Not observed")}</strong></div>
          <div><span>Last database sync</span><strong>${escapeHtml(player.last_synced_at || "")}</strong></div>
        </div>
        <div class="dev-profile-grid">
          <section class="dev-card"><div class="row"><h3>Detection evidence</h3><span class="pill red">${events.length}</span></div>${devDetailList(events, (event) => [event.event_type || "event", `${event.details || "No details"} · ${event.event_time || ""}`])}</section>
          <section class="dev-card"><div class="row"><h3>Known alt associations</h3><span class="pill amber">${groups.length}</span></div>${devDetailList(groups, (group) => [group.group_key || "Group", `${group.note || "No staff note"} · ${(group.members || []).map((member) => member.observed_name || member.uid).join(", ")}`])}</section>
        </div>
      </div>
    </section>
  </div>`;
}

function devLinkedAccounts(users) {
  const linked = users.filter((x) => x.arma_linked);
  return `<div class="dev-account-directory"><div class="dev-account-directory-head"><span>Account</span><span>Civilian record</span><span>Bohemia identity</span><span>Status</span></div>${linked.map((x) => `<button class="dev-account-tile" data-dev-account="${x.id}"><span class="dev-link-avatar">${escapeHtml((x.name || "??").slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.email || "Verified web account")}</small></div><span><strong>CIV ${escapeHtml(x.civ_number || "pending")}</strong><small>${escapeHtml(x.player_name || "Player name pending")}</small></span><code>${escapeHtml(x.linked_arma_id || "Identity unavailable")}</code><span class="dev-record-status verified">Linked</span><i>›</i></button>`).join("") || `<div class="empty">No linked accounts</div>`}</div>`;
}

function devPlatformIdentity(...values) {
  const raw = values.find((value) => String(value ?? "").trim()) ?? "";
  const normalized = String(raw).trim().toLowerCase();
  const platforms = {
    "0": ["Unknown", "UN", "No platform signal"],
    "1": ["PC", "PC", "Windows / Steam"],
    "2": ["Xbox", "XB", "Xbox network"],
    "3": ["PlayStation", "PS", "PlayStation Network"],
    pc: ["PC", "PC", "Windows / Steam"],
    windows: ["PC", "PC", "Windows / Steam"],
    steam: ["PC", "PC", "Windows / Steam"],
    xbox: ["Xbox", "XB", "Xbox network"],
    xboxone: ["Xbox", "XB", "Xbox network"],
    xboxseries: ["Xbox", "XB", "Xbox network"],
    playstation: ["PlayStation", "PS", "PlayStation Network"],
    ps4: ["PlayStation", "PS", "PlayStation Network"],
    ps5: ["PlayStation", "PS", "PlayStation Network"],
  };
  const match = platforms[normalized] || (
    normalized.includes("xbox") ? platforms.xbox :
    normalized.includes("playstation") || /^ps[45]?$/.test(normalized) ? platforms.playstation :
    normalized.includes("steam") || normalized.includes("windows") || normalized === "pc" ? platforms.pc :
    null
  );
  return {
    label: match?.[0] || (raw ? String(raw) : "Unknown"),
    mark: match?.[1] || "UN",
    detail: match?.[2] || "Unrecognized platform signal",
    raw: raw ? String(raw) : "",
  };
}

function renderDevAccountModal(data) {
  const a = data.account || {};
  const sanctions = data.sanctions || [], warnings = data.warnings || [], tx = data.transactions || [];
  const activity = data.arma_activity || [], characters = data.characters || [], jobs = data.jobs || [], citations = data.citations || [], properties = data.properties || [];
  const gameBank = data.game_database?.bank;
  const antiCheat = data.anti_cheat || {};
  const platform = devPlatformIdentity(antiCheat.reported_system, antiCheat.detected_system, a.platform);
  const platformSource = antiCheat.reported_system ? "Anti-cheat telemetry" : a.platform ? "Verified account link" : "No device report";
  return `<div class="dev-profile-backdrop" data-close-dev-account>
    <section class="dev-profile-modal dev-account-profile" role="dialog" aria-modal="true" aria-label="Linked account investigation profile">
      <header class="dev-profile-header dev-account-profile-head">
        <div class="dev-profile-person">
          <span class="dev-profile-monogram">${escapeHtml((a.name || a.player_name || "?").trim().charAt(0).toUpperCase())}</span>
          <div><p class="eyebrow">Player intelligence record</p><h2>${escapeHtml(a.name || "Account")}</h2><p>CIV ${escapeHtml(a.civ_number || "pending")} <span>•</span> ${escapeHtml(a.player_name || "Unknown in-game name")}</p></div>
        </div>
        <div class="dev-profile-actions"><span class="dev-profile-state ${a.verified ? "verified" : ""}">${a.verified ? "Verified identity" : "Unverified"}</span><button class="danger" data-dev-enforce="${a.id}">Ban / Timeout</button><button class="secondary" data-close-dev-account>Close</button></div>
      </header>
      <div class="dev-profile-scroll">
        <section class="dev-identity-command">
          <div class="dev-platform-card">
            <span class="dev-platform-mark">${escapeHtml(platform.mark)}</span>
            <div><p class="eyebrow">Active platform</p><h3>${escapeHtml(platform.label)}</h3><p>${escapeHtml(platform.detail)}</p></div>
            <span class="dev-signal-status"><i></i>${escapeHtml(platformSource)}</span>
          </div>
          <div class="dev-command-facts">
            <div><span>Account email</span><strong>${escapeHtml(a.email || "Not recorded")}</strong></div>
            <div><span>Live bank</span><strong>${gameBank ? money(gameBank.balance || 0) : "Awaiting sync"}</strong></div>
            <div><span>Server</span><strong>${escapeHtml(a.server_id || "Unknown")}</strong></div>
            <div><span>Last game sync</span><strong>${escapeHtml(a.last_sync_at || "Not reported")}</strong></div>
          </div>
        </section>
        <section class="dev-identity-ledger">
          <div class="dev-ledger-heading"><p class="eyebrow">Identity ledger</p><h3>Verified identifiers</h3></div>
          <dl>
            <div><dt>Bohemia Identity ID</dt><dd>${escapeHtml(a.identity_id || "Not reported")}</dd></div>
            <div><dt>UID</dt><dd>${escapeHtml(a.uid || "Not reported")}</dd></div>
            <div><dt>RPL identity</dt><dd>${escapeHtml(a.rpl_identity || "Not reported")}</dd></div>
            <div><dt>Roles</dt><dd>${escapeHtml((a.roles || []).join(", ") || "No assigned roles")}</dd></div>
            <div><dt>Linked</dt><dd>${escapeHtml(a.linked_at || "Not reported")}</dd></div>
            <div><dt>Raw platform code</dt><dd>${escapeHtml(platform.raw || "Not reported")}</dd></div>
          </dl>
        </section>
        ${data.active_block ? `<div class="dev-alert red-tone"><strong>Active ${escapeHtml(data.active_block.sanction_type)}</strong><span>${escapeHtml(data.active_block.reason || "")}</span></div>` : ""}
        <div class="dev-profile-grid">
          <section class="dev-card"><div class="row"><h3>Characters</h3><span class="pill">${characters.length}</span></div>${devDetailList(characters, (x) => [x.character_name || x.name || "Character", `${x.is_active ? "Active" : "Inactive"} · updated ${x.updated_at || ""}`])}</section>
          <section class="dev-card"><div class="row"><h3>Jobs</h3><span class="pill">${jobs.length}</span></div>${devDetailList(jobs, (x) => [x.title || "Job", `${x.market || ""} · ${x.status || ""} · started ${x.started_at || ""}`])}</section>
          <section class="dev-card"><div class="row"><h3>Enforcement History</h3><span class="pill red">${sanctions.length}</span></div>${devDetailList(sanctions, (x) => [`${x.report_number || "Legacy"} · ${x.sanction_type}`, `${x.rule_code || ""} ${x.reason || ""}`])}</section>
          <section class="dev-card"><div class="row"><h3>Internal Notes</h3><span class="pill amber">${warnings.length}</span></div>${devDetailList(warnings, (x) => [`${x.severity || ""} · ${x.subject || ""}`, `${x.body || ""}`])}</section>
          <section class="dev-card"><div class="row"><h3>Citations / Cases</h3><span class="pill">${citations.length}</span></div>${devDetailList(citations, (x) => [`${x.charge_code || ""} · ${x.charge_title || "Case"}`, `${x.status || ""} · ${money(x.fine_amount || 0)} · ${x.location || ""}`])}</section>
          <section class="dev-card"><div class="row"><h3>Properties</h3><span class="pill">${properties.length}</span></div>${devDetailList(properties, (x) => [x.name || "Property", `${x.address || ""} · ${money(x.price || 0)}`])}</section>
        </div>
        <section class="dev-card"><div class="row"><div><p class="eyebrow">Railway ledger</p><h3>Money Transactions</h3></div><span class="pill">${tx.length}</span></div>${devDetailList(tx, (x) => [`${x.type || "transaction"} · ${money(x.amount || 0)}`, `${x.description || ""} · ${x.created_at || ""}`])}</section>
        <section class="dev-card"><div class="row"><div><p class="eyebrow">In-game bridge events</p><h3>Arma Activity</h3></div><span class="pill">${activity.length}</span></div>${devDetailList(activity, (x) => [`${x.event_type || "event"} · ${x.action || ""}`, `${x.reason || ""} · ${x.received_at || ""}`])}</section>
        <section class="dev-card dev-game-db-status"><div><p class="eyebrow">FCRPMUSSALO source</p><h3>Native Game Database</h3><p class="muted">${gameBank ? `Live bank record synced from ${escapeHtml(gameBank.source_file || "BankManagerComponent")}. Last sync: ${escapeHtml(gameBank.synced_at || "")}.` : "The bank parser is ready; this linked identity will populate after the bridge posts the live BankManager JSON."} Inventory, criminal, police report, character, and vehicle parsers can use the same pipeline once their JSON shapes are inspected.</p></div><span class="pill ${gameBank ? "green" : "amber"}">${gameBank ? "bank synced" : "awaiting sync"}</span></section>
      </div>
    </section>
  </div>`;
}

function devDetailList(items, mapper) {
  return `<div class="dev-detail-list">${items.map((item) => { const [title, detail] = mapper(item); return `<div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`; }).join("") || `<div class="empty">No records</div>`}</div>`;
}

function bindDevWorkspace() {
  bindDevTools();
  $$("[data-dev-tab], [data-dev-go]").forEach((button) => button.addEventListener("click", () => { state.devTab = button.dataset.devTab || button.dataset.devGo; render(); }));
  $$("[data-anticheat-player]").forEach((button) => button.addEventListener("click", () => {
    state.devAntiCheatUid = button.dataset.anticheatPlayer;
    render();
  }));
  $$("[data-close-anticheat]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget && event.currentTarget.classList.contains("dev-profile-backdrop")) return;
    state.devAntiCheatUid = null;
    render();
  }));
  $("#antiCheatSearch")?.addEventListener("input", (event) => {
    state.devAntiCheatSearch = event.target.value;
    render();
    const input = $("#antiCheatSearch");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  $$("[data-dev-account]").forEach((button) => button.addEventListener("click", async () => {
    try {
      state.devAccount = await api(`/api/dev-tools/accounts/${button.dataset.devAccount}`);
      render();
    } catch (error) { toast(error.message); }
  }));
  $$("[data-close-dev-account]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget && event.currentTarget.classList.contains("dev-profile-backdrop")) return;
    state.devAccount = null;
    render();
  }));
  $("[data-dev-enforce]")?.addEventListener("click", () => {
    const targetId = $("[data-dev-enforce]").dataset.devEnforce;
    state.devAccount = null;
    state.devTab = "enforcement";
    render();
    const select = $("#devSanctionForm select[name='user_id']");
    if (select) select.value = targetId;
  });
  $("[data-close-dev]")?.addEventListener("click", async () => { state.activeApp = null; await loadSession(); });
  $("[data-refresh-dev]")?.addEventListener("click", refreshDevTools);
}

async function refreshDevTools() {
  await loadAppData("dev-tools");
  render();
}

function renderFineSettlement() {
  const data = state.cache["fine-settlement"] || { unpaid: [], batches: [] };
  const unpaid = data.unpaid || [];
  const batches = data.batches || [];
  const taxReady = data.tax_ready || [];
  const taxBatches = data.tax_batches || [];
  return `
    <div class="stack">
      <section class="profile-hero">
        <div>
          <p class="eyebrow">State of Faircroft DCJS</p>
          <h3>Fine Settlement Control</h3>
          <p>Owner/developer-only processing for court fines against live FCRPMUSSALO bank balances.</p>
        </div>
        <span class="pill">${unpaid.length} READY</span>
      </section>
      <div class="court-tabs">
        <button class="${state.settlementTab === "fines" ? "active" : ""}" data-settlement-tab="fines">Fine Settlement</button>
        <button class="${state.settlementTab === "taxes" ? "active" : ""}" data-settlement-tab="taxes">Tax Settlement</button>
      </div>
      <div style="${state.settlementTab === "fines" ? "" : "display:none"}" class="stack">
      <section class="profile-link-card">
        <h3>Required Codex procedure</h3>
        <ol class="small">
          <li>Select eligible fines and lock a settlement batch.</li>
          <li>Generate the one-time developer code and approve that exact batch.</li>
          <li>Copy the generated instructions into Codex. Codex must use the signed-in Shadowhaven panel.</li>
          <li>Codex stops the Arma server, waits 120 seconds, confirms it is offline, and edits only the listed live bank JSON records through SFTP.</li>
          <li>No backup is created. Codex starts the server and waits for the Railway bank sync.</li>
          <li>Run balance verification below. Only exact verified deductions become paid.</li>
        </ol>
        <p class="muted small">Never edit the bank database while the game server is running. Manual Shadowhaven Stop/Start is required because no hosting-panel API is configured.</p>
      </section>
      <section class="profile-link-card">
        <div class="row"><div><h3>Eligible unpaid fines</h3><p class="muted small">Only linked accounts with a synced game balance appear here.</p></div><strong>${unpaid.length}</strong></div>
        <form id="fine-batch-form" class="stack">
          ${unpaid.map((fine) => `
            <label class="dev-account-row">
              <input type="checkbox" name="citation_ids" value="${fine.id}" />
              <span><strong>${escapeHtml(fine.name)} · ${escapeHtml(fine.civ_number || "")}</strong>
              <small>${escapeHtml(fine.charge_code)} ${escapeHtml(fine.charge_title)} · Current ${money(fine.balance)} · Fine ${money(fine.fine_amount)}</small></span>
            </label>`).join("") || `<div class="empty">No eligible unpaid fines are awaiting settlement.</div>`}
          ${unpaid.length ? `<label>Batch notes<textarea name="notes" rows="3" placeholder="Court order, docket, or settlement instructions"></textarea></label><button type="submit">Create locked batch</button>` : ""}
        </form>
      </section>
      <section class="stack">
        <div class="row"><h3>Settlement batches</h3><span class="pill">${batches.length}</span></div>
        ${batches.map((batch) => `
          <article class="profile-link-card">
            <div class="row"><div><p class="eyebrow">${escapeHtml(batch.batch_number)}</p><h3>${escapeHtml(String(batch.status || "").replaceAll("_", " "))}</h3></div><strong>${money(batch.total_amount)}</strong></div>
            ${(batch.items || []).map((item) => `
              <div class="row"><span>${escapeHtml(item.name)} · Case ${item.citation_id}<small>${escapeHtml(item.charge_code)} · ${money(item.balance_before)} → ${money(item.expected_balance)}</small></span>
              <span class="pill">${escapeHtml(item.status)}</span></div>
              ${item.failure_reason ? `<p class="muted small">${escapeHtml(item.failure_reason)}</p>` : ""}`).join("")}
            ${batch.status === "draft" ? `
              <div class="row"><button type="button" class="secondary" data-fine-code="${batch.id}">Generate 10-minute code</button>
              ${state.fineSettlementCode?.batchId === batch.id ? `<strong>${escapeHtml(state.fineSettlementCode.code)}</strong>` : ""}</div>
              <form data-fine-approve="${batch.id}" class="inline-form"><input name="code" required placeholder="DCJS authorization code" autocomplete="off" /><button>Approve for Codex</button></form>` : ""}
            ${batch.status === "awaiting_codex" || batch.status === "needs_review" ? `
              <button type="button" data-fine-verify="${batch.id}">Verify synced balances and resolve</button>` : ""}
          </article>`).join("") || `<div class="empty">No settlement batches created.</div>`}
      </section>
      </div>
      <div style="${state.settlementTab === "taxes" ? "" : "display:none"}" class="stack">
      <section class="profile-link-card">
        <div class="row"><div><p class="eyebrow">Registered licenses</p><h3>Issue accrued weekly tax</h3><p class="muted small">This license list and its tax controls are visible only to owners/developers.</p></div><span class="pill">${(data.tax_licenses || []).length}</span></div>
        ${(data.tax_licenses || []).map((license) => `
          <article class="dev-account-row">
            <span><strong>${escapeHtml(license.business_name)} · ${escapeHtml(license.license_number)}</strong>
            <small>${escapeHtml(license.owner_name)} · ${license.accrued_weeks || 0} complete week(s) · ${money(license.weekly_tax)}/week · ${money(license.unpaid_tax)} unpaid</small></span>
            <form data-issue-license-tax="${license.id}" class="inline-form">
              <input name="notes" placeholder="Optional developer note" />
              <button ${(license.accrued_weeks || 0) < 1 ? "disabled" : ""}>Issue ${money(license.accrued_tax || 0)}</button>
            </form>
            ${(license.accrued_weeks || 0) < 1 ? `<small>Next accrual: ${new Date(license.tax_available_at).toLocaleString()}</small>` : ""}
          </article>`).join("") || `<div class="empty">No linked registered business licenses.</div>`}
      </section>
      <section class="profile-link-card">
        <div class="row"><div><p class="eyebrow">Business revenue</p><h3>Eligible accumulated taxes</h3><p class="muted small">Assessments tally by registered business. Only linked owners with sufficient synced game funds appear.</p></div><strong>${taxReady.length}</strong></div>
        <form id="tax-batch-form" class="stack">
          ${taxReady.map((tax) => `
            <label class="dev-account-row"><input type="checkbox" name="business_ids" value="${tax.business_id}" />
              <span><strong>${escapeHtml(tax.business_name)} · ${escapeHtml(tax.license_number)}</strong>
              <small>${escapeHtml(tax.owner_name)} · ${tax.assessment_count} assessment(s) · Tax ${money(tax.tax_amount)} · Balance ${money(tax.balance)}</small></span>
            </label>`).join("") || `<div class="empty">No eligible accumulated business taxes.</div>`}
          ${taxReady.length ? `<label>Batch notes<textarea name="notes" rows="3" placeholder="Tax order or processing notes"></textarea></label><button type="submit">Create locked tax batch</button>` : ""}
        </form>
      </section>
      <section class="stack">
        <div class="row"><h3>Business tax batches</h3><span class="pill">${taxBatches.length}</span></div>
        ${taxBatches.map((batch) => `
          <article class="profile-link-card">
            <div class="row"><div><p class="eyebrow">${escapeHtml(batch.batch_number)}</p><h3>${humanLabel(batch.status)}</h3></div><strong>${money(batch.total_amount)}</strong></div>
            ${(batch.items || []).map((item) => `<div class="row"><span>${escapeHtml(item.business_name)} · ${escapeHtml(item.owner_name)}<small>${money(item.balance_before)} → ${money(item.expected_balance)}</small></span><span class="pill">${escapeHtml(item.status)}</span></div>${item.failure_reason ? `<p class="muted small">${escapeHtml(item.failure_reason)}</p>` : ""}`).join("")}
            ${batch.status === "draft" ? `<div class="row"><button type="button" class="secondary" data-tax-code="${batch.id}">Generate 10-minute tax code</button>${state.taxSettlementCode?.batchId === batch.id ? `<strong>${escapeHtml(state.taxSettlementCode.code)}</strong>` : ""}</div>
              <form data-tax-approve="${batch.id}" class="inline-form"><input name="code" required placeholder="TAX authorization code" autocomplete="off" /><button>Approve for Codex</button></form>` : ""}
            ${["awaiting_codex", "needs_review"].includes(batch.status) ? `<button type="button" data-tax-verify="${batch.id}">Verify synced tax balances</button>` : ""}
          </article>`).join("") || `<div class="empty">No business tax settlement batches.</div>`}
      </section>
      </div>
      ${state.fineSettlementPrompt ? `<section class="profile-link-card"><h3>Codex processing request</h3><textarea id="fine-codex-prompt" rows="8" readonly>${escapeHtml(state.fineSettlementPrompt)}</textarea><button type="button" data-copy-fine-prompt>Copy for Codex</button></section>` : ""}
    </div>`;
}

function bindFineSettlement() {
  $$("[data-settlement-tab]").forEach((button) => button.addEventListener("click", () => {
    state.settlementTab = button.dataset.settlementTab;
    render();
  }));
  $$("[data-issue-license-tax]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api(`/api/business/licenses/${form.dataset.issueLicenseTax}/taxes`, {
      method: "POST",
      body: { notes: form.notes?.value || "" },
    });
    toast("Accrued business tax issued");
    state.cache["fine-settlement"] = await api("/api/fine-settlement");
    render();
  }));
  $("#fine-batch-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const citation_ids = $$('input[name="citation_ids"]:checked', form).map((input) => Number(input.value));
    if (!citation_ids.length) return toast("Select at least one fine");
    await api("/api/fine-settlement/batches", { method: "POST", body: { citation_ids, notes: form.notes?.value || "" } });
    state.cache["fine-settlement"] = await api("/api/fine-settlement");
    render();
  });
  $$("[data-fine-code]").forEach((button) => button.addEventListener("click", async () => {
    const batchId = Number(button.dataset.fineCode);
    const result = await api(`/api/fine-settlement/batches/${batchId}/code`, { method: "POST", body: {} });
    state.fineSettlementCode = { batchId, code: result.code, expiresAt: result.expires_at };
    render();
  }));
  $$("[data-fine-approve]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const batchId = Number(form.dataset.fineApprove);
    const result = await api(`/api/fine-settlement/batches/${batchId}/approve`, { method: "POST", body: { code: form.code.value } });
    state.fineSettlementPrompt = result.codex_prompt || "";
    state.fineSettlementCode = null;
    state.cache["fine-settlement"] = await api("/api/fine-settlement");
    render();
  }));
  $$("[data-fine-verify]").forEach((button) => button.addEventListener("click", async () => {
    const result = await api(`/api/fine-settlement/batches/${button.dataset.fineVerify}/complete`, { method: "POST", body: {} });
    toast(result.status === "completed" ? "All deductions verified and fines marked paid" : "Balance mismatch found; batch requires review");
    state.cache["fine-settlement"] = await api("/api/fine-settlement");
    render();
  }));
  $("#tax-batch-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const business_ids = $$('input[name="business_ids"]:checked', form).map((input) => Number(input.value));
    if (!business_ids.length) return toast("Select at least one business");
    await api("/api/fine-settlement/tax-batches", { method: "POST", body: { business_ids, notes: form.notes?.value || "" } });
    state.cache["fine-settlement"] = await api("/api/fine-settlement");
    render();
  });
  $$("[data-tax-code]").forEach((button) => button.addEventListener("click", async () => {
    const batchId = Number(button.dataset.taxCode);
    const result = await api(`/api/fine-settlement/tax-batches/${batchId}/code`, { method: "POST", body: {} });
    state.taxSettlementCode = { batchId, code: result.code };
    render();
  }));
  $$("[data-tax-approve]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const batchId = Number(form.dataset.taxApprove);
    const result = await api(`/api/fine-settlement/tax-batches/${batchId}/approve`, { method: "POST", body: { code: form.code.value } });
    state.fineSettlementPrompt = result.codex_prompt || "";
    state.taxSettlementCode = null;
    state.cache["fine-settlement"] = await api("/api/fine-settlement");
    render();
  }));
  $$("[data-tax-verify]").forEach((button) => button.addEventListener("click", async () => {
    const result = await api(`/api/fine-settlement/tax-batches/${button.dataset.taxVerify}/complete`, { method: "POST", body: {} });
    toast(result.status === "completed" ? "Business taxes verified and marked paid" : "Tax balance mismatch; batch requires review");
    state.cache["fine-settlement"] = await api("/api/fine-settlement");
    render();
  }));
  $("[data-copy-fine-prompt]")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.fineSettlementPrompt);
    toast("Codex request copied");
  });
}

function bindDevTools() {
  $("#devBetaProgramForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api("/api/dev-tools/beta-program", { method: "PATCH", body: { enabled: form.enabled.checked, message: form.message.value } });
    toast(form.enabled.checked ? "Beta recruitment is active" : "Beta recruitment is closed");
    await refreshDevTools();
  });
  $("#devBetaTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/dev-tools/beta-tasks", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
    toast("Beta task published");
    await refreshDevTools();
  });
  $$("[data-beta-task-toggle]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/dev-tools/beta-tasks/${button.dataset.betaTaskToggle}`, { method: "PATCH", body: { active: button.dataset.active === "true" } });
    toast("Beta task updated");
    await refreshDevTools();
  }));
  $("#devAppVisibilityForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const visibility = {};
    $$('input[type="checkbox"]', event.currentTarget).forEach((input) => {
      visibility[input.name] = input.checked;
    });
    await api("/api/dev-tools/app-visibility", { method: "PATCH", body: { visibility } });
    toast("Application visibility updated");
    await refreshDevTools();
  });
  $("#devRuleSelect")?.addEventListener("change", (event) => {
    const option = event.currentTarget.selectedOptions[0];
    const reason = $("#devPublicReason");
    if (reason && option?.value) {
      reason.value = `Violation of Faircroft Rule ${option.value} — ${option.dataset.title}: ${option.dataset.description}`;
    }
  });
  $("#devCodeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.generatedDevCode = await api("/api/dev-tools/unlink-codes", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("One-time developer code generated");
      await refreshDevTools();
    } catch (error) { toast(error.message); }
  });
  $("#devSanctionForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/dev-tools/sanctions", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast(result.game_enforcement_status === "rcon_not_configured"
        ? `Report ${result.report_number || ""} recorded in CAD; RCON is not configured`
        : `Enforcement report ${result.report_number || ""} applied`);
      await refreshDevTools();
    } catch (error) { toast(error.message); }
  });
  $$("[data-revoke-sanction]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const reason = window.prompt("Reason for revoking this sanction or unbanning the account:", "Reviewed by staff");
      if (reason === null) return;
      const result = await api(`/api/dev-tools/sanctions/${button.dataset.revokeSanction}/revoke`, { method: "POST", body: { reason } });
      toast(button.dataset.gameUnban === "true" && result.game_enforcement_status === "applied"
        ? "Player unbanned in Arma and sanction revoked"
        : "Sanction revoked");
      await refreshDevTools();
    } catch (error) { toast(error.message); }
  }));
  $("#devWarningForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/dev-tools/warnings", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast("Internal warning recorded");
      await refreshDevTools();
    } catch (error) { toast(error.message); }
  });
  $$("[data-resolve-warning]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const notes = window.prompt("Resolution notes:", "Resolved by staff");
      if (notes === null) return;
      await api(`/api/dev-tools/warnings/${button.dataset.resolveWarning}/resolve`, { method: "POST", body: { notes } });
      toast("Warning resolved");
      await refreshDevTools();
    } catch (error) { toast(error.message); }
  }));
}

function renderAdmin() {
  const data = state.cache.admin;
  if (!data) return `<div class="empty">Admin loading</div>`;
  const accountModal = state.adminAccountId ? renderAdminAccountModal(data.users.users.find((user) => String(user.id) === String(state.adminAccountId))) : "";
  const pendingReferrals = data.referrals?.stats?.pending || data.overview.stats.pending_referrals || 0;
  const applicationStats = data.applications?.stats || {};
  const activeApplications = applicationStats.active || data.overview.stats.department_applications || 0;
  const body = state.adminTab === "referrals"
    ? renderAdminReferrals(data.referrals || { stats: {}, referrals: [] })
    : state.adminTab === "applications"
      ? renderAdminDepartmentApplications(data.applications || { stats: {}, applications: [] })
      : renderAdminUsers(data.users.users);
  return `
    <div class="stack">
      <div class="grid-2">
        <div class="metric"><span>Users</span><strong>${data.overview.stats.users}</strong></div>
        <div class="metric"><span>Unverified</span><strong>${data.overview.stats.unverified}</strong></div>
        <div class="metric"><span>Job applications</span><strong>${activeApplications}</strong></div>
        <div class="metric"><span>Referral tickets</span><strong>${pendingReferrals}</strong></div>
      </div>
      <div class="segmented">
        <button class="${state.adminTab === "users" ? "active" : ""}" data-admin-tab="users">Users</button>
        <button class="${state.adminTab === "applications" ? "active" : ""}" data-admin-tab="applications">Job Apps</button>
        <button class="${state.adminTab === "referrals" ? "active" : ""}" data-admin-tab="referrals">Referral Tickets</button>
      </div>
      ${body}
    </div>
    ${accountModal}
  `;
}

function renderSystem() {
  const data = state.cache.system || {};
  const settings = data.settings || { autopilot_verify_enabled: false, autopilot_verify_minutes: 120, autopilot_license_enabled: true, autopilot_license_minutes: 6, update_lockdown_enabled: false, update_lockdown_message: "System update in progress. Driver License and LEO MDT remain available." };
  const stats = data.stats || { pending_accounts: 0, eligible_accounts: 0, pending_license_applications: 0, eligible_license_applications: 0 };
  const minutesValue = Number(settings.autopilot_verify_minutes || 120);
  const licenseMinutesValue = Number(settings.autopilot_license_minutes || 6);
  const hoursLabel = minutesValue >= 60 ? `${(minutesValue / 60).toFixed(minutesValue % 60 ? 1 : 0)} hours` : `${minutesValue} minutes`;
  const licenseLabel = licenseMinutesValue >= 60 ? `${(licenseMinutesValue / 60).toFixed(licenseMinutesValue % 60 ? 1 : 0)} hours` : `${licenseMinutesValue} minutes`;
  const lockdownEnabled = Boolean(settings.update_lockdown_enabled);
  return `
    <div class="stack system-app">
      <section class="profile-hero system-hero">
        <div>
          <p class="eyebrow">Owner controls</p>
          <h3>System Settings</h3>
          <p>Verification autopilot is ${settings.autopilot_verify_enabled ? "enabled" : "disabled"} / Driver license autopilot is ${settings.autopilot_license_enabled ? "enabled" : "disabled"} / Update lockdown is ${lockdownEnabled ? "enabled" : "disabled"}</p>
        </div>
        <span class="pill ${lockdownEnabled ? "amber" : settings.autopilot_license_enabled || settings.autopilot_verify_enabled ? "green" : "amber"}">${lockdownEnabled ? "lockdown" : settings.autopilot_license_enabled || settings.autopilot_verify_enabled ? "auto" : "manual"}</span>
      </section>
      <div class="grid-2">
        <div class="metric"><span>Pending accounts</span><strong>${stats.pending_accounts || 0}</strong></div>
        <div class="metric"><span>Account eligible</span><strong>${stats.eligible_accounts || 0}</strong></div>
        <div class="metric"><span>Pending licenses</span><strong>${stats.pending_license_applications || 0}</strong></div>
        <div class="metric"><span>License eligible</span><strong>${stats.eligible_license_applications || 0}</strong></div>
      </div>
      <form id="systemSettingsForm" class="card form-grid">
        <div class="system-setting-block">
          <div class="row">
            <div>
              <p class="eyebrow">Auto pilot</p>
              <h3>Account Verification</h3>
            </div>
            <span class="pill">${escapeHtml(hoursLabel)}</span>
          </div>
          <label class="check-row"><input type="checkbox" name="autopilot_verify_enabled" ${settings.autopilot_verify_enabled ? "checked" : ""} /> Enable account auto pilot</label>
          <label>Verify accounts after minutes<input name="autopilot_verify_minutes" type="number" min="1" max="10080" step="1" value="${escapeHtml(minutesValue)}" /></label>
        </div>
        <div class="system-setting-block">
          <div class="row">
            <div>
              <p class="eyebrow">DMV auto pilot</p>
              <h3>Driver License Applications</h3>
            </div>
            <span class="pill">${escapeHtml(licenseLabel)}</span>
          </div>
          <label class="check-row"><input type="checkbox" name="autopilot_license_enabled" ${settings.autopilot_license_enabled ? "checked" : ""} /> Enable driver license auto approval</label>
          <label>Approve licenses after minutes<input name="autopilot_license_minutes" type="number" min="1" max="10080" step="1" value="${escapeHtml(licenseMinutesValue)}" /></label>
          <p class="muted small">Default is 6 minutes. Suspended or revoked licenses are not auto-reinstated.</p>
        </div>
        <div class="system-setting-block update-lockdown-setting">
          <div class="row">
            <div>
              <p class="eyebrow">Software update mode</p>
              <h3>System Update Lockdown</h3>
            </div>
            <span class="pill ${lockdownEnabled ? "amber" : "green"}">${lockdownEnabled ? "enabled" : "off"}</span>
          </div>
          <label class="check-row"><input type="checkbox" name="update_lockdown_enabled" ${lockdownEnabled ? "checked" : ""} /> Enable system update lockdown</label>
          <label>Lockdown message<textarea name="update_lockdown_message" maxlength="240">${escapeHtml(settings.update_lockdown_message || "")}</textarea></label>
          <p class="muted small">When enabled, the phone enters a Software Update screen. Only Driver License, LEO MDT, and owner System controls stay available.</p>
        </div>
        <button class="primary" type="submit">Save system settings</button>
      </form>
      ${data.auto_verified_now ? `<div class="card"><h3>${data.auto_verified_now} accounts verified</h3><p class="muted small">Auto pilot processed eligible accounts on this check.</p></div>` : ""}
      ${data.auto_licensed_now ? `<div class="card"><h3>${data.auto_licensed_now} driver licenses approved</h3><p class="muted small">DMV auto pilot processed eligible license applications on this check.</p></div>` : ""}
    </div>
  `;
}

const roleOptions = ["civ", "owner", "admin", "dev", "beta", "indeed_admin", "leo", "judge", "lawyer", "ems", "fireman", "fire_chief", "deputy_chief", "fire_marshal", "dispatcher", "sheriff", "police", "metro_police_chief", "state_police", "state_police_commander", "cid", "cid_director", "iu", "iu_director", "business_owner", "business_registrar", "city_hall", "economy_manager"];

function adminUserSearchText(user) {
  return [
    user.name,
    user.email,
    user.civ_number,
    user.arma_id,
    user.car_entry_code,
    user.callsign,
    user.referral_code,
    user.primary_agency,
    user.active_character_name,
    ...(user.roles || []),
    user.verified ? "verified" : "pending unverified",
  ].filter(Boolean).join(" ").toLowerCase();
}

function parseDepartmentApplicationPacket(statement) {
  try {
    const packet = JSON.parse(statement || "{}");
    return Array.isArray(packet.answers) ? packet : null;
  } catch (error) {
    return null;
  }
}

function renderDepartmentApplicationPacket(item) {
  const packet = parseDepartmentApplicationPacket(item.statement);
  if (!packet) {
    return `
      <details class="admin-application-packet">
        <summary>Application statement</summary>
        <p>${escapeHtml(item.statement || "No statement recorded")}</p>
      </details>
    `;
  }
  return `
    <details class="admin-application-packet">
      <summary>${packet.type === "bar_exam_application" ? `Bar Exam · Internal score ${escapeHtml(packet.score)}/${escapeHtml(packet.total)}` : "Application packet"}</summary>
      <div class="admin-packet-answers">
        ${packet.answers.map((answer) => `
          <div>
            <span>${escapeHtml(answer.question)}</span>
            <p>${escapeHtml(answer.answer)}</p>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderIndeedAdmin() {
  const data = state.cache["indeed-admin"] || { stats: {}, applications: [] };
  return `
    <div class="stack indeed-admin-app">
      <section class="indeed-hero">
        <div>
          <p class="eyebrow">Recruitment desk</p>
          <h3>Indeed Admin</h3>
          <p>Review department job applications, open full packets, and move candidates through command approval without using the full Admin panel.</p>
        </div>
        <div class="indeed-hero-stats">
          <span>${data.stats?.active || 0}</span>
          <small>active files</small>
        </div>
      </section>
      ${renderAdminDepartmentApplications(data, "indeed")}
    </div>
  `;
}

function renderAdminDepartmentApplications(data, mode = "admin") {
  const rows = data.applications || [];
  const groups = {
    active: rows.filter((item) => !["approved", "denied", "withdrawn", "closed"].includes(item.status)),
    approved: rows.filter((item) => item.status === "approved"),
    denied: rows.filter((item) => item.status === "denied"),
    closed: rows.filter((item) => ["withdrawn", "closed"].includes(item.status)),
  };
  const isIndeed = mode === "indeed";
  const filterKey = isIndeed ? "indeedApplicationFilter" : "adminApplicationFilter";
  const filterAttr = isIndeed ? "data-indeed-application-filter" : "data-admin-application-filter";
  if (!groups[state[filterKey]]) state[filterKey] = "active";
  const visible = groups[state[filterKey]] || [];
  const filters = [
    ["active", "Active", groups.active.length],
    ["approved", "Approved", groups.approved.length],
    ["denied", "Denied", groups.denied.length],
    ["closed", "Closed", groups.closed.length],
  ];
  return `
    <section class="admin-application-board ${isIndeed ? "indeed-application-board" : ""}">
      <div class="grid-2">
        <div class="metric"><span>New</span><strong>${data.stats?.submitted || 0}</strong></div>
        <div class="metric"><span>Under review</span><strong>${data.stats?.under_review || 0}</strong></div>
        <div class="metric"><span>Approved</span><strong>${data.stats?.approved || 0}</strong></div>
        <div class="metric"><span>Denied</span><strong>${data.stats?.denied || 0}</strong></div>
      </div>
      <div class="admin-application-filters">
        ${filters.map(([id, label, count]) => `
          <button class="${state[filterKey] === id ? "active" : ""}" type="button" ${filterAttr}="${id}">
            <span>${escapeHtml(label)}</span>
            <strong>${count}</strong>
          </button>
        `).join("")}
      </div>
      <div class="admin-application-list">
        ${visible.map((item) => renderAdminDepartmentApplicationCard(item, mode)).join("") || `<div class="empty">No applications in this folder</div>`}
      </div>
    </section>
  `;
}

function renderAdminDepartmentApplicationCard(item, mode = "admin") {
  const isClosed = ["approved", "denied", "withdrawn", "closed"].includes(item.status);
  const isBarExam = item.department_key === "lawyer";
  const isIndeed = mode === "indeed";
  const statusAttr = isIndeed ? "data-indeed-application-status" : "data-admin-application-status";
  const formClass = isIndeed ? "indeed-application-review-form admin-application-review-form" : "admin-application-review-form";
  return `
    <article class="admin-application-card admin-application-folder">
      <details class="admin-application-details">
        <summary>
          <div class="admin-application-summary-main">
            <div>
              <p class="eyebrow">${escapeHtml(item.application_number)}</p>
              <h3>${escapeHtml(item.applicant_name || "Applicant")}</h3>
              <p class="muted small">${escapeHtml(item.department_name)} / desired role ${escapeHtml(item.desired_role || "")}</p>
            </div>
            <div class="admin-application-summary-actions">
              <span class="pill ${businessStatusClass(item.status)}">${humanLabel(item.status)}</span>
              <span class="admin-folder-toggle"><span class="open-label">Open review</span><span class="close-label">Close review</span></span>
            </div>
          </div>
          <div class="admin-application-strip">
            <span>CIV ${escapeHtml(item.applicant_civ_number || "pending")}</span>
            <span>${escapeHtml(item.applicant_arma_id || "Arma not linked")}</span>
            <span>${escapeHtml(item.reviewer_name || "Unassigned")}</span>
          </div>
        </summary>
        <div class="admin-application-body">
          <div class="profile-grid compact">
            <div><span>CIV</span><strong>${escapeHtml(item.applicant_civ_number || "pending")}</strong></div>
            <div><span>Email</span><strong>${escapeHtml(item.applicant_email || "unknown")}</strong></div>
            <div><span>Linked Arma ID</span><strong>${escapeHtml(item.applicant_arma_id || "not linked")}</strong></div>
            <div><span>Reviewer</span><strong>${escapeHtml(item.reviewer_name || "Unassigned")}</strong></div>
          </div>
          ${renderDepartmentApplicationPacket(item)}
          ${item.reviewer_notes ? `<p class="muted small">Review notes: ${escapeHtml(item.reviewer_notes)}</p>` : ""}
          <form class="${formClass}" data-application-id="${item.id}">
            <label>Review notes<textarea name="reviewer_notes" maxlength="1500" placeholder="Optional notes sent to the applicant">${escapeHtml(item.reviewer_notes || "")}</textarea></label>
            <div class="admin-application-actions">
              <button class="secondary" type="button" ${statusAttr}="under_review" ${item.status === "under_review" ? "disabled" : ""}>Mark Review</button>
              <button class="primary" type="button" ${statusAttr}="approved" ${item.status === "approved" ? "disabled" : ""}>${isBarExam ? "Judge: Sign Certificate" : "Approve"}</button>
              <button class="danger" type="button" ${statusAttr}="denied" ${item.status === "denied" ? "disabled" : ""}>Deny</button>
              <button class="secondary" type="button" ${statusAttr}="closed" ${isClosed ? "disabled" : ""}>Close</button>
            </div>
          </form>
        </div>
      </details>
    </article>
  `;
}

function renderAdminReferrals(data) {
  const rows = data.referrals || [];
  const pending = rows.filter((item) => item.status === "pending");
  const deposited = rows.filter((item) => item.status === "deposited");
  const renderCard = (item) => `
    <article class="referral-ticket-card ${item.status === "pending" ? "pending" : "deposited"}">
      <div class="row tight">
        <div>
          <p class="eyebrow">Referral ticket #${escapeHtml(item.id)}</p>
          <h3>${escapeHtml(item.referrer_name || "Referrer")}</h3>
          <p class="muted small">Code ${escapeHtml(item.code_used)} / new user ${escapeHtml(item.referred_name || "Civilian")} / CIV ${escapeHtml(item.referred_civ_number || "pending")}</p>
        </div>
        <span class="pill ${item.status === "pending" ? "amber" : "green"}">${escapeHtml(item.status)}</span>
      </div>
      <div class="profile-grid compact">
        <div><span>Legacy ticket value</span><strong>${money(item.bonus_amount)}</strong></div>
        <div><span>Created</span><strong>${new Date(item.created_at).toLocaleString()}</strong></div>
        <div><span>Referrer CIV</span><strong>${escapeHtml(item.referrer_civ_number || "pending")}</strong></div>
        <div><span>Deposited by</span><strong>${escapeHtml(item.deposited_by_name || "Not deposited")}</strong></div>
      </div>
      ${item.status === "pending" ? `<p class="muted small">Railway payouts are disabled. Apply any approved reward through the in-game economy.</p>` : item.admin_notes ? `<p class="muted small">Legacy notes: ${escapeHtml(item.admin_notes)}</p>` : ""}
    </article>
  `;
  return `
    <section class="admin-referrals">
      <div class="grid-2">
        <div class="metric"><span>Pending tickets</span><strong>${pending.length}</strong></div>
        <div class="metric"><span>Pending rewards</span><strong>${pending.length}</strong></div>
        <div class="metric"><span>Deposited tickets</span><strong>${deposited.length}</strong></div>
        <div class="metric"><span>Legacy completed</span><strong>${deposited.length}</strong></div>
      </div>
      <div class="referral-ticket-list">
        ${pending.map(renderCard).join("") || `<div class="empty">No pending referral tickets</div>`}
      </div>
      <details class="referral-history">
        <summary>Deposited referral history</summary>
        <div class="referral-ticket-list">
          ${deposited.map(renderCard).join("") || `<div class="empty">No deposited referral tickets yet</div>`}
        </div>
      </details>
    </section>
  `;
}

function renderAdminUsers(users) {
  if (!users.length) return `<div class="empty">No accounts yet</div>`;
  const query = String(state.adminSearch || "").trim().toLowerCase();
  const matches = users.filter((user) => !query || adminUserSearchText(user).includes(query));
  return `
    <section class="admin-account-search">
      <label>Search accounts<input data-admin-account-search value="${escapeHtml(state.adminSearch)}" placeholder="Name, email, CIV, linked Arma ID, callsign, role" autocomplete="off" /></label>
      <div class="admin-search-meta">
        <span data-admin-search-count>${matches.length} of ${users.length} accounts</span>
        <button class="secondary compact-action" type="button" data-clear-admin-search ${state.adminSearch ? "" : "disabled"}>Clear</button>
      </div>
    </section>
    <div class="list admin-account-list">${users.map((user) => {
      const haystack = adminUserSearchText(user);
      const hidden = query && !haystack.includes(query);
      return `
    <article class="user-card compact-user-card ${hidden ? "search-hidden" : ""}" data-admin-user-card data-admin-search="${escapeHtml(haystack)}">
      <div class="account-main">
        <div class="account-avatar">${escapeHtml((user.name || "?").slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="row tight"><h3>${escapeHtml(user.name)}</h3><span class="pill ${user.verified ? "green" : "amber"}">${user.verified ? "verified" : "pending"}</span>${user.name_change?.locked ? `<span class="pill amber">name locked</span>` : ""}</div>
          <p class="muted small">CIV ${escapeHtml(user.civ_number || "pending")} · ${escapeHtml(user.email)}</p>
          <p class="muted small">${minutes(user.presence_seconds_today)}m today · ${Number(user.character_count || 0)} characters · ${escapeHtml(user.roles.join(", "))}</p>
        </div>
      </div>
      <button class="secondary compact-action" type="button" data-open-admin-account="${user.id}">Account</button>
    </article>
  `;
    }).join("")}</div>
    <div class="empty ${matches.length ? "search-hidden" : ""}" data-admin-search-empty>No accounts match that search</div>
  `;
}

function renderAdminAccountModal(user) {
  if (!user) {
    return "";
  }
  const nameChange = user.name_change || { locked: false, used: 0, limit: 3, remaining: 3, window_days: 3 };
  const canDeleteAccount = can("owner") && String(user.id) !== String(state.session?.user?.id) && !(user.roles || []).includes("owner");
  return `
    <div class="modal-backdrop admin-account-backdrop" data-close-admin-account>
      <section class="mdt-modal admin-account-modal" role="dialog" aria-modal="true" aria-label="Account management">
        <header class="row">
          <div>
            <p class="eyebrow">Account file</p>
            <h2>${escapeHtml(user.name)}</h2>
          </div>
          <button class="icon-action" type="button" data-close-admin-account aria-label="Close">${iconSvg.back}</button>
        </header>
        <div class="account-summary">
          <div><span>CIV</span><strong>${escapeHtml(user.civ_number || "pending")}</strong></div>
          <div><span>Linked Arma ID</span><strong>${escapeHtml(user.arma_id || "Not linked")}</strong></div>
          <div><span>Car Entry</span><strong>${escapeHtml(user.car_entry_code || "Required")}</strong></div>
          <div><span>Referral</span><strong>${escapeHtml(user.referral_code || "Generating")}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>
          <div><span>Today</span><strong>${minutes(user.presence_seconds_today)}m</strong></div>
          <div><span>Characters</span><strong>${Number(user.character_count || 0)}</strong></div>
          <div><span>Name changes</span><strong>${nameChange.locked ? "Locked" : `${nameChange.remaining}/${nameChange.limit} left`}</strong></div>
        </div>
        <div class="admin-account-scroll">
          <form class="admin-user-form form-grid account-section" data-user-id="${user.id}">
            <div class="row tight"><h3>Access</h3><span class="pill ${user.verified ? "green" : "amber"}">${user.verified ? "verified" : "pending"}</span></div>
            <label class="check-row"><input type="checkbox" name="verified" ${user.verified ? "checked" : ""} /> Verified civilian</label>
            <label>Agency/division<input name="primary_agency" value="${escapeHtml(user.primary_agency || "")}" placeholder="Sheriff / Police / State Police / CID" /></label>
            <div class="admin-name-lock">
              <div>
                <span>Name change window</span>
                <strong>${nameChange.used}/${nameChange.limit} used in ${nameChange.window_days} days</strong>
              </div>
              ${nameChange.locked ? `<label class="check-row"><input type="checkbox" name="unlock_name_changes" /> Unlock name changes</label>` : `<p class="muted small">Name changes are currently open.</p>`}
            </div>
            <div class="role-grid">
              ${roleOptions.map((role) => `<label class="check-row"><input type="checkbox" name="roles" value="${role}" ${user.roles.includes(role) ? "checked" : ""} /> ${role.replaceAll("_", " ")}</label>`).join("")}
            </div>
            <button class="primary" type="submit">Save account</button>
          </form>
          <form class="admin-password-form form-grid account-section" data-user-id="${user.id}">
            <div>
              <h3>Forgot password</h3>
              <p class="muted small">Set a new temporary password for this account. The user can sign in with it immediately.</p>
            </div>
            <label>New password<input name="password" type="password" minlength="6" autocomplete="new-password" required /></label>
            <label>Confirm password<input name="confirm_password" type="password" minlength="6" autocomplete="new-password" required /></label>
            <button class="secondary" type="submit">Reset password</button>
          </form>
          ${canDeleteAccount ? `
            <section class="account-section danger-zone">
              <div>
                <h3>Delete account</h3>
                <p class="muted small">Permanently remove this account and its owned civilian records from the system.</p>
              </div>
              <button class="danger" type="button" data-delete-admin-user="${user.id}" data-delete-name="${escapeHtml(user.name)}">Delete account</button>
            </section>
          ` : ""}
        </div>
      </section>
    </div>
  `;
}

function renderAdminJobs(jobs) {
  return `<div class="list">${jobs.map((job) => `
    <article class="job-card">
      <form class="admin-job-form form-grid" data-job-id="${job.id}">
        <div class="row"><h3>${escapeHtml(job.title)}</h3><span class="pill">${escapeHtml(job.market)}</span></div>
        <div class="grid-2">
          <label>Rate/hour<input name="rate_per_hour" type="number" step="0.01" value="${escapeHtml(job.rate_per_hour)}" /></label>
          <label>Max positions<input name="max_positions" type="number" value="${escapeHtml(job.max_positions)}" /></label>
        </div>
        <div class="grid-2">
          <label>Daily minutes<input name="required_minutes_daily" type="number" value="${escapeHtml(job.required_minutes_daily)}" /></label>
          <label class="check-row"><input type="checkbox" name="active" ${job.active ? "checked" : ""} /> Active</label>
        </div>
        <label>Requirement<input name="requirement" value="${escapeHtml(job.requirement)}" /></label>
        <p class="muted small">Filled ${job.filled}/${job.max_positions} · Market ${job.market_filled}/${job.market_cap}</p>
        <button class="primary" type="submit">Save job</button>
      </form>
    </article>
  `).join("")}</div>`;
}

function renderAdminMarkets(markets) {
  return `<div class="list">${markets.map((market) => `
    <article class="card">
      <form class="admin-market-form form-grid" data-market="${escapeHtml(market.market)}">
        <div class="row"><h3>${escapeHtml(market.market)}</h3><span class="pill">${market.max_slots} slots</span></div>
        <label>Market job cap<input name="max_slots" type="number" value="${escapeHtml(market.max_slots)}" /></label>
        <button class="primary" type="submit">Save cap</button>
      </form>
    </article>
  `).join("")}</div>`;
}

function bindSystem() {
  $("#systemSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await api("/api/system/settings", {
        method: "PATCH",
        body: {
          autopilot_verify_enabled: formData.get("autopilot_verify_enabled") === "on",
          autopilot_verify_minutes: formData.get("autopilot_verify_minutes"),
          autopilot_license_enabled: formData.get("autopilot_license_enabled") === "on",
          autopilot_license_minutes: formData.get("autopilot_license_minutes"),
          update_lockdown_enabled: formData.get("update_lockdown_enabled") === "on",
          update_lockdown_message: formData.get("update_lockdown_message"),
        },
      });
      toast("System settings saved");
      await loadAppData("system");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
}

function bindIndeedAdmin() {
  $$("[data-indeed-application-filter]").forEach((button) => button.addEventListener("click", () => {
    state.indeedApplicationFilter = button.dataset.indeedApplicationFilter;
    render();
  }));
  $$("[data-indeed-application-status]").forEach((button) => button.addEventListener("click", async () => {
    const form = button.closest(".indeed-application-review-form");
    if (!form) return;
    try {
      await api(`/api/indeed-admin/applications/${form.dataset.applicationId}`, {
        method: "PATCH",
        body: {
          status: button.dataset.indeedApplicationStatus,
          reviewer_notes: new FormData(form).get("reviewer_notes") || "",
        },
      });
      toast("Application updated");
      await loadAppData("indeed-admin");
      await loadSession();
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function applyAdminUserSearch() {
  const query = String(state.adminSearch || "").trim().toLowerCase();
  const cards = $$("[data-admin-user-card]");
  let visible = 0;
  cards.forEach((card) => {
    const match = !query || String(card.dataset.adminSearch || "").includes(query);
    card.classList.toggle("search-hidden", !match);
    if (match) visible += 1;
  });
  const count = $("[data-admin-search-count]");
  if (count) count.textContent = `${visible} of ${cards.length} accounts`;
  const empty = $("[data-admin-search-empty]");
  empty?.classList.toggle("search-hidden", visible > 0);
  $("[data-clear-admin-search]")?.toggleAttribute("disabled", !query);
}

function bindAdmin() {
  const searchInput = $("[data-admin-account-search]");
  searchInput?.addEventListener("input", (event) => {
    state.adminSearch = event.currentTarget.value;
    applyAdminUserSearch();
  });
  $("[data-clear-admin-search]")?.addEventListener("click", () => {
    state.adminSearch = "";
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    applyAdminUserSearch();
  });
  $$(".referral-deposit-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/referrals/${form.dataset.referralId}/deposit`, {
        method: "POST",
        body: Object.fromEntries(new FormData(form).entries()),
      });
      toast("Referral cash deposited");
      await loadAppData("admin");
      await loadSession();
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => {
    state.adminTab = button.dataset.adminTab;
    state.adminAccountId = null;
    render();
  }));
  $$("[data-admin-application-filter]").forEach((button) => button.addEventListener("click", () => {
    state.adminApplicationFilter = button.dataset.adminApplicationFilter;
    render();
  }));
  $$("[data-admin-application-status]").forEach((button) => button.addEventListener("click", async () => {
    const form = button.closest(".admin-application-review-form");
    if (!form) return;
    try {
      await api(`/api/admin/department-applications/${form.dataset.applicationId}`, {
        method: "PATCH",
        body: {
          status: button.dataset.adminApplicationStatus,
          reviewer_notes: new FormData(form).get("reviewer_notes") || "",
        },
      });
      toast("Application updated");
      await loadAppData("admin");
      await loadSession();
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-open-admin-account]").forEach((button) => button.addEventListener("click", () => {
    state.adminAccountId = button.dataset.openAdminAccount;
    render();
  }));
  $$("[data-close-admin-account]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.currentTarget.classList?.contains("modal-backdrop") && event.target !== event.currentTarget) return;
    state.adminAccountId = null;
    render();
  }));
  $$(".admin-user-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const roles = formData.getAll("roles");
    try {
      await api(`/api/admin/users/${form.dataset.userId}`, {
        method: "PATCH",
        body: {
          verified: formData.get("verified") === "on",
          primary_agency: formData.get("primary_agency"),
          roles,
          unlock_name_changes: formData.get("unlock_name_changes") === "on",
        },
      });
      toast("User saved");
      await loadAppData("admin");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".admin-password-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");
    if (password !== confirmPassword) {
      toast("Passwords do not match");
      return;
    }
    try {
      await api(`/api/admin/users/${form.dataset.userId}`, {
        method: "PATCH",
        body: { password },
      });
      form.reset();
      toast("Password reset");
      await loadAppData("admin");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-delete-admin-user]").forEach((button) => button.addEventListener("click", async () => {
    const name = button.dataset.deleteName || "this account";
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${button.dataset.deleteAdminUser}`, { method: "DELETE" });
      state.adminAccountId = null;
      toast("Account deleted");
      await loadAppData("admin");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".admin-job-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      await api(`/api/admin/jobs/${form.dataset.jobId}`, {
        method: "PATCH",
        body: {
          rate_per_hour: formData.get("rate_per_hour"),
          max_positions: formData.get("max_positions"),
          required_minutes_daily: formData.get("required_minutes_daily"),
          requirement: formData.get("requirement"),
          active: formData.get("active") === "on",
        },
      });
      toast("Job saved");
      await loadAppData("admin");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".admin-market-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/markets/${encodeURIComponent(form.dataset.market)}`, {
        method: "PATCH",
        body: Object.fromEntries(new FormData(form).entries()),
      });
      toast("Market cap saved");
      await loadAppData("admin");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

async function heartbeat() {
  if (!state.session?.user) return;
  try {
    await api("/api/presence", { method: "POST" });
  } catch {
    return;
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker?.register("/service-worker.js?v=0.1.1-ops2").catch(() => {}));
}

bootApp();

setInterval(heartbeat, 60_000);
setTimeout(heartbeat, 4_000);
