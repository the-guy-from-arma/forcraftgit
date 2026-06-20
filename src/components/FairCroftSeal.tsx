export function FairCroftSeal({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "fc-seal fc-seal--compact" : "fc-seal"} aria-label="FairCroft Government Services seal">
      <div className="fc-seal__ring">
        <span>FairCroft</span>
        <span>Government Services</span>
      </div>
      <div className="fc-seal__core">
        <span className="fc-seal__star">✦</span>
        <strong>FC</strong>
        <small>COREONE</small>
      </div>
    </div>
  );
}
