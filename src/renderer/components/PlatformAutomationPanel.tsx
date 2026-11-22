import React, { useEffect, useId, useRef } from "react";

export default function PlatformAutomationPanel({ title, className, closeDisabled, onClose, children }: {
  title: string;
  className?: string;
  closeDisabled?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return <dialog ref={dialog} className={className ? `platform-automation-dialog scroll-panel ${className}` : "platform-automation-dialog scroll-panel"}
    aria-labelledby={titleId} onClose={onClose} onCancel={event => { if (closeDisabled) event.preventDefault(); }}>
    <div className="section-title">
      <h2 id={titleId}>{title}</h2>
      <button type="button" disabled={closeDisabled} onClick={() => dialog.current?.close()}>关闭</button>
    </div>
    <div className="scroll-panel-body">{children}</div>
  </dialog>;
}
