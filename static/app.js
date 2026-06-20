const app = document.getElementById("app");

const state = {
  authMode: "login",
  user: null,
  notice: "",
  error: "",
  civilianApp: "Profile",
  mdtModule: "Dashboard",
  adminTab: "Overview",
  chatBody: "",
  shiftStarted: Date.now(),
  poll: null
};

const civilianApps = [
  ["Profile", "👤"],
  ["Driver License", "🪪"],
  ["Vehicle Registration", "🚗"],
  ["Firearm Permit", "◈"],
  ["Business License", "🏢"],
  ["Warrants", "⚖"],
  ["Tickets/Citations", "🧾"],
  ["911 Call", "☎"],
  ["Emergency Contacts", "🧰"],
  ["Civilian Records", "📁"],
  ["Court Notices", "🏛"],
  ["Department Applications", "⭐"]
];

const mdtModules = [
  "Dashboard",
  "Active Calls",
  "Create Call",
  "Assign Units",
  "Unit Status",
  "BOLOs",
  "Warrants",
  "People Search",
  "Vehicle Search",
  "Plate Search",
  "Citation Writer",
  "Incident Reports",
  "Arrest Reports",
  "Fire Reports",
  "EMS Patient Care Reports",
  "Dispatch Chat",
  "Radio Log",
  "Call History",
  "Shift Clock",
  "Department Roster"
];

const adminTabs = ["Overview", "Applications", "Users", "Departments", "Permissions", "Civilian Records", "Audit Logs", "Settings"];

const unitStatusLabels = {
  TEN_8_AVAILABLE: "10-8 Available",
  TEN_6_BUSY: "10-6 Busy",
  TEN_7_OUT_OF_SERVICE: "10-7 Out of Service",
  TEN_23_ON_SCENE: "10-23 On Scene",
  TEN_97_EN_ROUTE: "10-97 En Route",
  TEN_15_TRANSPORTING: "10-15 Transporting",
  CODE_4_CLEAR: "Code 4 Clear",
  PRIORITY_RESPONSE: "Priority Response"
};

const departmentRoles = new Set(["police", "sheriff", "fire", "ems", "dispatcher", "department_supervisor", "site_admin", "owner"]);
const dispatcherRoles = new Set(["dispatcher", "site_admin", "owner"]);
const adminRoles = new Set(["site_admin", "owner"]);

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roleLabel(role) {
  if (!role) return "Unauthenticated";
  return String(role)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function canUseMdt(role) {
  return departmentRoles.has(role);
}

function canUseDispatch(role) {
  return dispatcherRoles.has(role);
}

function canUseAdmin(role) {
  return adminRoles.has(role);
}

function getToken() {
  return localStorage.getItem("faircroft_token");
}

function setToken(token) {
  if (token) localStorage.setItem("faircroft_token", token);
  else localStorage.removeItem("faircroft_token");
}

async function apiFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, {
    ...init,
    headers,
    body: init.body && typeof init.body !== "string" ? JSON.stringify(init.body) : init.body
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload && payload.error ? payload.error : "Request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function formBody(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function navigate(path) {
  history.pushState({}, "", path);
  render();
}

function footer() {
  return `<footer class="site-footer"><span>FairCroft CoreOne • fictional roleplay system • not for real emergency use</span><a href="/admin" data-link>Admin Console</a></footer>`;
}

function seal(compact = false) {
  return `
    <div class="fc-seal ${compact ? "fc-seal--compact" : ""}">
      <div class="fc-seal__ring"><span>FairCroft</span><span class="fc-seal__star">★</span><span>Government</span></div>
      <div class="fc-seal__core"><strong>FC</strong><small>COREONE</small></div>
    </div>
  `;
}

function flash() {
  return `${state.notice ? `<div class="success-strip">${h(state.notice)}</div>` : ""}${state.error ? `<div class="error-strip">${h(state.error)}</div>` : ""}`;
}

function clearFlash() {
  state.notice = "";
  state.error = "";
}

function stopPoll() {
  if (state.poll) window.clearInterval(state.poll);
  state.poll = null;
}

function setHtml(html) {
  app.innerHTML = html;
  document.querySelectorAll("[data-link]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(node.getAttribute("href") || node.dataset.link || "/");
    });
  });
  document.querySelectorAll("[data-action='logout']").forEach((node) => node.addEventListener("click", logout));
}

async function getMe() {
  if (!getToken()) return null;
  try {
    const payload = await apiFetch("/api/auth/me");
    state.user = payload.user;
    return payload.user;
  } catch {
    setToken(null);
    state.user = null;
    return null;
  }
}

async function requireScope(scope) {
  const user = await getMe();
  if (!user) return { allowed: false, user: null, message: "Please sign in to access your FairCroft workstation." };
  if (scope === "civilian") return { allowed: true, user };
  if (scope === "department" && canUseMdt(user.role)) return { allowed: true, user };
  if (scope === "dispatch" && canUseDispatch(user.role)) return { allowed: true, user };
  if (scope === "admin" && canUseAdmin(user.role)) return { allowed: true, user };
  return { allowed: false, user, message: `${roleLabel(user.role)} does not have ${scope} access.` };
}

function accessPanel(title, message) {
  setHtml(`
    <main class="center-screen">
      <section class="glass-panel access-panel">
        <p class="eyebrow">Access Control</p>
        <h1>${h(title)}</h1>
        <p>${h(message)}</p>
        <div class="button-row">
          <a class="button primary" href="/" data-link>Return Home</a>
          ${getToken() ? `<button class="button ghost" data-action="logout">Sign out</button>` : ""}
        </div>
      </section>
    </main>
    ${footer()}
  `);
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // token is cleared either way
  }
  setToken(null);
  state.user = null;
  navigate("/");
}

function bestPortal(user) {
  if (canUseAdmin(user?.role)) return "/admin";
  if (canUseDispatch(user?.role)) return "/dispatch";
  if (canUseMdt(user?.role)) return "/mdt";
  return "/civilian";
}

