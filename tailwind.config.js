/** @type {import('tailwindcss').Config} */
// v0.2 Design Tokens — synced with hermes-tray-UI设计要求.md §五
// Colors reference CSS variables in src/styles.css so dark/light toggle is class-driven.
export default {
  darkMode: ["class"], // toggle .dark class on <html> to switch themes

  content: ["./src/**/*.{ts,tsx,html}"],

  theme: {
    container: {
      center: true,
      padding: "1rem",
    },

    extend: {
      // Brand & semantic colors — all from CSS variables, see styles.css
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },

      // Spacing grid: 4 / 8 / 12 / 16 / 24 / 32 / 48 (already in default Tailwind)
      borderRadius: {
        sm: "4px",   // checkbox / radio / tag
        md: "8px",   // button / input / small card
        lg: "12px",  // large card / dropdown
        xl: "16px",  // modal
        "2xl": "24px", // hero / decorative
      },

      // Three-tier shadow system
      boxShadow: {
        sm: "0 1px 2px rgba(0, 0, 0, 0.05)",
        DEFAULT: "0 4px 12px rgba(0, 0, 0, 0.08)", // md — card hover / dropdown
        lg: "0 20px 60px rgba(0, 0, 0, 0.15)",       // modal
        xl: "0 30px 90px rgba(0, 0, 0, 0.25)",       // splash / fullscreen
      },

      // Animation timing — fast / normal / slow
      transitionDuration: {
        fast: "150ms",
        normal: "250ms",
        slow: "400ms",
      },

      // Font stack
      fontFamily: {
        sans: [
          "Inter",
          "HarmonyOS Sans",
          "PingFang SC",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "Menlo", "Consolas", "monospace"],
      },

      // Keyboard hint chip style
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 250ms ease-out",
        "slide-in-right": "slide-in-right 250ms ease-out",
      },
    },
  },

  plugins: [],
};