import React, { useId, useState } from "react";
import { useHelpPosition } from "./useHelpPosition";

export default function HelpHint({
  label = "帮助",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const { trigger, tooltip, position } = useHelpPosition();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className={"help-hint" + (dismissed ? " is-dismissed" : "")}
      onMouseEnter={() => {
        setDismissed(false);
        position();
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="help-trigger"
        aria-label={label}
        aria-describedby={id}
        onFocus={() => {
          setDismissed(false);
          position(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !dismissed) {
            event.preventDefault();
            setDismissed(true);
          }
        }}
      >
        ?
      </button>
      <span ref={tooltip} id={id} className="help-tooltip" role="tooltip">
        {children}
      </span>
    </span>
  );
}