async function renderHome() {
  stopPoll();
  const user = await getMe();
  const auth = user
    ? `
      <div class="session-card">
        <p class="eyebrow">Session Active</p>
        <h2>${h(user.name)}</h2>
        <p>Authenticated as <strong>${roleLabel(user.role)}</strong>. Choose your active workstation.</p>
        <div class="portal-grid">
          <a href="/civilian" data-link class="portal-card"><span>📱</span><strong>Civilian PDA</strong><small>Government services and applications</small></a>
          ${canUseMdt(user.role) ? `<a href="/mdt" data-link class="portal-card"><span>▣</span><strong>Department MDT</strong><small>Calls, units, BOLOs, reports</small></a>` : ""}
          ${canUseDispatch(user.role) ? `<a href="/dispatch" data-link class="portal-card"><span>☎</span><strong>Dispatch Center</strong><small>911 queue and assignments</small></a>` : ""}
          ${canUseAdmin(user.role) ? `<a href="/admin" data-link class="portal-card"><span>⚙</span><strong>Admin Console</strong><small>Approvals, roles, audit logs</small></a>` : ""}
        </div>
        <button id="continueButton" class="button primary wide">Continue</button>
        <button class="button ghost wide" data-action="logout">Sign out</button>
      </div>
    `
    : `
      <div class="auth-toggle">
        <button id="showLogin" class="${state.authMode === "login" ? "active" : ""}">Login</button>
        <button id="showRegister" class="${state.authMode === "register" ? "active" : ""}">Register</button>
      </div>
      ${state.authMode === "login" ? loginForm() : registerForm()}
    `;

  setHtml(`
    <main class="home-shell">
      <section class="hero-panel">
        <div class="hero-orbit">${seal()}</div>
        <div>
          <p class="eyebrow">FairCroft Government Services</p>
          <h1>CoreOne Python PWA CAD/MDT</h1>
          <p class="hero-copy">A fictional public-safety operating system for civilian services, department applications, command dispatch, and live MDT workflows. Built for Python-only Railway/Docker deployment.</p>
          <div class="hero-badges"><span>Roleplay Safe</span><span>Python PWA</span><span>Railway Ready</span></div>
        </div>
      </section>
      <section class="auth-card">${flash()}${auth}</section>
    </main>
    ${footer()}
  `);

  document.getElementById("showLogin")?.addEventListener("click", () => {
    clearFlash();
    state.authMode = "login";
    renderHome();
  });
  document.getElementById("showRegister")?.addEventListener("click", () => {
    clearFlash();
    state.authMode = "register";
    renderHome();
  });
  document.getElementById("continueButton")?.addEventListener("click", () => navigate(bestPortal(state.user)));
  document.getElementById("loginForm")?.addEventListener("submit", onLogin);
  document.getElementById("registerForm")?.addEventListener("submit", onRegister);
}

function loginForm() {
  return `
    <form id="loginForm" class="stack-form">
      <p class="eyebrow">Secure Roleplay Access</p>
      <h2>Sign in to CoreOne</h2>
      <label>Email<input name="email" type="email" placeholder="owner@faircroft.local" required></label>
      <label>Password<input name="password" type="password" placeholder="••••••••" required></label>
      <button class="button primary wide">Enter CoreOne</button>
      <p class="hint">Seed owner: <code>owner@faircroft.local</code> / <code>ChangeMe123!</code></p>
    </form>
  `;
}

function registerForm() {
  return `
    <form id="registerForm" class="stack-form">
      <p class="eyebrow">Civilian Enrollment</p>
      <h2>Create a PDA account</h2>
      <div class="two-col">
        <label>First name<input name="firstName" required></label>
        <label>Last name<input name="lastName" required></label>
      </div>
      <label>Email<input name="email" type="email" required></label>
      <label>Password<input name="password" type="password" minlength="8" required></label>
      <div class="two-col">
        <label>Phone<input name="phone"></label>
        <label>Date of birth<input name="dateOfBirth" type="date"></label>
      </div>
      <label>Address<input name="address" placeholder="Street address"></label>
      <label>Postal code<input name="postalCode"></label>
      <button class="button primary wide">Create Civilian Account</button>
    </form>
  `;
}

async function onLogin(event) {
  event.preventDefault();
  clearFlash();
  try {
    const data = formBody(event.currentTarget);
    const payload = await apiFetch("/api/auth/login", { method: "POST", body: { email: data.email, password: data.password } });
    setToken(payload.token);
    state.user = payload.user;
    state.notice = "Signed in.";
    navigate(bestPortal(payload.user));
  } catch (error) {
    state.error = error.message;
    renderHome();
  }
}

async function onRegister(event) {
  event.preventDefault();
  clearFlash();
  try {
    const data = formBody(event.currentTarget);
    const payload = await apiFetch("/api/auth/register", {
      method: "POST",
      body: { ...data, city: "FairCroft", state: "FC" }
    });
    setToken(payload.token);
    state.user = payload.user;
    state.notice = "Civilian account created.";
    navigate("/civilian");
  } catch (error) {
    state.error = error.message;
    renderHome();
  }
}

