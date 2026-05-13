import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist"', '"Geist Sans"', "-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', "sans-serif"],
        mono: ['"Geist Mono"', '"JetBrains Mono"', "ui-monospace", '"SF Mono"', "Menlo", "monospace"],
      },
      colors: {
        bg: "var(--bg)",
        "bg-elev": "var(--bg-elev)",
        "bg-sidebar": "var(--bg-sidebar)",
        "bg-hover": "var(--bg-hover)",
        "bg-active": "var(--bg-active)",
        "bg-input": "var(--bg-input)",
        "bg-chip": "var(--bg-chip)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        "border-input": "var(--border-input)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        "text-subtle": "var(--text-subtle)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-soft": "var(--accent-soft)",
        success: "var(--success)",
        "success-soft": "var(--success-soft)",
        warning: "var(--warning)",
        "warning-soft": "var(--warning-soft)",
        error: "var(--error)",
        "error-soft": "var(--error-soft)",
        info: "var(--info)",
        "info-soft": "var(--info-soft)",
      },
      borderRadius: {
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      keyframes: {
        "pulse-dot": { "0%, 100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: ".5", transform: "scale(.85)" } },
        "slide-in-right": { from: { transform: "translateX(8px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        "row-flash": { from: { background: "var(--accent-soft)" }, to: { background: "transparent" } },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
        "slide-in-right": "slide-in-right .2s ease",
        "row-flash": "row-flash .8s ease-out",
      },
    },
  },
};

export default config;
