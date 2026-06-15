import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        menuFadeIn: {
          from: { opacity: "0", transform: "scale(0.95) translateY(-5px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
      },
      animation: {
        menuFadeIn: "menuFadeIn 0.15s cubic-bezier(0.23, 1, 0.32, 1) forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
