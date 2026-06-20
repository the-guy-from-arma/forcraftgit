"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "2rem",
            color: "white",
            background: "#07111f",
            fontFamily: "system-ui, sans-serif"
          }}
        >
          <section
            style={{
              maxWidth: "620px",
              border: "1px solid rgba(255,255,255,.16)",
              borderRadius: "1.5rem",
              padding: "1.5rem",
              background: "rgba(255,255,255,.08)"
            }}
          >
            <p style={{ color: "#f2c46d", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase" }}>
              FairCroft CoreOne
            </p>
            <h1>Website failed to load</h1>
            <p>This is still a web PWA. Reload the page or clear Safari website data if the old shell is cached.</p>
            <pre style={{ whiteSpace: "pre-wrap", color: "#ffd3d6" }}>{error.message}</pre>
            <button
              style={{
                border: 0,
                borderRadius: "999px",
                padding: ".8rem 1rem",
                color: "#07111f",
                background: "#f2c46d",
                fontWeight: 900
              }}
              onClick={reset}
            >
              Reload Website
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
