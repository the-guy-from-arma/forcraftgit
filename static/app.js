const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const app = $("#app");
const toastEl = $("#toast");

const state = {
  authMode: "login",
  session: null,
  activeApp: null,
  dmvTab: "overview",
  mdtTab: "search",
  mdtCatalogOpen: false,
  mdtCatalogMode: "citation",
  mdtSelectedCiv: "",
  mdtNotice: null,
  courtTab: "mine",
  adminTab: "users",
  cache: {},
};

const iconSvg = {
  "id-card": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4M7 16c.6-1 3.4-1 4 0"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2M3 12h18M12 12v2"/></svg>',
  gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m14 13-7 7M8 7l6 6M5 10l5-5M12 3l5 5M16 12l5 5M14 15l5-5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 10 9-6 9 6Z"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 19h18"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V22a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 18l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 17l5-5-5-5M15 12H3M21 3v18"/></svg>',
};

const tileColors = {
  dmv: "linear-gradient(145deg, #4ecdc4, #1b6d69)",
  jobs: "linear-gradient(145deg, #f7b733, #704811)",
  court: "linear-gradient(145deg, #b78cff, #4f3175)",
  properties: "linear-gradient(145deg, #28d17c, #17623d)",
  cash: "linear-gradient(145deg, #f15f79, #7a1e31)",
  bank: "linear-gradient(145deg, #5c9cff, #21497e)",
  messages: "linear-gradient(145deg, #ffffff, #6d7779)",
  mdt: "linear-gradient(145deg, #28343c, #050709)",
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
  if (!state.session?.user) {
    app.innerHTML = phone(renderAuth());
    bindAuth();
    return;
  }
  if (state.activeApp === "mdt") {
    app.innerHTML = renderMdtWorkspace();
    bindMdtWorkspace();
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
  const { user, apps, unread_messages: unread, income } = state.session;
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
      ` : `
        <div class="home-alert">
          ${iconSvg.bank}
          <div><strong>${money(income?.pending_income || 0)} pending</strong><p>${minutes(income?.presence_seconds_today)} server minutes tracked today.</p></div>
        </div>
      `}
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
        ${["bank", "messages", "jobs", "court"].map((id) => {
          const item = apps.find((appItem) => appItem.id === id);
          return `<button data-open-app="${id}" ${item?.enabled ? "" : "disabled"} aria-label="${id}">${iconSvg[item?.icon || "settings"]}</button>`;
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
    dmv: "DMV",
    jobs: "Jobs",
    court: "Court",
    properties: "Properties",
    cash: "Cash App",
    bank: "Bank",
    messages: "Messages",
    mdt: "MDT CAD",
    admin: "Admin",
  };
  const body = {
    dmv: renderDmv,
    jobs: renderJobs,
    court: renderCourt,
    properties: renderProperties,
    cash: renderCash,
    bank: renderBank,
    messages: renderMessages,
    mdt: renderMdt,
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
    dmv: () => api("/api/dmv/me"),
    jobs: () => api("/api/jobs"),
    court: async () => ({
      mine: await api("/api/court/my-cases"),
      judge: can("judge") || can("admin") || can("owner") ? await api("/api/court/cases") : null,
    }),
    properties: () => api("/api/properties"),
    bank: () => api("/api/bank"),
    messages: () => api("/api/messages"),
    mdt: async () => ({ charges: await api("/api/mdt/charges"), alerts: await api("/api/mdt/alerts"), search: state.cache.mdt?.search || [] }),
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
    dmv: bindDmv,
    jobs: bindJobs,
    court: bindCourt,
    properties: bindProperties,
    cash: bindCash,
    bank: bindBank,
    messages: bindMessages,
    mdt: bindMdt,
    admin: bindAdmin,
  };
  binders[state.activeApp]?.();
}

function can(role) {
  return state.session?.user?.roles?.includes(role);
}

function renderDmv() {
  const data = state.cache.dmv;
  const record = data?.record;
  if (!record) return `<div class="empty">DMV record loading</div>`;
  const vehicles = data.vehicles || [];
  const applications = data.license_applications || [];
  const activeVehicle = vehicles[0] || record;
  return `
    <div class="stack">
      <div class="segmented">
        <button class="${state.dmvTab === "overview" ? "active" : ""}" data-dmv-tab="overview">Overview</button>
        <button class="${state.dmvTab === "license" ? "active" : ""}" data-dmv-tab="license">License</button>
        <button class="${state.dmvTab === "vehicles" ? "active" : ""}" data-dmv-tab="vehicles">Vehicles</button>
      </div>
      ${state.dmvTab === "license" ? renderDmvLicense(applications) : state.dmvTab === "vehicles" ? renderDmvVehicles(vehicles, record) : renderDmvOverview(record, vehicles, applications, activeVehicle)}
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

function renderDmvLicense(applications) {
  return `
    <div class="stack">
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
        <label>VIN<input name="vin" maxlength="32" required /></label>
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

function bindDmv() {
  $$("[data-dmv-tab]").forEach((button) => button.addEventListener("click", () => {
    state.dmvTab = button.dataset.dmvTab;
    render();
  }));
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

function renderCourt() {
  const isJudge = can("judge") || can("owner") || can("admin");
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

function renderMyCases(cases) {
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

function renderJudgeCases(cases) {
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
      toast("Panic alert sent");
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
  return `
    <section class="mdt-workspace">
      <header class="mdt-topbar">
        <div>
          <p class="eyebrow">${escapeHtml(state.session.user.primary_agency || "Law Enforcement")}</p>
          <h1>Mobile Data Terminal</h1>
        </div>
        <div class="mdt-top-actions">
          <button class="ghost" data-refresh-mdt>Refresh</button>
          <button class="secondary" data-close-mdt>Exit MDT</button>
        </div>
      </header>
      <div class="mdt-stat-strip">
        <div class="metric"><span>Citations</span><strong>${(charges.citations || []).length}</strong></div>
        <div class="metric"><span>Criminal Codes</span><strong>${(charges.criminal_charges || []).length}</strong></div>
        <div class="metric"><span>Active Alerts</span><strong>${alerts.filter((alert) => alert.status === "active").length}</strong></div>
      </div>
      <div class="mdt-layout">
        <aside class="mdt-nav">
          ${[
            ["search", "NCIC / DMV"],
            ["ticket", "Issue"],
            ["citations", "Citations"],
            ["criminal", "Criminal"],
            ["panic", "Panic"]
          ].map(([id, label]) => `<button class="${state.mdtTab === id ? "active" : ""}" data-mdt-tab="${id}">${label}</button>`).join("")}
        </aside>
        <main class="mdt-main">${renderMdtContent()}</main>
        <aside class="mdt-side">${renderMdtSide()}</aside>
      </div>
      ${state.mdtCatalogOpen ? renderMdtCatalogModal() : ""}
      ${state.mdtNotice ? renderMdtNoticeModal() : ""}
    </section>
  `;
}

function bindMdtWorkspace() {
  $("[data-close-mdt]")?.addEventListener("click", async () => {
    state.activeApp = null;
    state.mdtCatalogOpen = false;
    await loadSession();
  });
  $("[data-refresh-mdt]")?.addEventListener("click", async () => {
    await loadAppData("mdt");
    render();
  });
  bindMdt();
}

function renderMdt() {
  return `<div class="mdt-shell">${renderMdtContent()}</div>`;
}

function renderMdtContent() {
  if (state.mdtTab === "ticket") return renderTicketWriter();
  if (state.mdtTab === "citations") return renderCodeSection("citation");
  if (state.mdtTab === "criminal") return renderCodeSection("criminal");
  if (state.mdtTab === "panic") return renderPanic();
  return renderMdtSearch();
}

function renderMdtSide() {
  const alerts = state.cache.mdt?.alerts?.alerts || [];
  const issued = state.cache.mdt?.search?.flatMap((person) => person.open_cases || []) || [];
  return `
    <div class="mdt-side-panel">
      <h3>Watch</h3>
      <div class="list compact-list">
        ${alerts.slice(0, 5).map((alert) => `<div class="row"><span>${escapeHtml(alert.officer_name)}</span><span class="pill red">${escapeHtml(alert.status)}</span></div>`).join("") || `<p class="muted small">No active panic traffic</p>`}
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
            <div class="row"><h4>Registered vehicles</h4><button class="secondary" data-use-civ="${item.id}">Use for ticket</button></div>
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

function getMdtCatalog(kind) {
  const data = state.cache.mdt?.charges || {};
  if (kind === "criminal") return data.criminal_charges || [];
  return data.citations || [];
}

function renderTicketWriter() {
  const charges = getMdtCatalog(state.mdtCatalogMode);
  const defaultCourt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `
    <form id="ticketForm" class="mdt-form">
      <div class="mdt-section-head">
        <div><p class="eyebrow">Citation writer</p><h2>Issue ${state.mdtCatalogMode === "citation" ? "Citation" : "Criminal Charge"}</h2></div>
        <button class="secondary" type="button" data-open-catalog>Browse codes</button>
      </div>
      <div class="segmented mdt-code-switch">
        <button type="button" class="${state.mdtCatalogMode === "citation" ? "active" : ""}" data-catalog-mode="citation">Citations</button>
        <button type="button" class="${state.mdtCatalogMode === "criminal" ? "active" : ""}" data-catalog-mode="criminal">Criminal</button>
        <button type="button" data-open-catalog>Catalog</button>
      </div>
      <div class="grid-2">
        <label>Civilian user ID<input name="civ_id" type="number" value="${escapeHtml(state.mdtSelectedCiv)}" required /></label>
        <label>Court date<input name="court_date" type="date" value="${defaultCourt}" /></label>
      </div>
      <label>Code<select name="charge_id" required>
        ${charges.map((charge) => `<option value="${charge.id}">${escapeHtml(charge.code)} - ${escapeHtml(charge.title)} - ${money(charge.fine_amount)}</option>`).join("")}
      </select></label>
      <label>Location<input name="location" placeholder="Street, postal, landmark" required /></label>
      <label>Narrative<textarea name="narrative" required></textarea></label>
      <button class="primary" type="submit">Submit to court queue</button>
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

function renderPanic() {
  const alerts = state.cache.mdt?.alerts?.alerts || [];
  return `
    <form id="panicForm" class="mdt-form">
      <button class="panic-button pulse" type="submit">PANIC BUTTON</button>
      <label>Location<input name="location" placeholder="Nearest postal / street" /></label>
      <label>Note<input name="note" placeholder="Short emergency note" /></label>
    </form>
    <div class="list">
      ${alerts.map((alert) => `<article class="case-card"><div class="row"><h3>${escapeHtml(alert.officer_name)}</h3><span class="pill red">${escapeHtml(alert.status)}</span></div><p>${escapeHtml(alert.location)}</p><p class="muted small">${escapeHtml(alert.note)}</p></article>`).join("") || `<div class="empty">No panic activations</div>`}
    </div>
  `;
}

function bindMdt() {
  $$("[data-mdt-tab]").forEach((button) => button.addEventListener("click", () => {
    state.mdtTab = button.dataset.mdtTab;
    state.mdtCatalogOpen = false;
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
    render();
  }));
  $("#mdtSearch")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q");
    try {
      const results = await api(`/api/mdt/search?q=${encodeURIComponent(q)}`);
      state.cache.mdt = state.cache.mdt || {};
      state.cache.mdt.search = results.results;
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
      const result = await api("/api/mdt/citations", { method: "POST", body: payload });
      toast(`Citation issued - court ${result.court_date}`);
      event.currentTarget.reset();
      state.mdtSelectedCiv = "";
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
}

function renderAdmin() {
  const data = state.cache.admin;
  if (!data) return `<div class="empty">Admin loading</div>`;
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
  `;
}

const roleOptions = ["civ", "owner", "admin", "leo", "judge", "ems", "dispatcher", "sheriff", "police", "state_police", "cid"];

function renderAdminUsers(users) {
  return `<div class="list">${users.map((user) => `
    <article class="user-card">
      <form class="admin-user-form form-grid" data-user-id="${user.id}">
        <div class="row"><h3>${escapeHtml(user.name)}</h3><span class="pill ${user.verified ? "green" : "amber"}">${user.verified ? "verified" : "pending"}</span></div>
        <p class="muted small">#${user.id} · ${escapeHtml(user.email)} · ${minutes(user.presence_seconds_today)}m today</p>
        <label class="check-row"><input type="checkbox" name="verified" ${user.verified ? "checked" : ""} /> Verified civilian</label>
        <label>Agency/division<input name="primary_agency" value="${escapeHtml(user.primary_agency || "")}" placeholder="Sheriff / Police / State Police / CID" /></label>
        <div class="role-grid">
          ${roleOptions.map((role) => `<label class="check-row"><input type="checkbox" name="roles" value="${role}" ${user.roles.includes(role) ? "checked" : ""} /> ${role.replace("_", " ")}</label>`).join("")}
        </div>
        <button class="primary" type="submit">Save user</button>
      </form>
    </article>
  `).join("")}</div>`;
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

function bindAdmin() {
  $$("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => {
    state.adminTab = button.dataset.adminTab;
    render();
  }));
  $$(".admin-user-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const roles = formData.getAll("roles");
    try {
      await api(`/api/admin/users/${form.dataset.userId}`, {
        method: "PATCH",
        body: { verified: formData.get("verified") === "on", primary_agency: formData.get("primary_agency"), roles },
      });
      toast("User saved");
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
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}

loadSession().catch((error) => {
  app.innerHTML = phone(`<section class="auth-card"><h1>RP Command</h1><p>${escapeHtml(error.message)}</p></section>`);
});

setInterval(heartbeat, 60_000);
setTimeout(heartbeat, 4_000);
