import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "JetBrains Mono", "monospace"],
      },
      colors: {
        // Canvas layers
        canvas:      "var(--ps-canvas)",
        "surface-0": "var(--ps-surface-0)",
        "surface-1": "var(--ps-surface-1)",
        "surface-2": "var(--ps-surface-2)",
        "surface-3": "var(--ps-surface-3)",
        // Borders — hair-thin dividers only
        "border-0":  "var(--ps-border-0)",
        "border-1":  "var(--ps-border-1)",
        "border-2":  "var(--ps-border-2)",
        // Typography
        "text-primary":   "var(--ps-text-primary)",
        "text-secondary": "var(--ps-text-secondary)",
        "text-tertiary":  "var(--ps-text-tertiary)",
        "text-inverse":   "var(--ps-text-inverse)",
        // Accent — Safety Orange #FF5A00 (max 5% real estate)
        accent:          "var(--ps-accent)",
        "accent-dim":    "var(--ps-accent-dim)",
        "accent-muted":  "var(--ps-accent-muted)",
        "accent-border": "var(--ps-accent-border)",
        // Semantic status
        "status-match":       "var(--ps-status-match)",
        "status-match-bg":    "var(--ps-status-match-bg)",
        "status-drift":       "var(--ps-status-drift)",
        "status-drift-bg":    "var(--ps-status-drift-bg)",
        "status-shortage":    "var(--ps-status-shortage)",
        "status-shortage-bg": "var(--ps-status-shortage-bg)",
        "status-new":         "var(--ps-status-new)",
        "status-new-bg":      "var(--ps-status-new-bg)",
        "status-pending":     "var(--ps-status-pending)",
        "status-pending-bg":  "var(--ps-status-pending-bg)",
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px", letterSpacing: "0.04em"  }],
        xs:    ["11px", { lineHeight: "16px", letterSpacing: "0.02em"  }],
        sm:    ["13px", { lineHeight: "20px", letterSpacing: "0.01em"  }],
        base:  ["14px", { lineHeight: "22px", letterSpacing: "0"       }],
        lg:    ["16px", { lineHeight: "24px", letterSpacing: "-0.01em" }],
        xl:    ["18px", { lineHeight: "26px", letterSpacing: "-0.015em"}],
        "2xl": ["22px", { lineHeight: "30px", letterSpacing: "-0.02em" }],
        "3xl": ["28px", { lineHeight: "36px", letterSpacing: "-0.025em"}],
      },
      boxShadow: {
        "hard-sm": "1px 1px 0 0 var(--ps-border-0)",
        "hard-md": "2px 2px 0 0 var(--ps-border-0)",
        focus:     "0 0 0 2px var(--ps-focus)",
        none:      "none",
      },
      animation: {
        "scan-pulse":  "scanPulse 1.5s ease-out forwards",
        "error-shake": "errorShake 300ms ease-out forwards",
        "value-tick":  "valueTick 120ms ease-out forwards",
        "modal-in":    "modalIn 140ms cubic-bezier(0.16,1,0.3,1) forwards",
        "fade-in":     "fadeIn 150ms ease-out forwards",
        spinner:       "spin 700ms linear infinite",
      },
      keyframes: {
        scanPulse: {
          "0%":   { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "#22C55E" },
          "60%":  { backgroundColor: "rgba(34,197,94,0.06)", borderColor: "#22C55E" },
          "100%": { backgroundColor: "transparent",           borderColor: "var(--ps-border-0)" },
        },
        errorShake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-3px)" },
          "80%": { transform: "translateX(3px)" },
        },
        valueTick: {
          "0%":   { opacity: "0.4", transform: "translateY(-2px)" },
          "100%": { opacity: "1",   transform: "translateY(0)" },
        },
        modalIn: {
          "0%":   { opacity: "0", transform: "scale(0.97) translateY(4px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