async function renderCivilian() {
  stopPoll();
  const gate = await requireScope("civilian");
  if (!gate.allowed) return accessPanel("Civilian session required", gate.message);
  const [overview, deptPayload] = await Promise.all([apiFetch("/api/civilian/overview"), apiFetch("/api/departments")]);
  const user = overview.user || gate.user;
  const hasMdt = canUseMdt(user?.role);
  setHtml(`
    <main class="pda-shell">
      <section class="phone-frame">
        <div class="phone-status"><span>FairCroft LTE</span><span>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
        <div class="phone-header">${seal(true)}<div><p class="eyebrow">Government Services</p><h1>${h(user?.profile?.firstName || String(user?.name || "Civilian").split(" ")[0])}'s PDA</h1><p>${roleLabel(user?.role)}</p></div></div>
        ${
          hasMdt
            ? `<div class="approved-banner"><strong>Department access approved.</strong><span> MDT modules are unlocked.</span><div><a href="/mdt" data-link>Open MDT</a>${canUseDispatch(user.role) ? `<a href="/dispatch" data-link>Dispatch</a>` : ""}${canUseAdmin(user.role) ? `<a href="/admin" data-link>Admin</a>` : ""}</div></div>`
            : user?.role === "pending_department"
              ? `<div class="pending-banner">Department application pending. Civilian apps remain available only.</div>`
              : ""
        }
        <div class="app-grid">
          ${civilianApps.map(([name, icon]) => `<button class="app-icon ${state.civilianApp === name ? "active" : ""}" data-app="${h(name)}"><span>${icon}</span><small>${h(name)}</small></button>`).join("")}
        </div>
      </section>
      <section class="pda-app-panel">
        <div class="panel-title"><div><p class="eyebrow">Civilian App</p><h2>${h(state.civilianApp)}</h2></div><button class="button ghost" data-action="logout">Sign out</button></div>
        ${flash()}
        ${civilianContent(state.civilianApp, overview, deptPayload.departments || [])}
      </section>
    </main>
    ${footer()}
  `);
  document.querySelectorAll("[data-app]").forEach((button) => {
    button.addEventListener("click", () => {
      clearFlash();
      state.civilianApp = button.dataset.app;
      renderCivilian();
    });
  });
  document.getElementById("applicationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/civilian/applications", "POST", formBody(event.currentTarget), "Application submitted to FairCroft administration.", renderCivilian);
  });
  document.getElementById("call911Form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/civilian/911", "POST", formBody(event.currentTarget), "911 request transmitted to FairCroft Communications Dispatch.", renderCivilian);
  });
}

function civilianContent(active, overview, departments) {
  const profile = overview.user?.profile || {};
  if (active === "Profile") {
    return `<div class="info-card-grid">
      ${infoCard("Legal name", overview.user?.name)}
      ${infoCard("Phone", overview.user?.phone || profile.phone || "Not on file")}
      ${infoCard("Address", [profile.address, profile.city, profile.state].filter(Boolean).join(", ") || "Not on file")}
      ${infoCard("Account role", roleLabel(overview.user?.role))}
    </div>`;
  }
  if (active === "Driver License") return recordList(overview.licenses, "No driver license record has been issued.", ["number", "class", "status", "expiresAt"]);
  if (active === "Vehicle Registration") return recordList(overview.vehicles, "No registered vehicles.", ["plate", "year", "make", "model", "registrationStatus"]);
  if (active === "Firearm Permit") return recordList((overview.permits || []).filter((p) => String(p.type || "").toLowerCase().includes("firearm")), "No firearm permit record.", ["number", "type", "status", "expiresAt"]);
  if (active === "Business License") return emptyAgency("Business Licensing", "No business license records are attached to this roleplay civilian account.");
  if (active === "Warrants") return recordList(overview.warrants, "No active warrant records associated with this civilian.", ["subjectName", "charges", "status", "severity"]);
  if (active === "Tickets/Citations") return recordList(overview.citations, "No citations on file.", ["subjectName", "statute", "description", "status"]);
  if (active === "911 Call") {
    return `
      <form id="call911Form" class="stack-form agency-form">
        <div class="warning-callout">This is a fictional roleplay 911 system. Do not use it for real emergencies.</div>
        <label>Emergency type<select name="emergencyType" required><option value="">Select emergency type</option><option>Police</option><option>Fire</option><option>EMS</option><option>Traffic Collision</option><option>Public Safety Hazard</option></select></label>
        <label>Location<input name="location" required placeholder="Street, landmark, postal, or scene details"></label>
        <label>Description<textarea name="description" rows="5" required placeholder="Describe what is happening now."></textarea></label>
        <div class="two-col"><label>Caller name<input name="callerName" value="${h(overview.user?.name)}" required></label><label>Callback number<input name="callbackNumber" value="${h(overview.user?.phone || profile.phone || "")}" required></label></div>
        <button class="button danger wide">Transmit 911 Call</button>
      </form>`;
  }
  if (active === "Emergency Contacts") return emptyAgency("Emergency Contacts", "Add trusted roleplay contacts here in a future community-specific expansion.");
  if (active === "Civilian Records") {
    return `<div class="records-stack">${infoCard("Civilian ID", overview.user?.id)}${infoCard("Record flags", profile.recordFlags?.length ? profile.recordFlags.join(", ") : "None")}${infoCard("Administrative notes", profile.notes || "No notes")}</div>`;
  }
  if (active === "Court Notices") return emptyAgency("Court Notices", "No fictional FairCroft Municipal Court notices are pending.");
  if (active === "Department Applications") {
    return `<div class="application-layout">
      <form id="applicationForm" class="stack-form agency-form">
        <label>Department<select name="departmentId" required><option value="">Select a FairCroft department</option>${departments.map((d) => `<option value="${h(d.id)}">${h(d.name)}</option>`).join("")}</select></label>
        <label>Why do you want to join?<textarea name="statement" rows="5" required placeholder="Keep it immersive and roleplay focused."></textarea></label>
        <label>Relevant roleplay experience<textarea name="experience" rows="4" placeholder="Optional"></textarea></label>
        <button class="button primary wide">Submit Department Application</button>
      </form>
      ${recordList(overview.applications, "No applications submitted yet.", ["department.name", "status", "submittedAt", "decisionReason"])}
    </div>`;
  }
  return emptyAgency(active, "Module reserved for future FairCroft community expansion.");
}

function infoCard(label, value) {
  return `<div class="info-card"><span>${h(label)}</span><strong>${h(value || "—")}</strong></div>`;
}

