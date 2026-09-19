/**
 * Small shared hooks.
 */

import { useEffect, type RefObject } from "react";

/**
 * Invoke `onOutside` when a pointer or focus event lands outside `ref`.
 * Used to dismiss the role switcher and the alert rail without a library.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;

    const handler = (event: MouseEvent | TouchEvent) => {
      const element = ref.current;
      if (!element) return;
      if (event.target instanceof Node && !element.contains(event.target)) {
        onOutside();
      }
    };

    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOutside();
    };

    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [ref, onOutside, active]);
}
