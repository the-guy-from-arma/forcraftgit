const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const app = $("#app");
const toastEl = $("#toast");

const state = {
  authMode: "login",
  session: null,
  activeApp: null,
  pendingArmaCode: new URL(window.location.href).searchParams.get("code") || "",
  dmvTab: "overview",
  mdtTab: "search",
  mdtNavOpen: false,
  mdtSideOpen: false,
  mdtCatalogOpen: false,
  mdtCatalogMode: "citation",
  mdtSelectedCiv: "",
  mdtSelectedChargeId: "",
  mdtReportAlertId: "",
  mdtNotice: null,
  cidSelectedCaseId: null,
  cidWarrantModalId: null,
  mdtProfileUserId: null,
  mdtProfileTab: "profile",
  courtTab: "mine",
  contractsTab: "open",
  contractsInfoOpen: false,
  contractProofId: null,
  businessTab: "apply",
  adminTab: "users",
  adminAccountId: null,
  dmvCountdownTimer: null,
  dmvCountdownRefreshing: false,
  cache: {},
};

const iconSvg = {
  "id-card": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4M7 16c.6-1 3.4-1 4 0"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2M3 12h18M12 12v2"/></svg>',
  gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m14 13-7 7M8 7l6 6M5 10l5-5M12 3l5 5M16 12l5 5M14 15l5-5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 10 9-6 9 6Z"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 19h18"/></svg>',
  store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 10h16l-1-5H5Z"/><path d="M5 10v10h14V10"/><path d="M8 20v-6h8v6"/><path d="M4 10c0 2 3 2 4 0 1 2 5 2 6 0 1 2 4 2 6 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M16 11l2 2 4-5"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-5"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8.5 14.5A4.5 4.5 0 1 0 17 12c0-3-2-5-5-8-.5 3-2 4.5-3.5 6S6 12.7 8.5 14.5Z"/><path d="M12 22a4 4 0 0 0 4-4c0-1.8-1-3.3-3-5-.3 1.8-1.3 2.7-2.2 3.5-.8.8-1.3 1.5-1.3 2.5A2.5 2.5 0 0 0 12 22Z"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  scroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 21h9a3 3 0 0 0 3-3V5a2 2 0 0 0-2-2H7a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h1Z"/><path d="M8 21a3 3 0 0 1-3-3V7h13"/><path d="M9 11h6M9 15h5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V22a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 18l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 17l5-5-5-5M15 12H3M21 3v18"/></svg>',
};

