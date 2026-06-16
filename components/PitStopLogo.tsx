export default function PitStopLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Mark — checkered flag geometry, hard edges */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-hidden="true"
      >
        <rect x="0"  y="0"  width="9" height="9" fill="currentColor" />
        <rect x="11" y="0"  width="9" height="9" fill="currentColor" opacity="0.22" />
        <rect x="0"  y="11" width="9" height="9" fill="currentColor" opacity="0.22" />
        <rect x="11" y="11" width="9" height="9" fill="currentColor" />
        {/* Diagonal slash — speed vector */}
        <line x1="0" y1="20" x2="20" y2="0" stroke="#FF5A00" strokeWidth="2" strokeLinecap="square" />
      </svg>

      {/* Wordmark — Geist Sans, tight tracking */}
      <div className="font-sans leading-none select-none tracking-tight">
        <span className="text-lg font-semibold text-text-primary">PIT</span>
        <span className="text-lg font-semibold text-text-tertiary">STOP</span>
      </div>
    </div>
  );
}
