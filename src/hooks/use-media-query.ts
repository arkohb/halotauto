"use client";

import { useEffect, useState } from "react";

/** Client-side media query hook — SSR-safe (defaults false, corrects after mount). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const mql = window.matchMedia(query);
      const onChange = () => setMatches(mql.matches);
      onChange();
      mql.addEventListener("change", onChange);
      cleanupRef.current = () => mql.removeEventListener("change", onChange);
    }, 0);
    return () => {
      window.clearTimeout(t);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [query]);

  return matches;
}

// holder so the listener added inside the timeout can be removed on unmount
const cleanupRef: { current: (() => void) | null } = { current: null };