function valueAt(record, path) {
  return path.split(".").reduce((current, key) => (current ? current[key] : undefined), record);
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function recordList(records, empty, fields) {
  if (!records || !records.length) return emptyAgency("No Records", empty);
  return `<div class="record-list">${records
    .map(
      (record) =>
        `<article class="record-card">${fields.map((field) => `<div><span>${h(field.split(".").at(-1))}</span><strong>${h(formatValue(valueAt(record, field)))}</strong></div>`).join("")}</article>`
    )
    .join("")}</div>`;
}

function emptyAgency(title, body) {
  return `<div class="empty-agency"><span>FC</span><h3>${h(title)}</h3><p>${h(body)}</p></div>`;
}

async function submitAndReload(path, method, body, success, reload) {
  clearFlash();
  try {
    await apiFetch(path, { method, body });
    state.notice = success;
  } catch (error) {
    state.error = error.message;
  }
  await reload();
}

async function renderMdt() {
  stopPoll();
  const gate = await requireScope("department");
  if (!gate.allowed) return accessPanel("Department MDT locked", gate.message);
  const [dashboard, records] = await Promise.all([apiFetch("/api/cad/dashboard"), apiFetch("/api/cad/records")]);
  setHtml(`
    <main class="mdt-shell">
      ${mdtSidebar(gate.user)}
      <section class="mdt-workspace">
        <header class="mdt-topbar"><div><p class="eyebrow">FairCroft Department Terminal</p><h1>${h(state.mdtModule)}</h1></div><div class="terminal-status"><span class="live-dot"></span>LIVE PYTHON CAD LINK</div></header>
        ${flash()}
        ${mdtContent(state.mdtModule, dashboard, records, gate.user)}
      </section>
    </main>
    ${footer()}
  `);
  bindMdt(dashboard, records);
  state.poll = window.setInterval(() => {
    if (location.pathname === "/mdt") renderMdt();
  }, 9000);
}

function mdtSidebar(user) {
  return `<aside class="mdt-sidebar">
    <div class="mdt-brand"><span>FC</span><div><strong>CoreOne MDT</strong><small>${roleLabel(user?.role)}</small></div></div>
    <nav>${mdtModules.map((m) => `<button class="${state.mdtModule === m ? "active" : ""}" data-module="${h(m)}">${h(m)}</button>`).join("")}</nav>
    <div class="mdt-sidebar-footer">
      <a href="/civilian" data-link>Civilian PDA</a>
      ${canUseDispatch(user?.role) ? `<a href="/dispatch" data-link>Dispatch</a>` : ""}
      ${canUseAdmin(user?.role) ? `<a href="/admin" data-link>Admin</a>` : ""}
      <button data-action="logout">Sign out</button>
    </div>
  </aside>`;
}

function mdtContent(module, dashboard, records, user) {
  const activeCalls = dashboard.calls || [];
  const units = dashboard.units || [];
  const canDispatch = canUseDispatch(user?.role);
  if (module === "Dashboard") {
    return `<div class="mdt-grid">
      ${metric("Active Calls", activeCalls.length)}
      ${metric("Available Units", units.filter((u) => u.status === "TEN_8_AVAILABLE").length)}
      ${metric("Active BOLOs", dashboard.bolos?.length || 0)}
      ${metric("Warrants", dashboard.warrants?.length || 0)}
      ${callBoard(activeCalls)}
      ${unitBoard(units)}
    </div>`;
  }
  if (module === "Active Calls" || module === "Call History") return callBoard(activeCalls, true);
  if (module === "Create Call") {
    return `<form id="createCallForm" class="terminal-form">
      <label>Call type<input name="type" placeholder="Traffic Stop, Structure Fire, Medical Aid..." required></label>
      <label>Location<input name="location" required></label>
      <label>Priority<select name="priority"><option value="low">Low</option><option value="routine" selected>Routine</option><option value="priority">Priority</option><option value="emergency">Emergency</option></select></label>
      <label>Description<textarea name="description" rows="5" required></textarea></label>
      <button class="button terminal">Create CAD Call</button>
    </form>`;
  }
  if (module === "Assign Units") {
    if (!canDispatch) return terminalEmpty("Dispatcher function", "Only dispatchers, site admins, and owners can assign units.");
    return `<form id="assignForm" class="terminal-form">
      <label>CAD call<select name="cadCallId" required><option value="">Select call</option>${activeCalls.map((c) => `<option value="${h(c.id)}">${h(c.callNumber)} — ${h(c.type)}</option>`).join("")}</select></label>
      <label>Unit<select name="unitId" required><option value="">Select unit</option>${units.map((u) => `<option value="${h(u.id)}">${h(u.unitNumber)} — ${h(unitStatusLabels[u.status] || u.status)}</option>`).join("")}</select></label>
      <button class="button terminal">Assign Unit</button>
    </form>`;
  }
  if (module === "Unit Status") {
    return `<form id="unitStatusForm" class="terminal-form">
      <label>Unit<select name="unitId" required><option value="">Select unit</option>${units.map((u) => `<option value="${h(u.id)}">${h(u.unitNumber)}</option>`).join("")}</select></label>
      <label>Status<select name="status">${Object.entries(unitStatusLabels).map(([value, label]) => `<option value="${value}">${h(label)}</option>`).join("")}</select></label>
      <button class="button terminal">Update Status</button>
      ${unitBoard(units)}
    </form>`;
  }
  if (module === "BOLOs") return recordsAndForm(records.bolos, "bolo");
  if (module === "Warrants") return recordsAndForm(records.warrants, "warrant");
  if (module === "Citation Writer") return citationForm(records.citations);
  if (module === "Incident Reports") return reportForm("incident", records.incidentReports);
  if (module === "Arrest Reports") return reportForm("arrest", records.arrestReports);
  if (module === "Fire Reports") return reportForm("fire", records.fireReports);
  if (module === "EMS Patient Care Reports") return reportForm("ems", records.emsReports);
  if (module === "People Search" || module === "Vehicle Search" || module === "Plate Search") {
    return `<div class="search-panel"><div class="chat-compose"><input id="searchInput" placeholder="${module === "People Search" ? "Name, email, identifier..." : "Plate, VIN, make, model..."}"><button id="searchButton" class="button terminal">Search</button></div><div id="searchResults">${terminalEmpty("Search Ready", "Enter a fictional query to search records.")}</div></div>`;
  }
  if (module === "Dispatch Chat" || module === "Radio Log") {
    return `<div class="chat-panel">
      <div class="chat-log">${(dashboard.messages || []).map((m) => `<div class="chat-line"><span>${h(new Date(m.createdAt).toLocaleTimeString())}</span><strong>${h(m.user?.name || "Unit")}</strong><p>${h(m.body)}</p></div>`).join("")}</div>
      <form id="chatForm" class="chat-compose"><input name="body" placeholder="Transmit dispatch message..."><button class="button terminal">TX</button></form>
    </div>`;
  }
  if (module === "Shift Clock") return shiftClock();
  if (module === "Department Roster") return roster(user?.memberships || [], units);
  return terminalEmpty(module, "Module reserved for future FairCroft community expansion.");
}

function bindMdt() {
  document.querySelectorAll("[data-module]").forEach((button) =>
    button.addEventListener("click", () => {
      clearFlash();
      state.mdtModule = button.dataset.module;
      renderMdt();
    })
  );
  document.getElementById("createCallForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/cad/calls", "POST", formBody(event.currentTarget), "CAD call created.", renderMdt);
  });
  document.getElementById("assignForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formBody(event.currentTarget);
    await submitAndReload(`/api/cad/calls/${encodeURIComponent(body.cadCallId)}/assign`, "POST", { unitId: body.unitId }, "Unit assignment transmitted.", renderMdt);
  });
  document.getElementById("unitStatusForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formBody(event.currentTarget);
    await submitAndReload(`/api/cad/units/${encodeURIComponent(body.unitId)}/status`, "PATCH", { status: body.status }, "Unit status updated.", renderMdt);
  });
  document.getElementById("boloForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/cad/bolos", "POST", formBody(event.currentTarget), "BOLO published.", renderMdt);
  });
  document.getElementById("warrantForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/cad/warrants", "POST", formBody(event.currentTarget), "Warrant record created.", renderMdt);
  });
  document.getElementById("citationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/cad/citations", "POST", formBody(event.currentTarget), "Citation written.", renderMdt);
  });
  document.querySelectorAll("[data-report-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitAndReload(`/api/cad/reports/${form.dataset.reportForm}`, "POST", formBody(form), `${form.dataset.reportForm.toUpperCase()} report submitted.`, renderMdt);
    });
  });
  document.getElementById("searchButton")?.addEventListener("click", async () => {
    const query = document.getElementById("searchInput").value.trim();
    const vehicle = state.mdtModule !== "People Search";
    const payload = await apiFetch(`/api/cad/search/${vehicle ? "vehicles" : "people"}?q=${encodeURIComponent(query)}`);
    document.getElementById("searchResults").innerHTML = recordRail(payload.people || payload.vehicles || []);
  });
  document.getElementById("chatForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/dispatch/messages", "POST", { ...formBody(event.currentTarget), channel: "dispatch" }, "Dispatch message transmitted.", renderMdt);
  });
}

