"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AccessPanel } from "./AccessPanel";
import { FairCroftSeal } from "./FairCroftSeal";
import { Footer } from "./Footer";
import { apiFetch, logout } from "@/lib/api-client";
import { canUseAdmin, canUseDispatch, canUseGovernment, canUseMdt, roleLabel } from "@/lib/roles";
import { useAuth } from "./useAuth";

const civilianApps = [
  { name: "Account Creation", badge: "AC", tone: "gold" },
  { name: "DMV Services", badge: "DMV", tone: "blue" },
  { name: "Bank System", badge: "BANK", tone: "green" },
  { name: "911 Call", badge: "911", tone: "red" },
  { name: "Profile", badge: "ID", tone: "navy" },
  { name: "Passport", badge: "PP", tone: "gold" },
  { name: "Driver License", badge: "DL", tone: "blue" },
  { name: "Vehicle Registration", badge: "VR", tone: "green" },
  { name: "Firearm Permit", badge: "FP", tone: "slate" },
  { name: "Business License", badge: "BL", tone: "gold" },
  { name: "Warrants", badge: "WR", tone: "red" },
  { name: "Tickets/Citations", badge: "TC", tone: "red" },
  { name: "Emergency Contacts", badge: "EC", tone: "green" },
  { name: "Civilian Records", badge: "CR", tone: "slate" },
  { name: "Court Notices", badge: "CT", tone: "gold" },
  { name: "Department Applications", badge: "JOB", tone: "blue" },
  { name: "My Jobs", badge: "OS", tone: "green" },
  { name: "Government OS", badge: "GOV", tone: "navy" }
] as const;

type CivilianAppName = (typeof civilianApps)[number]["name"];