const tileColors = {
  profile: "linear-gradient(145deg, #7ee7ff, #276a88)",
  dmv: "linear-gradient(145deg, #4ecdc4, #1b6d69)",
  jobs: "linear-gradient(145deg, #f7b733, #704811)",
  court: "linear-gradient(145deg, #b78cff, #4f3175)",
  properties: "linear-gradient(145deg, #28d17c, #17623d)",
  cash: "linear-gradient(145deg, #f15f79, #7a1e31)",
  bank: "linear-gradient(145deg, #5c9cff, #21497e)",
  business: "linear-gradient(145deg, #58e6a5, #2457a8)",
  messages: "linear-gradient(145deg, #ffffff, #6d7779)",
  contracts: "linear-gradient(145deg, #ff5d7d, #4120a4)",
  changelog: "linear-gradient(145deg, #7ee7ff, #3158e8)",
  mdt: "linear-gradient(145deg, #28343c, #050709)",
  fire: "linear-gradient(145deg, #ff6b4a, #2d1b1b)",
  system: "linear-gradient(145deg, #35e0b6, #22485c)",
  admin: "linear-gradient(145deg, #ffcf5a, #6c5010)",
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
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function loadSession() {
  state.session = await api("/api/session");
  if (state.session?.user && state.pendingArmaCode && !state.activeApp) {
    state.activeApp = "profile";
    await loadAppData("profile");
  }
  render();
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
  if (state.activeApp === "mdt" || state.activeApp === "fire") {
    app.innerHTML = state.activeApp === "fire" ? renderFireWorkspace() : renderMdtWorkspace();
    state.activeApp === "fire" ? bindFireWorkspace() : bindMdtWorkspace();
    return;
  }
  if (state.activeApp) {
    app.innerHTML = phone(renderHome() + renderPanel(state.activeApp));
    bindHome();
    bindPanel();
    return;
  }
  app.innerHTML = phone(renderHome());
  bindHome();
}

function renderAuth() {
  const register = state.authMode === "register";
  return `
    <section class="auth-card">
      <div class="brand-lockup">
        <div class="app-mark">RP</div>
        <div>
          <p class="eyebrow">Roleplay PWA</p>
          <h1>Command phone</h1>
        </div>
      </div>
      <div class="auth-tabs">
        <button class="${!register ? "active" : ""}" data-auth-mode="login">Sign in</button>
        <button class="${register ? "active" : ""}" data-auth-mode="register">Register</button>
      </div>
      <form id="authForm" class="form-grid">
        ${register ? `<label>Name<input name="name" autocomplete="name" required /></label>` : ""}
        ${register ? `<label>Arma ID<input name="arma_id" autocomplete="off" required /></label>` : ""}
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

function renderHome() {
  const { user, apps, unread_messages: unread } = state.session;
  const locked = !user.verified && !user.roles.includes("owner") && !user.roles.includes("admin");
  return `
    <section class="home-stack">
      <header class="home-header">
        <div>
          <p class="eyebrow">${user.primary_agency || (user.verified ? "Civilian" : "Unverified civilian")}</p>
          <h1>${escapeHtml(user.name.split(" ")[0] || user.name)}</h1>
        </div>
        <button class="icon-action" data-logout aria-label="Sign out">${iconSvg.logout}</button>
      </header>
      <div class="user-chip"><span class="user-dot ${locked ? "" : "ok"}"></span>${locked ? "Waiting on verification" : "Verified"} · CIV ${escapeHtml(user.civ_number || "pending")} · ${escapeHtml(user.roles.join(", "))}</div>
      ${locked ? `
        <div class="home-alert">
          ${iconSvg.lock}
          <div><strong>Apps locked</strong><p>An owner/admin must verify your civilian profile before the system opens.</p></div>
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
      <nav class="dock">
        ${["messages", "contracts", "dmv", "court"].map((id) => {
          const item = apps.find((appItem) => appItem.id === id);
          return item ? `<button data-open-app="${id}" ${item.enabled ? "" : "disabled"} aria-label="${id}">${iconSvg[item.icon || "settings"]}</button>` : "";
        }).join("")}
      </nav>
    </section>
  `;
}

function bindHome() {
  $$("[data-open-app]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeApp = button.dataset.openApp;
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
    dmv: "DMV",
    jobs: "Jobs",
    court: "Court",
    properties: "Properties",
    cash: "Cash App",
    bank: "Bank",
    business: "Business",
    messages: "Messages",
    contracts: "Contracts",
    changelog: "Changelog",
    mdt: "MDT CAD",
    fire: "Fire MDT",
    system: "System",
    admin: "Admin",
  };
  const body = {
    profile: renderProfile,
    dmv: renderDmv,
    jobs: renderJobs,
    court: renderCourt,
    properties: renderProperties,
    cash: renderCash,
    bank: renderBank,
    business: renderBusiness,
    messages: renderMessages,
    contracts: renderContracts,
    changelog: renderChangelog,
    mdt: renderMdt,
    fire: renderFireMdt,
    system: renderSystem,
    admin: renderAdmin,
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
    court: async () => ({ mine: await api("/api/court/my-cases") }),
    properties: () => api("/api/properties"),
    bank: () => api("/api/bank"),
    business: () => api("/api/business"),
    messages: () => api("/api/messages"),
    contracts: () => api("/api/contracts"),
    changelog: () => api("/api/changelog"),
    mdt: async () => {
      const data = {
        charges: await api("/api/mdt/charges"),
        alerts: await api("/api/mdt/alerts"),
        reports: await api("/api/mdt/reports"),
        cid: canAny("cid", "owner") ? await api("/api/cid/overview") : null,
        search: state.cache.mdt?.search || []
      };
      if (data.cid && state.mdtTab === "search" && !data.search.length) {
        state.mdtTab = "cid-command";
      }
      return data;
    },
    fire: () => api("/api/fire/overview"),
    system: () => api("/api/system/settings"),
    admin: async () => ({ overview: await api("/api/admin/overview"), users: await api("/api/admin/users"), jobs: await api("/api/admin/jobs") }),
  };
  if (loaders[id]) {
    try {
      state.cache[id] = await loaders[id]();
    } catch (error) {
      toast(error.message);
    }
  }
}

function bindPanel() {
  $("[data-close-panel]")?.addEventListener("click", async () => {
    state.activeApp = null;
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
    court: bindCourt,
    properties: bindProperties,
    cash: bindCash,
    bank: bindBank,
    business: bindBusiness,
    messages: bindMessages,
    contracts: bindContracts,
    mdt: bindMdt,
    fire: bindFireMdt,
    system: bindSystem,
    admin: bindAdmin,
  };
  binders[state.activeApp]?.();
}

function can(role) {
  return state.session?.user?.roles?.includes(role);
}

function canAny(...roles) {
  return roles.some((role) => can(role));
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
        <div><span>Registered Arma ID</span><strong>${escapeHtml(user.registered_arma_id || user.arma_id || "Not attached")}</strong></div>
        <div><span>Live Link</span><strong>${escapeHtml(link ? "Attached" : "Not attached")}</strong></div>
      </div>
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

function bindProfile() {
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
  return `
    <div class="stack">
      <div class="segmented">
        <button class="${state.dmvTab === "overview" ? "active" : ""}" data-dmv-tab="overview">Overview</button>
        <button class="${state.dmvTab === "license" ? "active" : ""}" data-dmv-tab="license">License</button>
        <button class="${state.dmvTab === "vehicles" ? "active" : ""}" data-dmv-tab="vehicles">Vehicles</button>
      </div>
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

function renderJobs() {
  const data = state.cache.jobs;
  if (!data) return `<div class="empty">Jobs loading</div>`;
  const activeIds = new Set((data.active_jobs || []).map((job) => job.id));
  return `
    <div class="stack">
      <div class="grid-2">
        <div class="metric"><span>Tracked today</span><strong>${minutes(data.income.presence_seconds_today)}m</strong></div>
        <div class="metric"><span>Eligible rate</span><strong>${money(data.income.eligible_rate_per_hour)}/h</strong></div>
      </div>
      ${(data.active_jobs || []).length ? `
        <div class="card"><h3>Current jobs</h3><div class="list">
          ${data.active_jobs.map((job) => `<div class="row"><span>${escapeHtml(job.title)}</span><span class="pill green">${money(job.rate_per_hour)}/h</span></div>`).join("")}
        </div></div>
      ` : ""}
      <div class="list">
        ${(data.jobs || []).map((job) => {
          const pct = Math.min(100, Math.round((job.filled / Math.max(job.max_positions, 1)) * 100));
          const marketPct = Math.min(100, Math.round((job.market_filled / Math.max(job.market_cap, 1)) * 100));
          return `
            <article class="job-card">
              <div class="row"><h3>${escapeHtml(job.title)}</h3><span class="pill">${escapeHtml(job.market)}</span></div>
              <p class="muted small">${escapeHtml(job.requirement)}</p>
              <div class="grid-2">
                <div><p class="small muted">Job slots ${job.filled}/${job.max_positions}</p><div class="progress"><span style="--pct:${pct}%"></span></div></div>
                <div><p class="small muted">Market cap ${job.market_filled}/${job.market_cap}</p><div class="progress"><span style="--pct:${marketPct}%"></span></div></div>
              </div>
              <div class="row">
                <strong>${money(job.rate_per_hour)}/hour</strong>
                <button class="secondary" data-apply-job="${job.id}" ${activeIds.has(job.id) ? "disabled" : ""}>${activeIds.has(job.id) ? "Added" : "Apply"}</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function bindJobs() {
  $$("[data-apply-job]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/jobs/${button.dataset.applyJob}/apply`, { method: "POST" });
        toast("Job added");
        await loadAppData("jobs");
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
  return `
    <div class="stack">
      <div class="card">
        <p class="eyebrow">Available balance</p>
        <div class="money">${money(data.balance)}</div>
        <p class="muted small">${money(data.income.pending_income)} passive income ready · ${money(data.income.eligible_rate_per_hour)}/h eligible</p>
        <button class="primary" data-collect-income>Collect income</button>
      </div>
      <div class="grid-2">
        <div class="metric"><span>Cash wallet</span><strong>${money(data.cash)}</strong></div>
        <div class="metric"><span>Server time</span><strong>${minutes(data.income.presence_seconds_today)}m</strong></div>
      </div>
      <div class="card">
        <h3>Daily requirements</h3>
        <div class="list">
          ${(data.income.requirements || []).map((req) => `
            <div class="row"><span>${escapeHtml(req.title)}</span><span class="pill ${req.met ? "green" : "amber"}">${req.met ? "met" : `${req.required_minutes_daily}m`}</span></div>
          `).join("") || `<div class="empty">No active jobs</div>`}
        </div>
      </div>
      <div class="card">
        <h3>Activity</h3>
        <div class="list">${(data.transactions || []).map((tx) => `
          <div class="row"><span>${escapeHtml(tx.description)}</span><strong>${money(tx.amount)}</strong></div>
        `).join("") || `<div class="empty">No transactions yet</div>`}</div>
      </div>
    </div>
  `;
}

function bindBank() {
  $("[data-collect-income]")?.addEventListener("click", async () => {
    try {
      const result = await api("/api/bank/collect", { method: "POST" });
      toast(`Collected ${money(result.collected)}`);
      await loadAppData("bank");
      await loadSession();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderCash() {
  return `
    <div class="stack">
      <div class="card">
        <p class="eyebrow">Peer transfer</p>
        <div class="money">${money(state.session.user.bank_balance)}</div>
      </div>
      <form id="cashForm" class="card form-grid">
        <label>Recipient email<input name="recipient_email" type="email" required /></label>
        <label>Amount<input name="amount" type="number" min="1" step="0.01" required /></label>
        <label>Note<input name="note" maxlength="120" /></label>
        <button class="primary" type="submit">Send payment</button>
      </form>
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
  return `
    <div class="stack">
      <div class="list">
        ${businesses.map((item) => renderBusinessLicenseCard(item, false, data)).join("") || `<div class="empty">No approved business licenses yet</div>`}
      </div>
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
  return `
    <div class="list">
      ${queue.map((item) => renderBusinessApplicationCard(item, true, data)).join("") || `<div class="empty">No applications are waiting on review</div>`}
    </div>
  `;
}

function renderBusinessRegistry(data) {
  const businesses = data.all_businesses || [];
  return `
    <div class="stack">
      <div class="list">
        ${businesses.map((item) => renderBusinessLicenseCard(item, true, data)).join("") || `<div class="empty">No business licenses issued yet</div>`}
      </div>
      ${renderBusinessLedger("Recent Inspections", data.staff_inspections || [], "inspection")}
      ${renderBusinessLedger("Recent Violations", data.staff_violations || [], "violation")}
    </div>
  `;
}

function renderBusinessApplicationCard(item, review, data) {
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

function renderCourt() {
  const data = state.cache.court?.mine || {};
  const isOfficer = canAny("leo", "cid", "owner");
  const isJudge = canAny("judge", "owner");
  const tabs = [
    ["defendant-active", "Active"],
    ["defendant-previous", "Previous"],
    ...(isOfficer ? [["officer-active", "Officer Active"], ["officer-previous", "Officer Previous"]] : []),
    ...(isJudge ? [["judge-active", "Judge Docket"], ["judge-previous", "Judge Previous"]] : []),
  ];
  if (!tabs.some(([id]) => id === state.courtTab)) state.courtTab = "defendant-active";
  const tabData = {
    "defendant-active": data.defendant?.active || [],
    "defendant-previous": data.defendant?.previous || [],
    "officer-active": data.officer?.active || [],
    "officer-previous": data.officer?.previous || [],
    "judge-active": data.judge?.active || [],
    "judge-previous": data.judge?.previous || [],
  };
  const previous = state.courtTab.includes("previous");
  const judgeTab = state.courtTab.startsWith("judge");
  const defendantTab = state.courtTab.startsWith("defendant");
  return `
    <div class="stack">
      <div class="court-tabs">
        ${tabs.map(([id, label]) => `<button class="${state.courtTab === id ? "active" : ""}" data-court-tab="${id}">${label}</button>`).join("")}
      </div>
      ${judgeTab ? renderJudgeCases(tabData[state.courtTab], previous) : renderCaseList(tabData[state.courtTab], { previous, defendant: defendantTab })}
    </div>
  `;
}

function renderCaseList(cases, options = {}) {
  const previous = Boolean(options.previous);
  const defendant = Boolean(options.defendant);
  return `
    <div class="list">
      ${cases.map((item) => `
        <article class="case-card">
          <div class="row"><h3>${escapeHtml(item.charge_code)} - ${escapeHtml(item.charge_title)}</h3><span class="pill ${["paid", "dismissed", "closed"].includes(item.status) ? "green" : item.status === "contested" ? "amber" : "red"}">${escapeHtml(item.status)}</span></div>
          <p class="muted small">Defendant ${escapeHtml(item.civ_name || "You")} - Officer ${escapeHtml(item.officer_name)} - Judge ${escapeHtml(item.judge_name || "Pending assignment")} - ${money(item.fine_amount)}</p>
          <p class="muted small">${escapeHtml(item.location)} - Court ${escapeHtml(item.court_date || "Pending")}</p>
          <p>${escapeHtml(item.narrative)}</p>
          ${previous ? `<div class="metric"><span>Final result</span><strong>${escapeHtml(item.final_result || item.judgment_notes || item.status)}</strong></div>` : ""}
          ${defendant && !previous ? `<div class="row">
            <button class="secondary" data-contest-case="${item.id}" ${["paid", "dismissed", "contested", "closed"].includes(item.status) ? "disabled" : ""}>Contest</button>
            <button class="primary" data-pay-case="${item.id}" ${["paid", "dismissed", "closed"].includes(item.status) ? "disabled" : ""}>Pay fine</button>
          </div>` : ""}
        </article>
      `).join("") || `<div class="empty">No cases at this time</div>`}
    </div>
  `;
}

function renderJudgeCases(cases, previous = false) {
  return `
    <div class="list">
      ${cases.map((item) => `
        <article class="case-card">
          <div class="row"><h3>#${item.id} ${escapeHtml(item.charge_code)}</h3><span class="pill ${["paid", "dismissed", "closed"].includes(item.status) ? "green" : item.status === "contested" ? "amber" : "red"}">${escapeHtml(item.status)}</span></div>
          <p class="muted small">Defendant ${escapeHtml(item.civ_name)} - ${escapeHtml(item.civ_email)} - Officer ${escapeHtml(item.officer_name)} - Presiding ${escapeHtml(item.judge_name || "Unassigned")}</p>
          <p><strong>${escapeHtml(item.charge_title)}</strong> - ${money(item.fine_amount)}</p>
          <p>${escapeHtml(item.narrative)}</p>
          ${previous ? `<div class="metric"><span>Final result</span><strong>${escapeHtml(item.final_result || item.judgment_notes || item.status)}</strong></div>` : `<form class="form-grid judge-form" data-case-id="${item.id}">
            <div class="grid-2">
              <label>Status<select name="status"><option>reviewed</option><option>reduced</option><option>dismissed</option><option>paid</option><option>contested</option><option>closed</option></select></label>
              <label>Fine<input name="fine_amount" type="number" step="0.01" value="${escapeHtml(item.fine_amount)}" /></label>
            </div>
            <label>Judgment notes<input name="judgment_notes" value="${escapeHtml(item.judgment_notes || "")}" /></label>
            <button class="primary" type="submit">Update case</button>
          </form>`}
        </article>
      `).join("") || `<div class="empty">No cases at this time</div>`}
    </div>
  `;
}

function bindCourt() {
  $$("[data-court-tab]").forEach((button) => button.addEventListener("click", () => {
    state.courtTab = button.dataset.courtTab;
    render();
  }));
  $$("[data-pay-case]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/court/my-cases/${button.dataset.payCase}/pay`, { method: "POST" });
      toast("Fine paid");
      await loadAppData("court");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-contest-case]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/court/my-cases/${button.dataset.contestCase}/contest`, { method: "POST" });
      toast("Case contested");
      await loadAppData("court");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
  $$(".judge-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/court/cases/${form.dataset.caseId}`, { method: "PATCH", body: Object.fromEntries(new FormData(form).entries()) });
      toast("Case updated");
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
  return `
    <form id="mdtSearch" class="card form-grid">
      <label>Name, email, or plate<input name="q" minlength="2" required /></label>
      <button class="primary" type="submit">Search NCIC</button>
    </form>
    <div class="list">
      ${results.map((item) => `
        <article class="record-card">
          <div class="row"><h3>${escapeHtml(item.name)}</h3><span class="pill ${item.verified ? "green" : "amber"}">${item.verified ? "verified" : "unverified"}</span></div>
          <p class="muted small">${escapeHtml(item.email)} · ${escapeHtml(item.plate || "No plate")}</p>
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
  const cid = state.cache.mdt?.cid;
  const cidEnabled = canAny("cid", "owner");
  if (!cidEnabled && String(state.mdtTab || "").startsWith("cid-")) {
    state.mdtTab = "search";
  }
  const priorityCases = (cid?.investigations || []).filter((item) => ["critical", "elevated"].includes(item.priority));
  const cidWarrantModal = cidEnabled && state.cidWarrantModalId
    ? renderCidWarrantModal((cid?.warrants || []).find((item) => String(item.id) === String(state.cidWarrantModalId)))
    : "";
  const navItems = cidEnabled ? [
    ["cid-command", "CID Command"],
    ["search", "NCIC / DMV"],
    ["cid-investigations", "Case Folders"],
    ["cid-warrants", "Warrant Ops"],
    ["cid-ia", "Internal Affairs"],
    ["cad-reports", "Reports"],
    ["ticket", "Issue"],
    ["criminal", "Criminal"],
    ["citations", "Citations"],
    ["panic", "Panic"],
  ] : [
    ["search", "NCIC / DMV"],
    ["cad-reports", "Reports"],
    ["ticket", "Issue"],
    ["citations", "Citations"],
    ["criminal", "Criminal"],
    ["panic", "Panic"],
  ];
  return `
    <section class="mdt-workspace ${cidEnabled ? "cid-workspace" : ""}">
      <header class="mdt-topbar">
        <div>
          <p class="eyebrow">${escapeHtml(state.session.user.primary_agency || (cidEnabled ? "CID Command" : "Law Enforcement"))}</p>
          <h1>${cidEnabled ? "CID Command MDT" : "Mobile Data Terminal"}</h1>
          ${cidEnabled ? `<p class="mdt-subtitle">Investigations / warrants / intelligence / internal affairs</p>` : ""}
        </div>
        <div class="mdt-top-actions">
          <button class="ghost mdt-mobile-action" data-open-mdt-nav>Menu</button>
          <button class="ghost mdt-mobile-action" data-open-mdt-side>Watch</button>
          <button class="ghost" data-refresh-mdt>Refresh</button>
          <button class="secondary" data-close-mdt>Exit MDT</button>
        </div>
      </header>
      <div class="mdt-stat-strip ${cidEnabled ? "cid-stat-strip" : ""}">
        ${cidEnabled ? `
          <div class="metric"><span>Case folders</span><strong>${cid?.stats?.open_investigations || 0}</strong></div>
          <div class="metric"><span>Priority watch</span><strong>${priorityCases.length}</strong></div>
          <div class="metric"><span>Active warrants</span><strong>${cid?.stats?.active_warrants || 0}</strong></div>
          <div class="metric"><span>IA open</span><strong>${cid?.stats?.ia_open || 0}</strong></div>
        ` : `
          <div class="metric"><span>Citations</span><strong>${(charges.citations || []).length}</strong></div>
          <div class="metric"><span>Criminal Codes</span><strong>${(charges.criminal_charges || []).length}</strong></div>
          <div class="metric"><span>Active Alerts</span><strong>${alerts.filter((alert) => alert.status === "active").length}</strong></div>
        `}
      </div>
      <div class="mdt-layout">
        <aside class="mdt-nav ${state.mdtNavOpen ? "open" : ""}">
          <div class="mdt-drawer-head"><strong>MDT Menu</strong><button class="icon-action" data-close-mdt-drawers aria-label="Close">x</button></div>
          ${navItems.map(([id, label]) => `<button class="${state.mdtTab === id ? "active" : ""}" data-mdt-tab="${id}">${label}</button>`).join("")}
        </aside>
        <main class="mdt-main">${renderMdtContent()}</main>
        <aside class="mdt-side ${state.mdtSideOpen ? "open" : ""}">
          <div class="mdt-drawer-head"><strong>Watch Panel</strong><button class="icon-action" data-close-mdt-drawers aria-label="Close">x</button></div>
          ${renderMdtSide()}
        </aside>
      </div>
      ${(state.mdtNavOpen || state.mdtSideOpen) ? `<button class="mdt-drawer-backdrop" data-close-mdt-drawers aria-label="Close MDT drawer"></button>` : ""}
      ${state.mdtCatalogOpen ? renderMdtCatalogModal() : ""}
      ${state.mdtNotice ? renderMdtNoticeModal() : ""}
      ${state.mdtProfileUserId ? renderMdtProfileModal() : ""}
      ${cidWarrantModal}
    </section>
  `;
}

function bindMdtWorkspace() {
  $("[data-close-mdt]")?.addEventListener("click", async () => {
    state.activeApp = null;
    state.mdtCatalogOpen = false;
    state.mdtNavOpen = false;
    state.mdtSideOpen = false;
    await loadSession();
  });
  $("[data-open-mdt-nav]")?.addEventListener("click", () => {
    state.mdtNavOpen = true;
    state.mdtSideOpen = false;
    render();
  });
  $("[data-open-mdt-side]")?.addEventListener("click", () => {
    state.mdtSideOpen = true;
    state.mdtNavOpen = false;
    render();
  });
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

function renderFireRigAssignments(data) {
  const rigs = data.rigs || [];
  const personnel = data.personnel || [];
  const canManage = Boolean(data.can_manage_rigs);
  return `
    <section class="fire-rig-panel">
      <div class="mdt-section-head">
        <div><p class="eyebrow">Fire command</p><h2>Rig Assignments</h2></div>
        <span class="pill ${canManage ? "green" : "amber"}">${canManage ? "Chief controls" : "Read only"}</span>
      </div>
      <div class="fire-rig-grid">
        ${rigs.map((rig) => `
          <article class="fire-rig-card">
            <div class="row">
              <div>
                <h3>${escapeHtml(rig.rig_name)}</h3>
                <p class="muted small">${escapeHtml(rig.assigned_name || "Unassigned")} ${rig.assigned_civ_number ? `- CIV ${escapeHtml(rig.assigned_civ_number)}` : ""}</p>
              </div>
              <span class="pill ${rig.status === "assigned" ? "green" : rig.status === "out_of_service" ? "red" : "amber"}">${escapeHtml(rig.status || "available")}</span>
            </div>
            ${canManage ? `
              <form class="fire-rig-form form-grid" data-rig-name="${escapeHtml(rig.rig_name)}">
                <label>Assigned member<select name="user_id">
                  <option value="">Unassigned</option>
                  ${personnel.map((person) => `<option value="${person.id}"${selectedAttr(person.id, rig.user_id)}>${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")}</option>`).join("")}
                </select></label>
                <div class="grid-2">
                  <label>Position<select name="position">
                    ${renderOptions(["Officer", "Driver", "Firefighter", "Medic", "Engineer"], rig.position || "Firefighter")}
                  </select></label>
                  <label>Status<select name="status">
                    ${renderOptions(["available", "assigned", "out_of_service"], rig.status || "available")}
                  </select></label>
                </div>
                <label>Notes<input name="notes" value="${escapeHtml(rig.notes || "")}" placeholder="Crew notes or special assignment" /></label>
                <button class="primary" type="submit">Save ${escapeHtml(rig.rig_name)}</button>
              </form>
            ` : `<p class="muted small">${escapeHtml(rig.position || "Firefighter")} ${rig.notes ? `- ${escapeHtml(rig.notes)}` : ""}</p>`}
          </article>
        `).join("") || `<div class="empty">No rigs configured</div>`}
      </div>
    </section>
  `;
}

function renderFireWorkspace() {
  const data = state.cache.fire || {};
  const alerts = data.alerts || [];
  const stats = data.stats || { active: 0, responding: 0, cleared: 0 };
  return `
    <section class="mdt-workspace fire-workspace">
      <header class="mdt-topbar">
        <div>
          <p class="eyebrow">${escapeHtml(state.session.user.primary_agency || "Fire Department")}</p>
          <h1>Fire Department MDT</h1>
        </div>
        <div class="mdt-top-actions">
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
      await loadAppData("fire");
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
      await loadAppData("fire");
      render();
    } catch (error) {
      toast(error.message);
    }
  }));
}

function renderMdt() {
  return `<div class="mdt-shell">${renderMdtContent()}</div>`;
}

function renderMdtContent() {
  if (state.mdtTab === "cid-command") return renderCidCommandCenter();
  if (state.mdtTab === "cid-investigations") return renderCidInvestigations();
  if (state.mdtTab === "cid-warrants") return renderCidWarrants();
  if (state.mdtTab === "cid-ia") return renderCidInternalAffairs();
  if (state.mdtTab === "cad-reports") return renderCadReports();
  if (state.mdtTab === "ticket") return renderTicketWriter();
  if (state.mdtTab === "citations") return renderCodeSection("citation");
  if (state.mdtTab === "criminal") return renderCodeSection("criminal");
  if (state.mdtTab === "panic") return renderPanic();
  return renderMdtSearch();
}

function renderCidCommandCenter() {
  const cid = state.cache.mdt?.cid || {};
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
          <p class="eyebrow">CID operations center</p>
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
              <button type="button" class="cid-mini-case ia" data-mdt-tab="cid-ia">
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
  const alerts = state.cache.mdt?.alerts?.alerts || [];
  const reports = state.cache.mdt?.reports?.reports || [];
  const issued = state.cache.mdt?.search?.flatMap((person) => person.open_cases || []) || [];
  const cid = state.cache.mdt?.cid;
  const priorityCases = (cid?.investigations || []).filter((item) => ["critical", "elevated"].includes(item.priority));
  const activeWarrants = (cid?.warrants || []).filter((item) => item.status === "active");
  return `
    ${cid ? `
      <div class="mdt-side-panel cid-side-panel">
        <h3>CID Command Tracker</h3>
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
    <div class="mdt-side-panel">
      <h3>Watch</h3>
      <div class="list compact-list">
        ${alerts.slice(0, 5).map((alert) => `<div class="row"><span>${escapeHtml(alert.officer_name)}</span><span class="pill ${panicStatusClass(alert.status)}">${escapeHtml(alert.status)}</span></div>`).join("") || `<p class="muted small">No active panic traffic</p>`}
      </div>
    </div>
    <div class="mdt-side-panel">
      <h3>Recent Reports</h3>
      <div class="list compact-list">
        ${reports.slice(0, 5).map((report) => `<button class="cid-side-link" data-mdt-tab="cad-reports"><strong>${escapeHtml(report.report_number)}</strong><span>${escapeHtml(report.call_type)} / ${escapeHtml(report.disposition)}</span></button>`).join("") || `<p class="muted small">No after-call reports filed</p>`}
      </div>
    </div>
    <div class="mdt-side-panel">
      <h3>Open Returns</h3>
      <div class="list compact-list">
        ${issued.slice(0, 5).map((item) => `<div class="row"><span>${escapeHtml(item.charge_code)}</span><strong>${money(item.fine_amount)}</strong></div>`).join("") || `<p class="muted small">No NCIC open case returns</p>`}
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

function mdtStatusClass(status) {
  if (["Valid", "verified", "approved", "Active"].includes(status)) return "green";
  if (["Suspended", "Revoked", "denied"].includes(status)) return "red";
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
  return `
    <form id="mdtSearch" class="mdt-searchbar">
      <input name="q" minlength="2" placeholder="Search name, email, or plate" required />
      <button class="primary" type="submit">Run NCIC</button>
    </form>
    <div class="mdt-results">
      ${results.map((item) => `
        <article class="mdt-return">
          <div class="row">
            <div><h3>${escapeHtml(item.name)}</h3><p class="muted small">CIV ${escapeHtml(item.civ_number || "pending")} - DB #${item.id} - ${escapeHtml(item.email)}</p></div>
            <span class="pill ${item.verified ? "green" : "amber"}">${item.verified ? "verified" : "unverified"}</span>
          </div>
          <div class="mdt-return-grid">
            <div class="metric"><span>License</span><strong>${escapeHtml(item.license_status || "None")}</strong></div>
            <div class="metric"><span>Class</span><strong>${escapeHtml(item.license_class || "None")}</strong></div>
            <div class="metric"><span>Primary Plate</span><strong>${escapeHtml(item.plate || "None")}</strong></div>
            <div class="metric"><span>Insurance</span><strong>${escapeHtml(item.insurance_status || "None")}</strong></div>
          </div>
          <div class="mdt-subsection">
            <div class="row"><h4>Registered vehicles</h4><div class="row-actions"><button class="secondary" data-open-mdt-profile="${item.id}">Open profile</button><button class="secondary" data-use-civ="${item.id}">Use for ticket</button></div></div>
            ${(item.vehicles || []).map((vehicle) => `<p class="small">${escapeHtml(vehicle.vehicle_year)} ${escapeHtml(vehicle.vehicle_color)} ${escapeHtml(vehicle.vehicle_make)} ${escapeHtml(vehicle.vehicle_model)} - ${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.registration_status)}</p>`).join("") || `<p class="muted small">No registered vehicles on file</p>`}
          </div>
          <div class="mdt-subsection">
            <h4>Open court/citation returns</h4>
            ${(item.open_cases || []).map((c) => `<div class="row"><span>${escapeHtml(c.charge_code)} ${escapeHtml(c.charge_title)}</span><strong>${money(c.fine_amount)}</strong></div>`).join("") || `<p class="muted small">No open citations</p>`}
          </div>
        </article>
      `).join("") || `<div class="empty">Run a search to pull DMV and case records</div>`}
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
  const activeWarrants = warrants.filter((item) => ["active", "pending"].includes(item.status));
  const previousWarrants = warrants.filter((item) => !["active", "pending"].includes(item.status));
  const licenseStatus = person.license_status || "None";
  const canSuspendLicense = licenseStatus === "Valid";
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
        </div>
        <div class="admin-account-scroll">
          ${state.mdtProfileTab === "warrants" ? `
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
                <div class="metric"><span>Email</span><strong>${escapeHtml(person.email)}</strong></div>
                <div class="metric"><span>Roles</span><strong>${escapeHtml((person.roles || []).join(", ") || "civ")}</strong></div>
                <div class="metric"><span>License</span><strong>${escapeHtml(licenseStatus)}</strong></div>
                <div class="metric"><span>Open cases</span><strong>${(person.open_cases || []).length}</strong></div>
              </div>
              <div class="mdt-subsection">
                <div class="row"><h4>Registered vehicles</h4><button class="secondary" data-use-civ="${person.id}">Use for ticket</button></div>
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

function renderTicketWriter() {
  const charges = getMdtCatalog(state.mdtCatalogMode);
  const civilians = getMdtCivilians();
  const criminalMode = state.mdtCatalogMode === "criminal";
  const defaultCourt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `
    <form id="ticketForm" class="mdt-form ${criminalMode ? "charge-warrant-form" : ""}">
      <div class="mdt-section-head">
        <div><p class="eyebrow">${criminalMode ? "Criminal warrant writer" : "Citation writer"}</p><h2>Issue ${criminalMode ? "Criminal Charge" : "Citation"}</h2></div>
        <button class="secondary" type="button" data-open-catalog>Browse codes</button>
      </div>
      <div class="segmented mdt-code-switch">
        <button type="button" class="${state.mdtCatalogMode === "citation" ? "active" : ""}" data-catalog-mode="citation">Citations</button>
        <button type="button" class="${state.mdtCatalogMode === "criminal" ? "active" : ""}" data-catalog-mode="criminal">Criminal</button>
        <button type="button" data-open-catalog>Catalog</button>
      </div>
      <div class="grid-2">
        <label>${criminalMode ? "Subject civilian" : "Civilian"}<select name="civ_id" required data-issue-subject>
          <option value="">Select civilian record</option>
          ${civilians.map((person) => `<option value="${person.id}" data-name="${escapeHtml(person.name)}"${selectedAttr(person.id, state.mdtSelectedCiv)}>${escapeHtml(person.name)} - CIV ${escapeHtml(person.civ_number || "pending")} - ${escapeHtml(person.license_status || "No license")}</option>`).join("")}
        </select></label>
        <label>Court date<input name="court_date" type="date" value="${defaultCourt}" /></label>
      </div>
      <label>Code<select name="charge_id" required>
        ${charges.map((charge) => `<option value="${charge.id}"${selectedAttr(charge.id, state.mdtSelectedChargeId)}>${escapeHtml(charge.code)} - ${escapeHtml(charge.title)} - ${money(charge.fine_amount)}</option>`).join("")}
      </select></label>
      <label>Location<input name="location" placeholder="Street, postal, landmark" required /></label>
      ${criminalMode ? `
        <label>Probable cause<textarea name="probable_cause" required placeholder="Facts supporting the criminal charge and warrant"></textarea></label>
        <section class="mdt-subsection bypass-court-section">
          <div class="row"><h4>Bypass court</h4><span class="pill amber">Optional</span></div>
          <label class="check-row"><input type="checkbox" name="bypass_court" /> Bypass court docket and issue warrant only</label>
          <p class="muted small">Unchecked creates a court case and an active warrant. Checked creates the active warrant only and links it directly to the selected account.</p>
        </section>
        <label>Operation plan<textarea name="operation_plan" placeholder="Optional service plan, unit notes, or transport instructions"></textarea></label>
        <button class="danger" type="submit">Sign and issue warrant</button>
      ` : `
        <label>Narrative<textarea name="narrative" required></textarea></label>
        <button class="primary" type="submit">Submit to court queue</button>
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

function renderCodeSection(kind) {
  const rows = getMdtCatalog(kind);
  return `
    <div class="mdt-section-head">
      <div><p class="eyebrow">${kind === "citation" ? "Traffic and civil" : "Criminal"} catalog</p><h2>${kind === "citation" ? "Citation Codes" : "Criminal Charges"}</h2></div>
      <button class="secondary" data-open-catalog data-catalog-kind="${kind}">Open catalog</button>
    </div>
    <div class="mdt-code-grid">
      ${rows.map((charge) => `
        <article class="charge-card mdt-code-card">
          <div class="row"><strong>${escapeHtml(charge.code)}</strong><span class="pill">${escapeHtml(charge.severity)}</span></div>
          <h3>${escapeHtml(charge.title)}</h3>
          <p class="muted small">${escapeHtml(charge.category)} - ${money(charge.fine_amount)} - ${charge.points} pts</p>
          <p>${escapeHtml(charge.description)}</p>
          ${kind === "criminal" ? `<button class="secondary" type="button" data-select-criminal-charge="${charge.id}">Use charge</button>` : ""}
        </article>
      `).join("") || `<div class="empty">No ${kind} codes loaded</div>`}
    </div>
  `;
}

function renderMdtCatalogModal() {
  const rows = getMdtCatalog(state.mdtCatalogMode);
  return `
    <div class="modal-backdrop" data-close-catalog>
      <section class="mdt-modal" role="dialog" aria-modal="true">
        <header class="row">
          <div><p class="eyebrow">Code catalog</p><h2>${state.mdtCatalogMode === "citation" ? "Citation Codes" : "Criminal Charges"}</h2></div>
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
  return `
    <div class="cid-tools">
      <form id="cidIaForm" class="cid-intake-board ia-intake-board">
        <div class="cid-intake-head">
          <div>
            <p class="eyebrow">CID internal affairs</p>
            <h2>IA Intake</h2>
            <p>${ia.length} IA records / command-level accountability tracking</p>
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
      <div class="mdt-code-grid">
        ${ia.map((item) => `
          <article class="cid-card">
            <div class="row"><div><h3>${escapeHtml(item.ia_number)} - ${escapeHtml(item.subject_name)}</h3><p class="muted small">${escapeHtml(item.allegation_type)} - assigned ${escapeHtml(item.assigned_name)}</p></div><span class="pill ${item.priority === "critical" ? "red" : item.priority === "elevated" ? "amber" : "green"}">${escapeHtml(item.status)}</span></div>
            <p>${escapeHtml(item.summary)}</p>
            <form class="cid-ia-update form-grid" data-ia-id="${item.id}">
              <div class="grid-2">
                <label>Status<select name="status"><option>intake</option><option>active</option><option>command review</option><option>sustained</option><option>unfounded</option><option>closed</option></select></label>
                <label>Priority<select name="priority"><option>standard</option><option>elevated</option><option>critical</option></select></label>
              </div>
              <button class="secondary" type="submit">Update IA</button>
            </form>
          </article>
        `).join("") || `<div class="empty">No internal affairs records</div>`}
      </div>
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

function bindMdt() {
  $$("[data-mdt-tab]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTab = button.dataset.mdtTab;
    if (button.dataset.cidOpenCase) {
      state.cidSelectedCaseId = button.dataset.cidOpenCase;
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
  $$("[data-use-civ]").forEach((button) => button.addEventListener("click", () => {
    state.mdtSelectedCiv = button.dataset.useCiv;
    state.mdtTab = "ticket";
    state.mdtProfileUserId = null;
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
  $$("[data-cid-open-case]").forEach((button) => button.addEventListener("click", () => {
    state.cidSelectedCaseId = button.dataset.cidOpenCase;
    render();
  }));
  $$("[data-cid-note-type]").forEach((button) => button.addEventListener("click", () => {
    const form = $$(".cid-note-form").find((item) => String(item.dataset.caseId) === String(button.dataset.caseId));
    const select = form?.querySelector("[name='note_type']");
    const body = form?.querySelector("[name='body']");
    if (select) select.value = button.dataset.cidNoteType;
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
        const result = await api("/api/mdt/charge-warrants", { method: "POST", body: payload });
        toast(result.bypass_court ? `Warrant ${result.warrant_number} signed - court bypassed` : `Warrant ${result.warrant_number} signed - court ${result.court_date}`);
      } else {
        const result = await api("/api/mdt/citations", { method: "POST", body: payload });
        toast(`Citation issued - court ${result.court_date}`);
      }
      event.currentTarget.reset();
      state.mdtSelectedCiv = "";
      state.mdtSelectedChargeId = "";
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
}

function renderAdmin() {
  const data = state.cache.admin;
  if (!data) return `<div class="empty">Admin loading</div>`;
  const accountModal = state.adminAccountId ? renderAdminAccountModal(data.users.users.find((user) => String(user.id) === String(state.adminAccountId))) : "";
  return `
    <div class="stack">
      <div class="grid-2">
        <div class="metric"><span>Users</span><strong>${data.overview.stats.users}</strong></div>
        <div class="metric"><span>Unverified</span><strong>${data.overview.stats.unverified}</strong></div>
        <div class="metric"><span>Active jobs</span><strong>${data.overview.stats.active_jobs}</strong></div>
        <div class="metric"><span>Open cases</span><strong>${data.overview.stats.open_cases}</strong></div>
      </div>
      <div class="segmented">
        <button class="${state.adminTab === "users" ? "active" : ""}" data-admin-tab="users">Users</button>
        <button class="${state.adminTab === "jobs" ? "active" : ""}" data-admin-tab="jobs">Jobs</button>
        <button class="${state.adminTab === "markets" ? "active" : ""}" data-admin-tab="markets">Markets</button>
      </div>
      ${state.adminTab === "jobs" ? renderAdminJobs(data.jobs.jobs) : state.adminTab === "markets" ? renderAdminMarkets(data.jobs.markets) : renderAdminUsers(data.users.users)}
    </div>
    ${accountModal}
  `;
}

function renderSystem() {
  const data = state.cache.system || {};
  const settings = data.settings || { autopilot_verify_enabled: false, autopilot_verify_minutes: 120, autopilot_license_enabled: true, autopilot_license_minutes: 6 };
  const stats = data.stats || { pending_accounts: 0, eligible_accounts: 0, pending_license_applications: 0, eligible_license_applications: 0 };
  const minutesValue = Number(settings.autopilot_verify_minutes || 120);
  const licenseMinutesValue = Number(settings.autopilot_license_minutes || 6);
  const hoursLabel = minutesValue >= 60 ? `${(minutesValue / 60).toFixed(minutesValue % 60 ? 1 : 0)} hours` : `${minutesValue} minutes`;
  const licenseLabel = licenseMinutesValue >= 60 ? `${(licenseMinutesValue / 60).toFixed(licenseMinutesValue % 60 ? 1 : 0)} hours` : `${licenseMinutesValue} minutes`;
  return `
    <div class="stack system-app">
      <section class="profile-hero system-hero">
        <div>
          <p class="eyebrow">Owner controls</p>
          <h3>System Settings</h3>
          <p>Verification autopilot is ${settings.autopilot_verify_enabled ? "enabled" : "disabled"} / Driver license autopilot is ${settings.autopilot_license_enabled ? "enabled" : "disabled"}</p>
        </div>
        <span class="pill ${settings.autopilot_license_enabled || settings.autopilot_verify_enabled ? "green" : "amber"}">${settings.autopilot_license_enabled || settings.autopilot_verify_enabled ? "auto" : "manual"}</span>
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
        <button class="primary" type="submit">Save system settings</button>
      </form>
      ${data.auto_verified_now ? `<div class="card"><h3>${data.auto_verified_now} accounts verified</h3><p class="muted small">Auto pilot processed eligible accounts on this check.</p></div>` : ""}
      ${data.auto_licensed_now ? `<div class="card"><h3>${data.auto_licensed_now} driver licenses approved</h3><p class="muted small">DMV auto pilot processed eligible license applications on this check.</p></div>` : ""}
    </div>
  `;
}

const roleOptions = ["civ", "owner", "admin", "leo", "judge", "ems", "fireman", "fire_chief", "dispatcher", "sheriff", "police", "state_police", "cid", "business_owner", "business_registrar", "city_hall", "economy_manager"];

function renderAdminUsers(users) {
  if (!users.length) return `<div class="empty">No accounts yet</div>`;
  return `<div class="list admin-account-list">${users.map((user) => `
    <article class="user-card compact-user-card">
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
  `).join("")}</div>`;
}

function renderAdminAccountModal(user) {
  if (!user) {
    return "";
  }
  const nameChange = user.name_change || { locked: false, used: 0, limit: 3, remaining: 3, window_days: 3 };
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
          <div><span>Arma ID</span><strong>${escapeHtml(user.arma_id || "Not provided")}</strong></div>
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
              ${roleOptions.map((role) => `<label class="check-row"><input type="checkbox" name="roles" value="${role}" ${user.roles.includes(role) ? "checked" : ""} /> ${role.replace("_", " ")}</label>`).join("")}
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

function bindAdmin() {
  $$("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => {
    state.adminTab = button.dataset.adminTab;
    state.adminAccountId = null;
    render();
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
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}

loadSession().catch((error) => {
  app.innerHTML = phone(`<section class="auth-card"><h1>RP Command</h1><p>${escapeHtml(error.message)}</p></section>`);
});

setInterval(heartbeat, 60_000);
setTimeout(heartbeat, 4_000);
