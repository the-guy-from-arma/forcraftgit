import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <span>
        FairCroft CoreOne is a fictional roleplay CAD/MDT. No NCIC, CJIS, emergency-service, or real government
        integrations.
      </span>
      <Link href="/admin" className="admin-link">
        Admin Login
      </Link>
    </footer>
  );
}