function metric(label, value) {
  return `<div class="metric-card"><span>${h(label)}</span><strong>${h(value)}</strong></div>`;
}

function callBoard(calls, full = false) {
  if (!calls.length) return terminalEmpty("No active calls", "CAD board is currently clear.");
  return `<div class="terminal-table ${full ? "full-span" : ""}"><h3>CAD Calls</h3>${calls
    .map((call) => `<article><div><strong>${h(call.callNumber)}</strong><span>${h(call.priority)}</span></div><p>${h(call.type)}</p><small>${h(call.location)}</small><small>${h((call.assignments || []).map((a) => a.cadUnit?.unitNumber).filter(Boolean).join(", ") || "Unassigned")}</small></article>`)
    .join("")}</div>`;
}

function unitBoard(units) {
  return `<div class="terminal-table"><h3>Units</h3>${(units || [])
    .map((unit) => `<article><div><strong>${h(unit.unitNumber)}</strong><span>${h(unit.department?.code || "")}</span></div><p>${h(unitStatusLabels[unit.status] || unit.status)}</p><small>${h(unit.user?.name || "Unstaffed")}</small></article>`)
    .join("")}</div>`;
}

function terminalEmpty(title, body) {
  return `<div class="terminal-empty"><span>▣</span><h3>${h(title)}</h3><p>${h(body)}</p></div>`;
}

function recordsAndForm(records, kind) {
  const form =
    kind === "bolo"
      ? `<form id="boloForm" class="terminal-form"><label>BOLO title<input name="title" required></label><label>Description<textarea name="description" rows="5" required></textarea></label><label>Plate<input name="plate"></label><label>Person name<input name="personName"></label><label>Vehicle description<input name="vehicleDescription"></label><button class="button terminal">Publish BOLO</button></form>`
      : `<form id="warrantForm" class="terminal-form"><label>Subject name<input name="subjectName" required></label><label>Charges<textarea name="charges" rows="5" required></textarea></label><label>Severity<select name="severity"><option value="routine">Routine</option><option value="priority">Priority</option><option value="emergency">Emergency</option></select></label><button class="button terminal">Create Warrant</button></form>`;
  return `<div class="split-terminal">${form}${recordRail(records)}</div>`;
}

function citationForm(records) {
  return `<div class="split-terminal"><form id="citationForm" class="terminal-form"><label>Subject name<input name="subjectName" required></label><label>Statute / Ordinance<input name="statute" required placeholder="FC-MC 12.04"></label><label>Description<textarea name="description" rows="5" required></textarea></label><label>Fine in cents<input name="fineCents" type="number" min="0" value="0"></label><label>Location<input name="location"></label><button class="button terminal">Issue Citation</button></form>${recordRail(records)}</div>`;
}