export function CivilianPortal() {
  const { user, loading, error, allowed, refresh } = useAuth("civilian");
  const [booting, setBooting] = useState(true);
  const [activeApp, setActiveApp] = useState<CivilianAppName>("Account Creation");
  const [overview, setOverview] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [overviewPayload, departmentPayload] = await Promise.all([
        apiFetch<any>("/api/civilian/overview"),
        apiFetch<{ departments: any[] }>("/api/departments")
      ]);
      setOverview(overviewPayload);
      setDepartments(departmentPayload.departments);
      setStartupError(null);
      await refresh();
    } catch (err) {
      setStartupError(err instanceof Error ? err.message : "FairCroft PDA services did not respond.");
    }
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 1750);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [allowed, load]);

  async function submitDepartmentApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitFromForm(event, "/api/civilian/applications", "Department application submitted to FairCroft administration.");
  }

  async function submit911(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitFromForm(event, "/api/civilian/911", "911 request transmitted to FairCroft Communications Dispatch.");
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/civilian/profile", "PATCH", {
      phone: String(form.get("phone") || ""),
      address: String(form.get("address") || ""),
      city: String(form.get("city") || "FairCroft"),
      state: String(form.get("state") || "FC"),
      postalCode: String(form.get("postalCode") || ""),
      characterPhotoUrl: String(form.get("characterPhotoUrl") || ""),
      characterPhotoNoticeAccepted: form.get("characterPhotoNoticeAccepted") === "on",
      notes: String(form.get("notes") || "")
    }, "Civilian profile updated.");
  }

  async function submitGovernmentApplication(event: FormEvent<HTMLFormElement>, type: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/civilian/dmv-applications", "POST", {
      ...Object.fromEntries(form.entries()),
      type,
      photoNoticeAccepted: form.get("photoNoticeAccepted") === "on"
    }, "Application transmitted to FairCroft Government Services.");
    event.currentTarget.reset();
  }

  async function submitFromForm(event: FormEvent<HTMLFormElement>, path: string, success: string) {
    await submit(path, "POST", Object.fromEntries(new FormData(event.currentTarget).entries()), success);
    event.currentTarget.reset();
  }

  async function submit(path: string, method: string, body: any, success: string) {
    setNotice(null);
    setFormError(null);
    try {
      await apiFetch(path, { method, body });
      setNotice(success);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "FairCroft service request failed.");
    }
  }

  const currentUser = overview?.user || user;
  const visibleApps = useMemo(
    () => civilianApps.filter((app) => app.name !== "Government OS" || canUseGovernment(currentUser?.role)),
    [currentUser?.role]
  );

  if (!allowed) {
    return (
      <AccessPanel
        loading={loading}
        error={error}
        title="Civilian session required"
        message="Please sign in to access your FairCroft PDA."
      />
    );
  }

  if (booting || (!overview && !startupError)) {
    return (
      <main className="pda-boot">
        <FairCroftSeal />
        <div className="boot-progress">
          <span />
        </div>
        <p>Booting FairCroft Government Services PDA...</p>
      </main>
    );
  }

  if (startupError && !overview) {
    return (
      <AccessPanel
        title="PDA service unavailable"
        error={startupError}
        message="FairCroft Government Services could not load your civilian PDA session."
      />
    );
  }

  return (
    <>
      <main className="phone-os-shell">
        <section className="phone-frame phone-frame--home">
          <div className="phone-notch" />
          <div className="phone-wallpaper-orb orb-a" />
          <div className="phone-wallpaper-orb orb-b" />
          <div className="phone-status">
            <span>FairCroft LTE</span>
            <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>

          <div className="phone-home-hero">
            <FairCroftSeal compact />
            <div>
              <p className="eyebrow">Government Services OS</p>
              <h1>{currentUser?.profile?.firstName || currentUser?.name?.split(" ")[0]} PDA</h1>
              <p>{roleLabel(currentUser?.role)}</p>
            </div>
          </div>

          <div className="passport-mini">
            <div className="mini-photo">
              {currentUser?.profile?.characterPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentUser.profile.characterPhotoUrl} alt="Roleplay character" />
              ) : (
                <span>NO PHOTO</span>
              )}
            </div>
            <div>
              <strong>{currentUser?.name}</strong>
              <small>{currentUser?.profile?.passportNumber || "Passport not issued"}</small>
              <small>{currentUser?.profile?.verificationStatus || "unverified"}</small>
            </div>
          </div>

          {currentUser?.role === "unverified_civ" && (
            <button className="os-alert-pill" onClick={() => setActiveApp("Account Creation")}>
              Unverified civilian - finish account creation and DMV/passport intake
            </button>
          )}

          <div className="os-command-ribbon">
            <span>OS APPS ENABLED</span>
            <strong>{visibleApps.length}</strong>
            <small>{overview?.jobs?.length || 0} jobs assigned</small>
          </div>

          <div className="app-grid phone-app-grid">
            {visibleApps.map((app) => (
              <button
                key={app.name}
                className={activeApp === app.name ? "app-icon active" : "app-icon"}
                onClick={() => setActiveApp(app.name)}
              >
                <span className={`app-badge app-badge--${app.tone}`}>{app.badge}</span>
                <small>{app.name}</small>
              </button>
            ))}
          </div>

          <div className="phone-dock">
            <button onClick={() => setActiveApp("911 Call")}>911</button>
            <button onClick={() => setActiveApp("DMV Services")}>DMV</button>
            <button onClick={() => setActiveApp("My Jobs")}>Jobs</button>
          </div>
        </section>

        <section className="os-stage">
          {notice && <div className="toast-card success-strip">{notice}</div>}
          {formError && <div className="toast-card error-strip">{formError}</div>}
          <AppWindow title={activeApp} onClose={() => setActiveApp("Profile")}>
            <CivilianAppContent
              activeApp={activeApp}
              overview={overview}
              departments={departments}
              submitDepartmentApplication={submitDepartmentApplication}
              submit911={submit911}
              submitProfile={submitProfile}
              submitGovernmentApplication={submitGovernmentApplication}
              openApp={setActiveApp}
            />
          </AppWindow>
          <div className="floating-actions">
            {canUseMdt(currentUser?.role) && <Link href="/mdt">Open MDT</Link>}
            {canUseDispatch(currentUser?.role) && <Link href="/dispatch">Dispatch</Link>}
            {canUseGovernment(currentUser?.role) && <Link href="/government">Government OS</Link>}
            {canUseAdmin(currentUser?.role) && <Link href="/admin">Admin</Link>}
            <button
              onClick={async () => {
                await logout();
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function AppWindow({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="app-window">
      <div className="window-chrome">
        <div className="window-lights">
          <span />
          <span />
          <span />
        </div>
        <strong>{title}</strong>
        <button onClick={onClose}>Minimize</button>
      </div>
      <div className="window-body">{children}</div>
    </div>
  );
}

function CivilianAppContent({
  activeApp,
  overview,
  departments,
  submitDepartmentApplication,
  submit911,
  submitProfile,
  submitGovernmentApplication,
  openApp
}: {
  activeApp: CivilianAppName;
  overview: any;
  departments: any[];
  submitDepartmentApplication: (event: FormEvent<HTMLFormElement>) => void;
  submit911: (event: FormEvent<HTMLFormElement>) => void;
  submitProfile: (event: FormEvent<HTMLFormElement>) => void;
  submitGovernmentApplication: (event: FormEvent<HTMLFormElement>, type: string) => void;
  openApp: (app: CivilianAppName) => void;
}) {
  const profile = overview.user?.profile;
  const departmentChoices = departments.filter((department) =>
    ["police", "sheriff", "fire", "ems", "dispatch"].includes(department.type)
  );

  if (activeApp === "Account Creation") {
    return (
      <div className="os-intake">
        <section className="intake-hero">
          <span className="hero-glyph">FC</span>
          <div>
            <p className="eyebrow">Civilian OS Enrollment</p>
            <h2>Finish your FairCroft identity setup</h2>
            <p>
              Unverified accounts can still use the phone OS, submit DMV/passport intake, register vehicles, request jobs,
              and place roleplay 911 calls. Government staff approve records before they become searchable in MDT.
            </p>
          </div>
        </section>
        <div className="status-steps">
          <button className={profile?.characterPhotoUrl ? "complete" : ""} onClick={() => openApp("Profile")}>
            <span>01</span>
            Add character photo
            <small>Game character only, never a real photo</small>
          </button>
          <button className={profile?.verificationStatus === "verified" ? "complete" : ""} onClick={() => openApp("Passport")}>
            <span>02</span>
            Request passport / civilian ID
            <small>Needed for verified civilian status</small>
          </button>
          <button onClick={() => openApp("DMV Services")}>
            <span>03</span>
            Open DMV Services
            <small>License, vehicle, permits, business license</small>
          </button>
          <button onClick={() => openApp("Department Applications")}>
            <span>04</span>
            Apply for a job
            <small>LEO, Sheriff, Fire, EMS, Dispatch</small>
          </button>
        </div>
      </div>
    );
  }

  if (activeApp === "DMV Services") {
    return (
      <div className="dmv-hub">
        <section className="dmv-counter">
          <p className="eyebrow">FairCroft DMV / Government Services</p>
          <h2>Public service counter</h2>
          <p>
            Submit fictional roleplay applications. Approved records persist in PostgreSQL and become visible to authorized
            government/MDT searches.
          </p>
        </section>
        <div className="service-tile-grid">
          <button onClick={() => openApp("Passport")}>
            <span>PP</span>
            Passport / Civilian ID
            <small>{profile?.passportNumber || "Not issued"}</small>
          </button>
          <button onClick={() => openApp("Driver License")}>
            <span>DL</span>
            Driver License
            <small>{overview.licenses?.length || 0} records</small>
          </button>
          <button onClick={() => openApp("Vehicle Registration")}>
            <span>VR</span>
            Vehicle Registration
            <small>{overview.vehicles?.length || 0} vehicles</small>
          </button>
          <button onClick={() => openApp("Firearm Permit")}>
            <span>FP</span>
            Firearm Permit
            <small>{overview.permits?.filter((permit: any) => permit.type.toLowerCase().includes("firearm")).length || 0} records</small>
          </button>
          <button onClick={() => openApp("Business License")}>
            <span>BL</span>
            Business License
            <small>Roleplay commerce</small>
          </button>
        </div>
        <RecordList records={overview.governmentApplications} empty="No DMV or government-service applications submitted yet." fields={["type", "status", "submittedAt", "decisionReason"]} />
      </div>
    );
  }

  if (activeApp === "Bank System") {
    return (
      <div className="bank-system">
        <section className="bank-card premium-card">
          <p className="eyebrow">FairCroft First Bank</p>
          <h2>Roleplay banking profile</h2>
          <p>Fictional economy surface for roleplay only. No real money, payments, or financial integrations.</p>
          <div className="bank-balance">
            <span>Account status</span>
            <strong>{profile?.verificationStatus === "verified" ? "Eligible" : "Identity review required"}</strong>
          </div>
        </section>
        <div className="bank-ledger">
          <article>
            <span>Checking</span>
            <strong>Pending issuance</strong>
            <small>Requires verified civilian ID.</small>
          </article>
          <article>
            <span>Business account</span>
            <strong>{overview.permits?.some((permit: any) => permit.type.toLowerCase().includes("business")) ? "Eligible" : "Needs business license"}</strong>
            <small>Apply through DMV Services.</small>
          </article>
          <article>
            <span>RP safety</span>
            <strong>No real transactions</strong>
            <small>For in-server storytelling only.</small>
          </article>
        </div>
        <div className="button-row">
          <button className="button primary" onClick={() => openApp("Passport")}>Verify Identity</button>
          <button className="button ghost" onClick={() => openApp("Business License")}>Business License</button>
        </div>
      </div>
    );
  }

  if (activeApp === "Profile") {
    return (
      <div className="passport-layout">
        <section className="passport-card">
          <p className="eyebrow">FairCroft Civilian Passport</p>
          <div className="passport-face">
            <div className="character-photo">
              {profile?.characterPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.characterPhotoUrl} alt="Roleplay character" />
              ) : (
                <span>PHOTO</span>
              )}
            </div>
            <div>
              <h2>{overview.user?.name}</h2>
              <p>{profile?.address || "No address on file"}</p>
              <dl>
                <div>
                  <dt>Role</dt>
                  <dd>{roleLabel(overview.user?.role)}</dd>
                </div>
                <div>
                  <dt>Passport</dt>
                  <dd>{profile?.passportNumber || "Not issued"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{profile?.verificationStatus || "unverified"}</dd>
                </div>
              </dl>
            </div>
          </div>
          <small className="photo-rule">Photo must be of a game character photo, not a real photo.</small>
        </section>

        <form className="stack-form agency-form" onSubmit={submitProfile}>
          <h3>Update character profile</h3>
          <div className="two-col">
            <label>
              Phone
              <input name="phone" defaultValue={overview.user?.phone || profile?.phone || ""} />
            </label>
            <label>
              Character photo URL
              <input name="characterPhotoUrl" defaultValue={profile?.characterPhotoUrl || ""} />
            </label>
          </div>
          <label>
            Street address
            <input name="address" defaultValue={profile?.address || ""} />
          </label>
          <div className="three-col">
            <label>
              City
              <input name="city" defaultValue={profile?.city || "FairCroft"} />
            </label>
            <label>
              State
              <input name="state" defaultValue={profile?.state || "FC"} />
            </label>
            <label>
              Postal code
              <input name="postalCode" defaultValue={profile?.postalCode || ""} />
            </label>
          </div>
          <label className="checkline fine-print">
            <input name="characterPhotoNoticeAccepted" type="checkbox" defaultChecked={profile?.characterPhotoNoticeAccepted} /> I confirm the profile/passport photo is a game character image, not a real person.
          </label>
          <textarea name="notes" placeholder="Optional civilian notes" defaultValue={profile?.notes || ""} />
          <button className="button primary">Save Profile</button>
        </form>
      </div>
    );
  }

  if (activeApp === "Passport") {
    return (
      <div className="split-admin">
        <form className="stack-form agency-form" onSubmit={(event) => submitGovernmentApplication(event, "passport")}>
          <h3>Passport / Civilian ID Application</h3>
          <p className="muted">Used for fictional FairCroft identity verification. This is not a real passport or government ID.</p>
          <input name="legalName" defaultValue={overview.user?.name || ""} placeholder="Legal RP character name" />
          <input name="characterPhotoUrl" defaultValue={profile?.characterPhotoUrl || ""} placeholder="Character photo URL" />
          <textarea name="passportReason" rows={4} placeholder="Reason for passport / civilian ID request" />
          <label className="checkline fine-print">
            <input name="photoNoticeAccepted" type="checkbox" required /> Photo must be of Game character photo, not real photo.
          </label>
          <button className="button primary">Submit Passport Application</button>
        </form>
        <RecordList
          records={overview.governmentApplications?.filter((app: any) => app.type === "passport")}
          empty="No passport applications yet."
          fields={["type", "status", "submittedAt", "decisionReason"]}
        />
      </div>
    );
  }

  if (activeApp === "Driver License") {
    return (
      <div className="split-admin">
        <form className="stack-form agency-form" onSubmit={(event) => submitGovernmentApplication(event, "driver_license")}>
          <h3>DMV Driver License Intake</h3>
          <input name="legalName" defaultValue={overview.user?.name || ""} />
          <select name="licenseClass" defaultValue="D">
            <option value="D">Class D - Standard</option>
            <option value="M">Class M - Motorcycle</option>
            <option value="C">Class C - Commercial RP</option>
          </select>
          <textarea name="notes" rows={4} placeholder="Restrictions, RP notes, or training notes" />
          <button className="button primary">Request License Review</button>
        </form>
        <RecordList records={overview.licenses} empty="No driver license record has been issued." fields={["number", "class", "status", "expiresAt"]} />
      </div>
    );
  }

  if (activeApp === "Vehicle Registration") {
    return (
      <div className="split-admin">
        <form className="stack-form agency-form" onSubmit={(event) => submitGovernmentApplication(event, "vehicle_registration")}>
          <h3>Register Vehicle</h3>
          <div className="two-col">
            <input name="make" placeholder="Make" required />
            <input name="model" placeholder="Model" required />
          </div>
          <div className="three-col">
            <input name="year" type="number" min="1900" max="2100" placeholder="Year" required />
            <input name="color" placeholder="Color" required />
            <input name="plate" placeholder="Preferred plate" />
          </div>
          <input name="vin" placeholder="Optional fictional VIN" />
          <textarea name="notes" rows={3} placeholder="Vehicle roleplay notes" />
          <button className="button primary">Submit Registration</button>
        </form>
        <RecordList records={overview.vehicles} empty="No registered vehicles." fields={["plate", "year", "make", "model", "registrationStatus"]} />
      </div>
    );
  }

  if (activeApp === "Firearm Permit") {
    return (
      <PermitApp
        type="firearm_permit"
        title="Firearm Permit"
        records={overview.permits?.filter((permit: any) => permit.type.toLowerCase().includes("firearm"))}
        submitGovernmentApplication={submitGovernmentApplication}
      />
    );
  }

  if (activeApp === "Business License") {
    return (
      <PermitApp
        type="business_license"
        title="Business License"
        records={overview.permits?.filter((permit: any) => permit.type.toLowerCase().includes("business"))}
        submitGovernmentApplication={submitGovernmentApplication}
      />
    );
  }

  if (activeApp === "911 Call") {
    return (
      <form className="stack-form agency-form emergency-form" onSubmit={submit911}>
        <div className="warning-callout">Fictional roleplay 911. Do not use for real emergencies.</div>
        <p className="fine-print">
          Submissions transmit live to FairCroft Communications. If no dispatcher is clocked in, CoreOne attempts to
          auto-route the CAD incident to the first available on-shift police or sheriff unit.
        </p>
        <select name="emergencyType" required defaultValue="">
          <option value="" disabled>Select emergency type</option>
          <option>Police</option>
          <option>Fire</option>
          <option>EMS</option>
          <option>Traffic Collision</option>
          <option>Public Safety Hazard</option>
        </select>
        <input name="location" placeholder="Location / landmark / scene" required />
        <textarea name="description" rows={5} placeholder="What is happening right now?" required />
        <div className="two-col">
          <input name="callerName" defaultValue={overview.user?.name} required />
          <input name="callbackNumber" defaultValue={overview.user?.phone || profile?.phone || ""} required />
        </div>
        <button className="button danger">Transmit 911 Call</button>
      </form>
    );
  }

  if (activeApp === "Department Applications") {
    return (
      <div className="split-admin">
        <form className="stack-form agency-form" onSubmit={submitDepartmentApplication}>
          <h3>Apply for Department Job</h3>
          <select name="departmentId" required defaultValue="">
            <option value="" disabled>Select a FairCroft department</option>
            {departmentChoices.map((department) => (
              <option value={department.id} key={department.id}>{department.name}</option>
            ))}
          </select>
          <textarea name="statement" rows={5} required placeholder="Why do you want this LEO / Fire / EMS / Dispatch job?" />
          <textarea name="experience" rows={4} placeholder="Relevant roleplay experience" />
          <button className="button primary">Submit Department Application</button>
        </form>
        <RecordList records={overview.applications} empty="No department applications submitted yet." fields={["department.name", "status", "submittedAt", "decisionReason"]} />
      </div>
    );
  }

  if (activeApp === "My Jobs") {
    return (
      <div className="job-console">
        <h3>Assigned Jobs / Enabled OS Apps</h3>
        <p className="muted">Jobs are assigned by FairCroft administration. Approved jobs unlock MDT, Dispatch, or Government OS apps.</p>
        <RecordList records={overview.jobs} empty="No department or government jobs assigned yet." fields={["department.name", "jobTitle", "rank.name", "callSign", "role"]} />
        <div className="button-row">
          {canUseMdt(overview.user?.role) && <Link className="button terminal" href="/mdt">Open MDT</Link>}
          {canUseDispatch(overview.user?.role) && <Link className="button terminal" href="/dispatch">Open Dispatch</Link>}
          {canUseGovernment(overview.user?.role) && <Link className="button primary" href="/government">Open Government OS</Link>}
        </div>
      </div>
    );
  }

  if (activeApp === "Government OS") {
    return (
      <div className="empty-agency">
        <span>GOV</span>
        <h3>Government employee access enabled</h3>
        <p>Open the FairCroft Government OS for DMV approvals, identity records, and civilian service queues.</p>
        <Link className="button primary" href="/government">Launch Government OS</Link>
      </div>
    );
  }

  if (activeApp === "Warrants") {
    return <RecordList records={overview.warrants} empty="No active warrant records associated with this civilian." fields={["subjectName", "charges", "status", "severity"]} />;
  }

  if (activeApp === "Tickets/Citations") {
    return <RecordList records={overview.citations} empty="No citations on file." fields={["subjectName", "statute", "description", "status"]} />;
  }

  if (activeApp === "Civilian Records") {
    return (
      <div className="records-stack">
        <InfoCard label="Civilian ID" value={overview.user?.id} />
        <InfoCard label="Record flags" value={profile?.recordFlags?.length ? profile.recordFlags.join(", ") : "None"} />
        <InfoCard label="Administrative notes" value={profile?.notes || "No notes"} />
      </div>
    );
  }

  if (activeApp === "Court Notices") return <EmptyAgency title="Court Notices" body="No fictional FairCroft Municipal Court notices are pending." />;
  if (activeApp === "Emergency Contacts") return <EmptyAgency title="Emergency Contacts" body="No emergency contacts are attached to this profile yet." />;
  return null;
}

function PermitApp({
  type,
  title,
  records,
  submitGovernmentApplication
}: {
  type: string;
  title: string;
  records?: any[];
  submitGovernmentApplication: (event: FormEvent<HTMLFormElement>, type: string) => void;
}) {
  return (
    <div className="split-admin">
      <form className="stack-form agency-form" onSubmit={(event) => submitGovernmentApplication(event, type)}>
        <h3>{title} Application</h3>
        {type === "business_license" ? (
          <>
            <input name="businessName" placeholder="Business name" required />
            <input name="businessType" placeholder="Business type" />
          </>
        ) : (
          <input name="permitType" defaultValue="Firearm Permit" />
        )}
        <textarea name="notes" rows={5} placeholder="Roleplay justification and notes" />
        <button className="button primary">Submit {title}</button>
      </form>
      <RecordList records={records} empty={`No ${title.toLowerCase()} records issued.`} fields={["number", "type", "status", "expiresAt"]} />
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="info-card">
      <span>{label}</span>
      <strong>{String(value || "-")}</strong>
    </div>
  );
}

function valueAt(record: any, path: string) {
  return path.split(".").reduce((current, key) => current?.[key], record);
}

function RecordList({ records, empty, fields }: { records?: any[]; empty: string; fields: string[] }) {
  if (!records?.length) return <EmptyAgency title="No Records" body={empty} />;

  return (
    <div className="record-list">
      {records.map((record) => (
        <article className="record-card record-card--window" key={record.id}>
          {fields.map((field) => (
            <div key={field}>
              <span>{field.split(".").at(-1)}</span>
              <strong>{formatValue(valueAt(record, field))}</strong>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function formatValue(value: any) {
  if (!value) return "-";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleDateString();
  return String(value);
}

function EmptyAgency({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-agency">
      <span>FC</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
