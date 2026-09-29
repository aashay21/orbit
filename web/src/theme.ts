import { useEffect } from "react";
import { useStore, type ThemePref } from "./store";

const media = matchMedia("(prefers-color-scheme: dark)");

const resolve = (pref: ThemePref) => (pref === "auto" ? (media.matches ? "night" : "dawn") : pref);

function paint(theme: "night" | "dawn") {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#05060d" : "#f5f2ed");
}

/**
 * Switches theme. Where the browser supports view transitions, the new sky spreads out
 * in a circle from `origin` (usually the toggle that was clicked).
 */
export function setTheme(pref: ThemePref, origin?: { x: number; y: number }) {
  try {
    localStorage.setItem("orbit.theme", pref);
  } catch {
    /* ignore */
  }
  useStore.getState().set({ themePref: pref });
  const next = resolve(pref);
  if (document.documentElement.dataset.theme === next) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || reduced) return paint(next);

  const x = origin?.x ?? innerWidth / 2;
  const y = origin?.y ?? innerHeight / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const t = doc.startViewTransition(() => paint(next));
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: "cubic-bezier(.3,.7,.2,1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
}

export const THEME_ORDER: ThemePref[] = ["night", "dawn", "auto"];

export function cycleTheme(origin?: { x: number; y: number }) {
  const cur = useStore.getState().themePref;
  setTheme(THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length], origin);
}

/** Keeps "auto" in sync with the OS setting. */
export function useSystemTheme() {
  const pref = useStore((s) => s.themePref);
  useEffect(() => {
    if (pref !== "auto") return;
    const onChange = () => paint(resolve("auto"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);
}
