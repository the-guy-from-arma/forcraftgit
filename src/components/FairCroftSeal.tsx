export function FairCroftSeal({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "fc-seal fc-seal--compact" : "fc-seal"} aria-label="FairCroft Government Services seal">
      <svg className="fc-seal__art" viewBox="0 0 240 240" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="fcSealGold" x1="42" x2="198" y1="28" y2="214" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fff0b8" />
            <stop offset="0.42" stopColor="#d7b46a" />
            <stop offset="1" stopColor="#8d6422" />
          </linearGradient>
          <linearGradient id="fcSealBlue" x1="66" x2="174" y1="58" y2="190" gradientUnits="userSpaceOnUse">
            <stop stopColor="#14263d" />
            <stop offset="1" stopColor="#050b14" />
          </linearGradient>
        </defs>
        <circle cx="120" cy="120" r="112" fill="#050b14" stroke="url(#fcSealGold)" strokeWidth="6" />
        <circle cx="120" cy="120" r="94" fill="none" stroke="rgba(101,245,209,.34)" strokeWidth="1.5" strokeDasharray="4 7" />
        <circle cx="120" cy="120" r="76" fill="url(#fcSealBlue)" stroke="rgba(215,180,106,.72)" strokeWidth="2" />
        <path d="M120 58 171 80v39c0 36-20 61-51 76-31-15-51-40-51-76V80l51-22Z" fill="rgba(215,180,106,.1)" stroke="url(#fcSealGold)" strokeWidth="3" />
        <path d="M88 116h64M96 98h48M101 134h38M120 76v82" stroke="#d7b46a" strokeWidth="5" strokeLinecap="round" />
        <path d="M94 156c16 10 36 10 52 0" fill="none" stroke="#65f5d1" strokeWidth="3" strokeLinecap="round" />
        <path d="M51 123c8-24 20-42 39-55M189 123c-8-24-20-42-39-55" fill="none" stroke="rgba(215,180,106,.72)" strokeWidth="3" strokeLinecap="round" />
        <text x="120" y="35" textAnchor="middle" className="fc-seal__text-top">
          FAIRCROFT
        </text>
        <text x="120" y="215" textAnchor="middle" className="fc-seal__text-bottom">
          GOVERNMENT SERVICES
        </text>
      </svg>
      <div className="fc-seal__core">
        <strong>FC</strong>
        <small>COREONE</small>
      </div>
    </div>
  );
}