function reportForm(type, records) {
  return `<div class="split-terminal"><form data-report-form="${h(type)}" class="terminal-form">
    <label>Report title / incident type<input name="${type === "fire" ? "incidentType" : "title"}" placeholder="${h(type)} report"></label>
    ${type === "arrest" || type === "ems" ? `<label>Subject / patient name<input name="${type === "ems" ? "patientName" : "subjectName"}"></label>` : ""}
    ${type === "arrest" ? `<label>Charges<textarea name="charges" rows="3"></textarea></label>` : ""}
    ${type === "ems" ? `<label>Patient age<input name="patientAge" type="number" min="0"></label><label>Chief complaint<input name="chiefComplaint"></label><label>Care provided<textarea name="careProvided" rows="3"></textarea></label><label>Disposition<input name="disposition"></label>` : ""}
    ${type === "fire" ? `<label>Cause<input name="cause"></label><label>Actions taken<textarea name="actions" rows="3"></textarea></label>` : ""}
    <label>Narrative<textarea name="narrative" rows="7" required></textarea></label>
    ${type === "ems" ? `<p class="terminal-note">EMS PCR is for roleplay only and has no medical validity.</p>` : ""}
    <button class="button terminal">Submit ${h(type.toUpperCase())} Report</button>
  </form>${recordRail(records)}</div>`;
}

function recordRail(records) {
  if (!records || !records.length) return terminalEmpty("No records", "No matching fictional records are currently on file.");
  return `<div class="record-rail">${records
    .map((record) => `<article><strong>${h(record.callNumber || record.title || record.subjectName || record.name || record.plate || record.reportNumber || record.id)}</strong><pre>${h(JSON.stringify(record, null, 2))}</pre></article>`)
    .join("")}</div>`;
}

function shiftClock() {
  const elapsed = Math.floor((Date.now() - state.shiftStarted) / 1000);
  const hours = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  window.setTimeout(() => {
    if (location.pathname === "/mdt" && state.mdtModule === "Shift Clock") renderMdt();
  }, 1000);
  return `<div class="shift-clock"><span>SHIFT CLOCK</span><strong>${hours}:${minutes}:${seconds}</strong><p>Started ${new Date(state.shiftStarted).toLocaleString()}</p></div>`;
}

function roster(memberships, units) {
  const rows = (memberships || []).length ? memberships : [];
  return `<div class="terminal-table full-span"><h3>Department Roster</h3>${rows
    .map((m) => `<article><div><strong>${h(m.user?.name || state.user?.name || "Current User")}</strong><span>${h(m.department?.code || "")}</span></div><p>${h(m.rank?.name || roleLabel(m.role))}</p><small>${h((units || []).find((unit) => unit.userId === m.userId)?.unitNumber || "No active unit")}</small></article>`)
    .join("")}</div>`;
}

async function renderDispatch() {
  stopPoll();
  const gate = await requireScope("dispatch");
  if (!gate.allowed) return accessPanel("Dispatch console locked", gate.message);
  const [queuePayload, dashboard] = await Promise.all([apiFetch("/api/dispatch/queue"), apiFetch("/api/cad/dashboard")]);
  const queue = queuePayload.calls || [];
  setHtml(`
    <main class="dispatch-shell">
      <header class="dispatch-header"><div><p class="eyebrow">FairCroft Communications Dispatch</p><h1>Command Center</h1><p>${h(gate.user?.name)} • ${roleLabel(gate.user?.role)}</p></div><nav><a href="/mdt" data-link>MDT</a><a href="/civilian" data-link>PDA</a><button data-action="logout">Sign out</button></nav></header>
      ${queue.length ? `<div class="dispatch-alert">INCOMING / QUEUED 911: ${queue.length} waiting</div>` : ""}
      ${flash()}
      <section class="dispatch-grid">
        <div class="dispatch-card queue-card"><div class="card-heading"><h2>Incoming 911 Queue</h2><span>${queue.length} waiting</span></div>${queue.length ? queue.map(call911Card).join("") : `<p class="muted">No queued 911 calls. Console is standing by.</p>`}</div>
        <div class="dispatch-card"><div class="card-heading"><h2>Active CAD Incidents</h2><span>${dashboard.calls?.length || 0}</span></div><div class="compact-board">${(dashboard.calls || []).map((call) => `<article><strong>${h(call.callNumber)}</strong><span>${h(call.priority)}</span><p>${h(call.type)}</p><small>${h(call.location)}</small></article>`).join("")}</div></div>
        <div class="dispatch-card"><div class="card-heading"><h2>Assign Units</h2><span>Live MDT Notify</span></div><form id="dispatchAssignForm" class="stack-form dark-form"><label>CAD call<select name="cadCallId" required><option value="">Select active call</option>${(dashboard.calls || []).map((call) => `<option value="${h(call.id)}">${h(call.callNumber)} — ${h(call.type)}</option>`).join("")}</select></label><label>Unit<select name="unitId" required><option value="">Select unit</option>${(dashboard.units || []).map((unit) => `<option value="${h(unit.id)}">${h(unit.unitNumber)} — ${h(unitStatusLabels[unit.status] || unit.status)}</option>`).join("")}</select></label><button class="button terminal wide">Assign Unit</button></form></div>
        <div class="dispatch-card"><div class="card-heading"><h2>Unit Board</h2><span>${dashboard.units?.length || 0} units</span></div><div class="unit-tile-grid">${(dashboard.units || []).map((unit) => `<div class="unit-tile"><strong>${h(unit.unitNumber)}</strong><span>${h(unitStatusLabels[unit.status] || unit.status)}</span><small>${h(unit.department?.code || "")} • ${h(unit.user?.name || "Unstaffed")}</small></div>`).join("")}</div></div>
      </section>
    </main>
    ${footer()}
  `);
  document.querySelectorAll("[data-accept-call]").forEach((button) =>
    button.addEventListener("click", async () => {
      await submitAndReload(`/api/dispatch/911/${encodeURIComponent(button.dataset.acceptCall)}/accept`, "POST", {}, "911 call accepted and converted to CAD incident.", renderDispatch);
    })
  );
  document.getElementById("dispatchAssignForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formBody(event.currentTarget);
    await submitAndReload(`/api/cad/calls/${encodeURIComponent(body.cadCallId)}/assign`, "POST", { unitId: body.unitId }, "Unit assignment sent to MDT.", renderDispatch);
  });
  state.poll = window.setInterval(() => {
    if (location.pathname === "/dispatch") renderDispatch();
  }, 7000);
}

