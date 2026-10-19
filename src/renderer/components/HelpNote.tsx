import React, { useId, useState } from "react";
import { useHelpPosition } from "./useHelpPosition";

/** A compact, keyboard-accessible label for optional page guidance. */
export default function HelpNote({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const { trigger, tooltip, position } = useHelpPosition();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className={"help-note help-hint" + (dismissed ? " is-dismissed" : "")}
      onMouseEnter={() => {
        setDismissed(false);
        position();
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="help-note-trigger"
        aria-describedby={id}
        onFocus={() => {
          setDismissed(false);
          position(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDismissed(true);
        }}
      >
        {label} <span aria-hidden="true">?</span>
      </button>
      <span ref={tooltip} id={id} className="help-tooltip" role="tooltip">
        {children}
      </span>
    </span>
  );
}
