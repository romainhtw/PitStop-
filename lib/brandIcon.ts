/**
 * PitStop app icon — single source of truth.
 * A bold white "P" with speed streaks on a warm orange tile (full-bleed so it
 * works as an iOS home-screen tile and an Android maskable icon).
 * Rendered to PNG at various sizes via next/og ImageResponse.
 */
export const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FF7A2A"/>
      <stop offset="1" stop-color="#F23D00"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g fill="#FFFFFF" opacity="0.22">
    <rect x="74" y="232" width="110" height="22" rx="11"/>
    <rect x="62" y="270" width="140" height="22" rx="11"/>
    <rect x="74" y="308" width="96" height="22" rx="11"/>
  </g>
  <path fill="#FFFFFF" fill-rule="evenodd" d="M200 132 H300 a96 96 0 0 1 0 192 H266 V400 H200 Z M266 188 V268 H300 a40 40 0 0 0 0 -80 Z"/>
</svg>`;

export function brandIconDataUri(): string {
  // utf8-encoded data URI — works in any runtime, no Buffer/btoa needed
  return `data:image/svg+xml;utf8,${encodeURIComponent(BRAND_ICON_SVG)}`;
}
