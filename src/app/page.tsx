import { FairCroftSeal } from "@/components/FairCroftSeal";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        display: "grid",
        placeItems: "center",
        padding: "24px",
        color: "#f7fbff",
        background:
          "linear-gradient(rgba(101,245,209,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(101,245,209,.025) 1px, transparent 1px), radial-gradient(circle at 20% 10%, rgba(94,168,255,.22), transparent 32rem), radial-gradient(circle at 80% 90%, rgba(242,196,109,.14), transparent 30rem), linear-gradient(135deg, #02060d, #07111f 45%, #010409)",
        backgroundSize: "38px 38px, 38px 38px, auto, auto, auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
      }}
    >
      <section
        style={{
          width: "min(760px, 100%)",
          border: "1px solid rgba(154,172,194,.22)",
          borderTop: "2px solid rgba(215,180,106,.48)",
          borderRadius: "14px",
          padding: "clamp(24px, 6vw, 44px)",
          background: "linear-gradient(180deg, rgba(255,255,255,.055), transparent 44%), rgba(5,11,20,.88)",
          boxShadow: "0 24px 90px rgba(0,0,0,.5)"
        }}
      >
        <div style={{ marginBottom: "22px" }}>
          <FairCroftSeal />
        </div>
        <p
          style={{
            margin: "0 0 12px",
            color: "#f2c46d",
            fontSize: "12px",
            fontWeight: 900,
            letterSpacing: ".18em",
            textTransform: "uppercase"
          }}
        >
          FairCroft Government Services
        </p>
        <h1 style={{ margin: "0 0 14px", fontSize: "clamp(38px, 10vw, 76px)", lineHeight: ".95" }}>
          CoreOne is online.
        </h1>
        <p style={{ margin: "0 0 24px", color: "#cbd6e5", fontSize: "18px", lineHeight: 1.6 }}>
          Fictional roleplay civilian PDA, government services, CAD/MDT, and dispatch command platform.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <a
            href="/login"
            style={{
              border: "1px solid rgba(215,180,106,.42)",
              borderRadius: "8px",
              padding: "13px 18px",
              color: "#06101d",
              background: "linear-gradient(180deg, #f1d08a, #b7832c)",
              fontWeight: 900,
              letterSpacing: ".04em",
              textDecoration: "none"
            }}
          >
            Login
          </a>
          <a
            href="/register"
            style={{
              border: "1px solid rgba(101,245,209,.38)",
              borderRadius: "8px",
              padding: "13px 18px",
              color: "#9ef7da",
              background: "rgba(101,245,209,.08)",
              fontWeight: 900,
              letterSpacing: ".04em",
              textDecoration: "none"
            }}
          >
            Register
          </a>
        </div>
        <p style={{ margin: "24px 0 0", color: "#9aa7b7", fontSize: "13px" }}>
          Roleplay only. No real government, CJIS, NCIC, DMV, EMS, or law-enforcement database integration.
        </p>
      </section>
    </main>
  );
}
