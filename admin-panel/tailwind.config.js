/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gv: {
          bg: "#030818",
          navy: "#081B45",
          blue: "#0A4DCC",
          primary: "#1F6BFF",
          accent: "#3B82F6",
          glass: "rgba(255,255,255,0.06)",
          border: "rgba(255,255,255,0.12)",
          text: "#eef4ff",
          muted: "rgba(238,244,255,0.62)",
          success: "#00C853",
          warning: "#FFB300",
          danger: "#FF5252"
        }
      },
      borderRadius: {
        gv: "22px",
        "gv-sm": "14px"
      },
      boxShadow: {
        gv: "0 24px 60px rgba(0,0,0,0.45)",
        glow: "0 0 40px rgba(31,107,255,0.25)"
      },
      fontFamily: {
        sans: ["Inter", "Manrope", "system-ui", "sans-serif"]
      },
      animation: {
        shimmer: "shimmer 1.5s infinite",
        "fade-in": "fadeIn 0.35s ease-out",
        "slide-up": "slideUp 0.4s ease-out"
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        }
      }
    }
  },
  plugins: []
};
