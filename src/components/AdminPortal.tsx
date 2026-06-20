"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AccessPanel } from "./AccessPanel";
import { Footer } from "./Footer";
import { apiFetch, logout } from "@/lib/api-client";
import { roleLabel } from "@/lib/roles";
import { useAuth } from "./useAuth";

const tabs = ["Overview", "Applications", "Users", "Departments", "Permissions", "Civilian Records", "Audit Logs", "Settings"] as const;

export function AdminPortal() {
  const { user, loading, error, allowed } = useAuth("admin");
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Overview");
  const [overview, setOverview] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    void loadAll();
  }, [allowed]);

  async function loadAll() {
    const [overviewPayload, appPayload, userPayload, deptPayload, auditPayload, settingPayload] = await Promise.all([
      apiFetch<any>("/api/admin/overview"),
      apiFetch<{ applications: any[] }>("/api/admin/applications"),
      apiFetch<{ users: any[] }>("/api/admin/users"),
      apiFetch<{ departments: any[] }>("/api/admin/departments"),
      apiFetch<{ auditLogs: any[] }>("/api/admin/audit-logs"),
      apiFetch<{ settings: any[] }>("/api/admin/settings")
    ]);
    setOverview(overviewPayload);
    setApplications(appPayload.applications);
    setUsers(userPayload.users);
    setDepartments(deptPayload.departments);
    setAuditLogs(auditPayload.auditLogs);
    setSettings(settingPayload.settings);
  }

  async function decideApplication(id: string, decision: "approved" | "denied", form?: HTMLFormElement | null) {
    setNotice(null);
    setFormError(null);
    const data = form ? (Object.fromEntries(new FormData(form).entries()) as Record<string, string>) : {};

    try {
      await apiFetch(`/api/admin/applications/${id}/decision`, {
        method: "POST",
        body: { ...data, decision }
      });
      setNotice(`Application ${decision}.`);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Decision failed.");
    }
  }

  async function updateUser(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const suspended = form.get("suspended") === "on";
    await submit(`/api/admin/users/${id}`, "PATCH", {
      role: String(form.get("role")),
      suspended,
      name: String(form.get("name")),
      phone: String(form.get("phone"))
    }, "User updated.");
  }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitFromForm(event, "/api/admin/departments", "POST", "Department created.");
  }

  async function createRank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/admin/ranks", "POST", {
      departmentId: String(form.get("departmentId")),
      name: String(form.get("name")),
      level: Number(form.get("level")),
      permissions: {
        cad: form.get("cad") === "on",
        records: form.get("records") === "on",
        roster: form.get("roster") === "on",
        unitManagement: form.get("unitManagement") === "on"
      }
    }, "Rank / permission profile created.");
    event.currentTarget.reset();
  }

  async function updateCivilianRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit(`/api/admin/civilian-records/${String(form.get("userId"))}`, "PATCH", {
      notes: String(form.get("notes")),
      recordFlags: String(form.get("recordFlags"))
        .split(",")
        .map((flag) => flag.trim())
        .filter(Boolean)
    }, "Civilian record updated.");
  }

  async function deleteRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit(`/api/admin/records/${String(form.get("type"))}/${String(form.get("id"))}`, "DELETE", undefined, "Fake record deleted.");
  }

  async function updateSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let value = {};
    try {
      value = JSON.parse(String(form.get("value") || "{}"));
    } catch {
      setFormError("Setting value must be valid JSON.");
      return;
    }

    await submit("/api/admin/settings", "PATCH", { key: String(form.get("key")), value }, "Server setting updated.");
  }

  async function submitFromForm(event: FormEvent<HTMLFormElement>, path: string, method: string, success: string) {
    await submit(path, method, Object.fromEntries(new FormData(event.currentTarget).entries()), success);
    event.currentTarget.reset();
  }

  async function submit(path: string, method: string, body: any, success: string) {
    setNotice(null);
    setFormError(null);
    try {
      await apiFetch(path, { method, body });
      setNotice(success);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Admin operation failed.");
    }
  }

  if (!allowed) {
    return <AccessPanel loading={loading} error={error} title="Admin console locked" message="Site admin or owner role required." />;
  }

  if (!overview) {
    return (
      <main className="admin-shell center-screen">
        <div className="glass-panel">Loading FairCroft administrative console…</div>
      </main>
    );
  }

  return (
    <>
      <main className="admin-shell">
        <aside className="admin-nav">
          <div className="admin-emblem">FC</div>
          <h1>CoreOne Admin</h1>
          <p>{user?.name} · {roleLabel(user?.role)}</p>
          {tabs.map((tab) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
          <div className="admin-links">
            <Link href="/civilian">PDA</Link>
            <Link href="/mdt">MDT</Link>
            <Link href="/dispatch">Dispatch</Link>
            <button
              onClick={async () => {
                await logout();
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </div>
        </aside>

        <section className="admin-workspace">
          <header className="admin-topbar">
            <div>
              <p className="eyebrow">Governance Console</p>
              <h2>{activeTab}</h2>
            </div>
            <span>Audit enforced</span>
          </header>
          {notice && <div className="success-strip">{notice}</div>}
          {formError && <div className="error-strip">{formError}</div>}
          <AdminTab
            tab={activeTab}
            overview={overview}
            applications={applications}
            users={users}
            departments={departments}
            auditLogs={auditLogs}
            settings={settings}
            decideApplication={decideApplication}
            updateUser={updateUser}
            createDepartment={createDepartment}
            createRank={createRank}
            updateCivilianRecord={updateCivilianRecord}
            deleteRecord={deleteRecord}
            updateSetting={updateSetting}
          />
        </section>
      </main>
      <Footer />
    </>
  );
}

function AdminTab(props: any) {
  const {
    tab,
    overview,
    applications,
    users,
    departments,
    auditLogs,
    settings,
    decideApplication,
    updateUser,
    createDepartment,
    createRank,
    updateCivilianRecord,
    deleteRecord,
    updateSetting
  } = props;

  if (tab === "Overview") {
    return (
      <div className="admin-grid">
        {Object.entries(overview.metrics).map(([key, value]) => (
          <div className="admin-metric" key={key}>
            <span>{key}</span>
            <strong>{String(value)}</strong>
          </div>
        ))}
        <div className="admin-panel wide">
          <h3>Recent Audit Activity</h3>
          <AuditList logs={overview.auditLogs} />
        </div>
      </div>
    );
  }

  if (tab === "Applications") {
    return (
      <div className="admin-list">
        {applications.map((application: any) => (
          <article className="admin-panel" key={application.id}>
            <div className="card-heading">
              <div>
                <h3>{application.user?.name}</h3>
                <p>{application.department?.name}</p>
              </div>
              <span className={`status-pill ${application.status}`}>{application.status}</span>
            </div>
            <p>{application.statement}</p>
            {application.experience && <small>Experience: {application.experience}</small>}
            {application.status === "pending" && (
              <form
                className="inline-admin-form"
                ref={(node) => {
                  application.form = node ?? undefined;
                }}
              >
                <select name="role" defaultValue={application.desiredRole || ""}>
                  <option value="">Department default</option>
                  <option value="police">Police</option>
                  <option value="sheriff">Sheriff</option>
                  <option value="fire">Fire</option>
                  <option value="ems">EMS</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="department_supervisor">Department Supervisor</option>
                </select>
                <select name="rankId" defaultValue="">
                  <option value="">No rank</option>
                  {application.department?.ranks?.map((rank: any) => (
                    <option key={rank.id} value={rank.id}>
                      {rank.name}
                    </option>
                  ))}
                </select>
                <input name="badgeNumber" placeholder="Badge / radio ID" />
                <input name="reason" placeholder="Decision note" />
                <button type="button" className="button primary" onClick={(event) => decideApplication(application.id, "approved", event.currentTarget.form)}>
                  Approve
                </button>
                <button type="button" className="button danger" onClick={(event) => decideApplication(application.id, "denied", event.currentTarget.form)}>
                  Deny
                </button>
              </form>
            )}
          </article>
        ))}
      </div>
    );
  }

  if (tab === "Users") {
    return (
      <div className="admin-list">
        {users.map((user: any) => (
          <form className="admin-panel inline-admin-form" key={user.id} onSubmit={(event) => updateUser(event, user.id)}>
            <strong>{user.email}</strong>
            <input name="name" defaultValue={user.name} />
            <input name="phone" defaultValue={user.phone || ""} />
            <select name="role" defaultValue={user.role}>
              {["civilian", "pending_department", "police", "sheriff", "fire", "ems", "dispatcher", "department_supervisor", "site_admin", "owner"].map((role) => (
                <option value={role} key={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
            <label className="checkline">
              <input type="checkbox" name="suspended" defaultChecked={user.suspended} /> Suspended
            </label>
            <button className="button primary">Save</button>
          </form>
        ))}
      </div>
    );
  }

  if (tab === "Departments") {
    return (
      <div className="split-admin">
        <form className="admin-panel stack-form" onSubmit={createDepartment}>
          <h3>Create Department</h3>
          <input name="name" placeholder="Department name" required />
          <input name="code" placeholder="Code" required />
          <select name="type" defaultValue="police">
            <option value="police">Police</option>
            <option value="sheriff">Sheriff</option>
            <option value="fire">Fire</option>
            <option value="ems">EMS</option>
            <option value="dispatch">Dispatch</option>
          </select>
          <textarea name="description" placeholder="Description" />
          <button className="button primary">Create</button>
        </form>
        <div className="admin-list">
          {departments.map((department: any) => (
            <article className="admin-panel" key={department.id}>
              <h3>{department.name}</h3>
              <p>{department.code} · {department.type}</p>
              <small>{department.description}</small>
              <p>{department.memberships?.length || 0} members · {department.ranks?.length || 0} ranks</p>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (tab === "Permissions") {
    return (
      <div className="split-admin">
        <form className="admin-panel stack-form" onSubmit={createRank}>
          <h3>Create Rank / Permission Profile</h3>
          <select name="departmentId" required defaultValue="">
            <option value="" disabled>
              Department
            </option>
            {departments.map((department: any) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <input name="name" placeholder="Rank name" required />
          <input name="level" type="number" min="1" max="999" defaultValue="10" />
          {["cad", "records", "roster", "unitManagement"].map((permission) => (
            <label className="checkline" key={permission}>
              <input name={permission} type="checkbox" defaultChecked /> {permission}
            </label>
          ))}
          <button className="button primary">Create Rank</button>
        </form>
        <div className="admin-list">
          {departments.flatMap((department: any) =>
            department.ranks?.map((rank: any) => (
              <article className="admin-panel" key={rank.id}>
                <h3>{rank.name}</h3>
                <p>{department.code} · Level {rank.level}</p>
                <pre>{JSON.stringify(rank.permissions, null, 2)}</pre>
              </article>
            ))
          )}
        </div>
      </div>
    );
  }

  if (tab === "Civilian Records") {
    return (
      <div className="split-admin">
        <form className="admin-panel stack-form" onSubmit={updateCivilianRecord}>
          <h3>Edit Civilian Record</h3>
          <select name="userId" required defaultValue="">
            <option value="" disabled>
              Select user
            </option>
            {users.map((user: any) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.email}
              </option>
            ))}
          </select>
          <textarea name="notes" placeholder="Admin-only roleplay notes" rows={5} />
          <input name="recordFlags" placeholder="Comma-separated flags" />
          <button className="button primary">Save Record</button>
        </form>
        <form className="admin-panel stack-form" onSubmit={deleteRecord}>
          <h3>Delete Fake Record</h3>
          <select name="type" required defaultValue="">
            <option value="" disabled>
              Record type
            </option>
            {["vehicle", "license", "permit", "warrant", "citation", "bolo", "incidentReport", "arrestReport", "fireReport", "emsReport"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input name="id" placeholder="Record ID" required />
          <button className="button danger">Delete Fake Record</button>
        </form>
      </div>
    );
  }

  if (tab === "Audit Logs") return <AuditList logs={auditLogs} />;

  if (tab === "Settings") {
    return (
      <div className="split-admin">
        <form className="admin-panel stack-form" onSubmit={updateSetting}>
          <h3>Server Setting</h3>
          <input name="key" placeholder="setting_key" required />
          <textarea name="value" rows={8} defaultValue={'{"enabled":true}'} />
          <button className="button primary">Save Setting</button>
        </form>
        <div className="admin-list">
          {settings.map((setting: any) => (
            <article className="admin-panel" key={setting.id}>
              <h3>{setting.key}</h3>
              <pre>{JSON.stringify(setting.value, null, 2)}</pre>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function AuditList({ logs }: { logs: any[] }) {
  return (
    <div className="audit-list">
      {logs.map((log) => (
        <article key={log.id}>
          <span>{new Date(log.createdAt).toLocaleString()}</span>
          <strong>{log.action}</strong>
          <p>
            {log.entity}
            {log.entityId ? ` · ${log.entityId}` : ""} · Actor: {log.actor?.name || "system"}
          </p>
        </article>
      ))}
    </div>
  );
}