function call911Card(call) {
  return `<article class="call-911-card"><div><strong>${h(call.emergencyType)}</strong><span>${h(new Date(call.createdAt).toLocaleTimeString())}</span></div><h3>${h(call.location)}</h3><p>${h(call.description)}</p><small>Caller: ${h(call.callerName)} • Callback: ${h(call.callbackNumber)}</small><button class="button danger" data-accept-call="${h(call.id)}">Accept / Create CAD</button></article>`;
}

async function renderAdmin() {
  stopPoll();
  const gate = await requireScope("admin");
  if (!gate.allowed) return accessPanel("Admin console locked", gate.message);
  const [overview, apps, users, departments, audit, settings] = await Promise.all([
    apiFetch("/api/admin/overview"),
    apiFetch("/api/admin/applications"),
    apiFetch("/api/admin/users"),
    apiFetch("/api/admin/departments"),
    apiFetch("/api/admin/audit-logs"),
    apiFetch("/api/admin/settings")
  ]);
  const data = { overview, applications: apps.applications || [], users: users.users || [], departments: departments.departments || [], auditLogs: audit.auditLogs || [], settings: settings.settings || [] };
  setHtml(`
    <main class="admin-shell">
      <aside class="admin-nav"><div class="admin-emblem">FC</div><h1>CoreOne Admin</h1><p>${h(gate.user?.name)} • ${roleLabel(gate.user?.role)}</p>${adminTabs.map((tab) => `<button class="${state.adminTab === tab ? "active" : ""}" data-admin-tab="${h(tab)}">${h(tab)}</button>`).join("")}<div class="admin-links"><a href="/civilian" data-link>PDA</a><a href="/mdt" data-link>MDT</a><a href="/dispatch" data-link>Dispatch</a><button data-action="logout">Sign out</button></div></aside>
      <section class="admin-workspace"><header class="admin-topbar"><div><p class="eyebrow">Governance Console</p><h2>${h(state.adminTab)}</h2></div><span>Audit enforced</span></header>${flash()}${adminContent(state.adminTab, data)}</section>
    </main>
    ${footer()}
  `);
  bindAdmin(data);
}

function adminContent(tab, data) {
  if (tab === "Overview") {
    return `<div class="admin-grid">${Object.entries(data.overview.metrics || {}).map(([key, value]) => `<div class="admin-metric"><span>${h(key)}</span><strong>${h(value)}</strong></div>`).join("")}<div class="admin-panel wide"><h3>Recent Audit Activity</h3>${auditList(data.overview.auditLogs || [])}</div></div>`;
  }
  if (tab === "Applications") {
    return `<div class="admin-list">${data.applications.map((application) => applicationPanel(application)).join("") || emptyAgency("No Applications", "No department applications are pending.")}</div>`;
  }
  if (tab === "Users") {
    return `<div class="admin-list">${data.users.map(userPanel).join("")}</div>`;
  }
  if (tab === "Departments") {
    return `<div class="split-admin"><form id="createDepartmentForm" class="admin-panel stack-form"><h3>Create Department</h3><input name="name" placeholder="Department name" required><input name="code" placeholder="Code" required><select name="type"><option value="police">Police</option><option value="sheriff">Sheriff</option><option value="fire">Fire</option><option value="ems">EMS</option><option value="dispatch">Dispatch</option></select><textarea name="description" placeholder="Description"></textarea><button class="button primary">Create</button></form><div class="admin-list">${data.departments.map((d) => `<article class="admin-panel"><h3>${h(d.name)}</h3><p>${h(d.code)} • ${h(d.type)}</p><small>${h(d.description || "")}</small><p>${h(d.memberships?.length || 0)} members • ${h(d.ranks?.length || 0)} ranks</p></article>`).join("")}</div></div>`;
  }
  if (tab === "Permissions") {
    return `<div class="split-admin"><form id="createRankForm" class="admin-panel stack-form"><h3>Create Rank / Permission Profile</h3><select name="departmentId" required><option value="">Department</option>${data.departments.map((d) => `<option value="${h(d.id)}">${h(d.name)}</option>`).join("")}</select><input name="name" placeholder="Rank name" required><input name="level" type="number" min="1" max="999" value="10">${["cad", "records", "roster", "unitManagement"].map((p) => `<label class="checkline"><input name="${p}" type="checkbox" checked> ${h(p)}</label>`).join("")}<button class="button primary">Create Rank</button></form><div class="admin-list">${data.departments.flatMap((d) => (d.ranks || []).map((rank) => `<article class="admin-panel"><h3>${h(rank.name)}</h3><p>${h(d.code)} • Level ${h(rank.level)}</p><pre>${h(JSON.stringify(rank.permissions || {}, null, 2))}</pre></article>`)).join("")}</div></div>`;
  }
  if (tab === "Civilian Records") {
    return `<div class="split-admin"><form id="civilianRecordForm" class="admin-panel stack-form"><h3>Edit Civilian Record</h3><select name="userId" required><option value="">Select user</option>${data.users.map((u) => `<option value="${h(u.id)}">${h(u.name)} • ${h(u.email)}</option>`).join("")}</select><textarea name="notes" placeholder="Admin-only roleplay notes" rows="5"></textarea><input name="recordFlags" placeholder="Comma-separated flags"><button class="button primary">Save Record</button></form><form id="deleteRecordForm" class="admin-panel stack-form"><h3>Delete Fake Record</h3><select name="type" required><option value="">Record type</option>${["vehicle", "license", "permit", "warrant", "citation", "bolo", "incidentReport", "arrestReport", "fireReport", "emsReport"].map((type) => `<option value="${type}">${type}</option>`).join("")}</select><input name="id" placeholder="Record ID" required><button class="button danger">Delete Fake Record</button></form></div>`;
  }
  if (tab === "Audit Logs") return auditList(data.auditLogs);
  if (tab === "Settings") {
    return `<div class="split-admin"><form id="settingForm" class="admin-panel stack-form"><h3>Server Setting</h3><input name="key" placeholder="setting_key" required><textarea name="value" rows="8">{"enabled":true}</textarea><button class="button primary">Save Setting</button></form><div class="admin-list">${data.settings.map((s) => `<article class="admin-panel"><h3>${h(s.key)}</h3><pre>${h(JSON.stringify(s.value || {}, null, 2))}</pre></article>`).join("")}</div></div>`;
  }
  return "";
}

