import Link from "next/link";

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
          "radial-gradient(circle at 20% 10%, rgba(94,168,255,.35), transparent 32rem), radial-gradient(circle at 80% 90%, rgba(242,196,109,.25), transparent 30rem), linear-gradient(135deg, #07111f, #0b1424 45%, #03060c)",
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
      }}
    >
      <section
        style={{
          width: "min(760px, 100%)",
          border: "1px solid rgba(255,255,255,.16)",
          borderRadius: "32px",
          padding: "clamp(24px, 6vw, 44px)",
          background: "rgba(255,255,255,.08)",
          boxShadow: "0 24px 80px rgba(0,0,0,.36)"
        }}
      >
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
          <Link
            href="/login"
            style={{
              borderRadius: "999px",
              padding: "13px 18px",
              color: "#06101d",
              background: "#f2c46d",
              fontWeight: 900,
              textDecoration: "none"
            }}
          >
            Login / Register
          </Link>
          <Link
            href="/civilian"
            style={{
              border: "1px solid rgba(255,255,255,.2)",
              borderRadius: "999px",
              padding: "13px 18px",
              color: "#f7fbff",
              background: "rgba(255,255,255,.08)",
              fontWeight: 900,
              textDecoration: "none"
            }}
          >
            Civilian PDA
          </Link>
          <Link
            href="/__coreone/preflight"
            style={{
              border: "1px solid rgba(255,255,255,.2)",
              borderRadius: "999px",
              padding: "13px 18px",
              color: "#9ef7da",
              background: "rgba(101,245,209,.08)",
              fontWeight: 900,
              textDecoration: "none"
            }}
          >
            Preflight Test
          </Link>
        </div>
        <p style={{ margin: "24px 0 0", color: "#9aa7b7", fontSize: "13px" }}>
          Roleplay only. No real government, CJIS, NCIC, DMV, EMS, or law-enforcement database integration.
        </p>
      </section>
    </main>
  );
}
