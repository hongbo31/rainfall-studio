import { useEffect, useRef } from "react";

/** Keep optional help inside the viewport and above the persistent player. */
export function useHelpPosition() {
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const focusFrame = useRef<number | null>(null);
  const position = (revealTrigger = false) => {
    const button = trigger.current,
      popup = tooltip.current;
    if (!button || !popup) return;
    if (revealTrigger && !button.closest("footer"))
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
    const anchor = button.getBoundingClientRect();
    const player = document.querySelector("footer")?.getBoundingClientRect();
    const bottom = Math.min(
      innerHeight - 12,
      player ? player.top - 12 : innerHeight - 12,
    );
    popup.style.maxWidth = Math.max(24, Math.min(340, innerWidth - 24)) + "px";
    popup.style.maxHeight = Math.min(420, innerHeight * 0.65) + "px";
    const size = popup.getBoundingClientRect();
    const below = bottom - anchor.bottom - 8,
      above = anchor.top - 20;
    const placeBelow = size.height <= below || below >= above;
    popup.style.maxHeight =
      Math.max(
        24,
        Math.min(420, innerHeight * 0.65, placeBelow ? below : above),
      ) + "px";
    const height = popup.getBoundingClientRect().height;
    popup.style.left =
      Math.max(12, Math.min(anchor.left, innerWidth - size.width - 12)) + "px";
    popup.style.top =
      Math.max(
        12,
        Math.min(
          placeBelow ? anchor.bottom + 8 : anchor.top - height - 8,
          bottom - height,
        ),
      ) + "px";
    popup.style.right = "auto";
    popup.style.bottom = "auto";
    if (revealTrigger && !button.closest("footer")) {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      // Native focus scrolling runs after the focus handler; correct the final position next frame.
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        if (document.activeElement !== button || !button.isConnected) return;
        const rect = button.getBoundingClientRect();
        const safeBottom =
          (document.querySelector("footer")?.getBoundingClientRect().top ??
            innerHeight) - 12;
        if (rect.bottom > safeBottom)
          window.scrollBy(0, rect.bottom - safeBottom);
        else if (rect.top < 12) window.scrollBy(0, rect.top - 12);
        position();
      });
    }
  };
  useEffect(() => {
    const update = () => {
      if (
        document.activeElement === trigger.current ||
        trigger.current?.parentElement?.matches(":hover")
      )
        position();
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);
  return { trigger, tooltip, position };
}