function applicationPanel(application) {
  const pending = application.status === "pending";
  return `<article class="admin-panel"><div class="card-heading"><div><h3>${h(application.user?.name)}</h3><p>${h(application.department?.name)}</p></div><span class="status-pill ${h(application.status)}">${h(application.status)}</span></div><p>${h(application.statement)}</p>${application.experience ? `<small>Experience: ${h(application.experience)}</small>` : ""}${pending ? `<form class="inline-admin-form application-form" data-application="${h(application.id)}"><select name="role"><option value="">Department default</option>${["police", "sheriff", "fire", "ems", "dispatcher", "department_supervisor"].map((role) => `<option value="${role}">${roleLabel(role)}</option>`).join("")}</select><select name="rankId"><option value="">No rank</option>${(application.department?.ranks || []).map((rank) => `<option value="${h(rank.id)}">${h(rank.name)}</option>`).join("")}</select><input name="badgeNumber" placeholder="Badge / radio ID"><input name="reason" placeholder="Decision note"><button type="button" class="button primary" data-decision="approved">Approve</button><button type="button" class="button danger" data-decision="denied">Deny</button></form>` : ""}</article>`;
}

function userPanel(user) {
  return `<form class="admin-panel inline-admin-form user-form" data-user="${h(user.id)}"><strong>${h(user.email)}</strong><input name="name" value="${h(user.name)}"><input name="phone" value="${h(user.phone || "")}"><select name="role">${["civilian", "pending_department", "police", "sheriff", "fire", "ems", "dispatcher", "department_supervisor", "site_admin", "owner"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}</select><label class="checkline"><input type="checkbox" name="suspended" ${user.suspended ? "checked" : ""}> Suspended</label><button class="button primary">Save</button></form>`;
}

function auditList(logs) {
  return `<div class="audit-list">${(logs || []).map((log) => `<article><span>${h(new Date(log.createdAt).toLocaleString())}</span><strong>${h(log.action)}</strong><p>${h(log.entity)}${log.entityId ? ` • ${h(log.entityId)}` : ""} • Actor: ${h(log.actor?.name || "system")}</p></article>`).join("")}</div>`;
}

function bindAdmin(data) {
  document.querySelectorAll("[data-admin-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      clearFlash();
      state.adminTab = button.dataset.adminTab;
      renderAdmin();
    })
  );
  document.querySelectorAll(".application-form [data-decision]").forEach((button) => {
    button.addEventListener("click", async () => {
      const form = button.closest("form");
      await submitAndReload(`/api/admin/applications/${encodeURIComponent(form.dataset.application)}/decision`, "POST", { ...formBody(form), decision: button.dataset.decision }, `Application ${button.dataset.decision}.`, renderAdmin);
    });
  });
  document.querySelectorAll(".user-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = formBody(form);
      body.suspended = form.querySelector("[name='suspended']").checked;
      await submitAndReload(`/api/admin/users/${encodeURIComponent(form.dataset.user)}`, "PATCH", body, "User updated.", renderAdmin);
    });
  });
  document.getElementById("createDepartmentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload("/api/admin/departments", "POST", formBody(event.currentTarget), "Department created.", renderAdmin);
  });
  document.getElementById("createRankForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = formBody(form);
    body.level = Number(body.level || 1);
    body.permissions = {
      cad: form.elements.cad.checked,
      records: form.elements.records.checked,
      roster: form.elements.roster.checked,
      unitManagement: form.elements.unitManagement.checked
    };
    await submitAndReload("/api/admin/ranks", "POST", body, "Rank / permission profile created.", renderAdmin);
  });
  document.getElementById("civilianRecordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formBody(event.currentTarget);
    const userId = body.userId;
    body.recordFlags = String(body.recordFlags || "").split(",").map((flag) => flag.trim()).filter(Boolean);
    await submitAndReload(`/api/admin/civilian-records/${encodeURIComponent(userId)}`, "PATCH", body, "Civilian record updated.", renderAdmin);
  });
  document.getElementById("deleteRecordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formBody(event.currentTarget);
    await submitAndReload(`/api/admin/records/${encodeURIComponent(body.type)}/${encodeURIComponent(body.id)}`, "DELETE", undefined, "Fake record deleted.", renderAdmin);
  });
  document.getElementById("settingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formBody(event.currentTarget);
    try {
      body.value = JSON.parse(body.value || "{}");
    } catch {
      state.error = "Setting value must be valid JSON.";
      return renderAdmin();
    }
    await submitAndReload("/api/admin/settings", "PATCH", body, "Server setting updated.", renderAdmin);
  });
}

async function render() {
  clearFlash();
  const path = location.pathname;
  try {
    if (path === "/civilian") return await renderCivilian();
    if (path === "/mdt") return await renderMdt();
    if (path === "/dispatch") return await renderDispatch();
    if (path === "/admin") return await renderAdmin();
    return await renderHome();
  } catch (error) {
    state.error = error.message || "Unable to render app.";
    setHtml(`<main class="center-screen"><section class="glass-panel access-panel"><p class="eyebrow">Application Fault</p><h1>CoreOne could not load this view.</h1><p>${h(state.error)}</p><a class="button primary" href="/" data-link>Return Home</a></section></main>${footer()}`);
  }
}

window.addEventListener("popstate", render);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

render();
