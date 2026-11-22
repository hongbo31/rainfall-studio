import React, { useEffect, useRef, useState } from "react";
import { PageHead, useStudio } from "../context";
import CreationWorkspace, { type CreationEditor, type CreationWorkSelection } from "../components/CreationWorkspace";
import CreationWorkShare from "../components/CreationWorkShare";
import Track from "./Track";

export default function ChatCreation({ draft, update }: {
  draft: CreationEditor;
  update: (fields: Partial<CreationEditor>) => void;
}) {
  const { data, go } = useStudio();
  const [selection, setSelection] = useState<CreationWorkSelection | null>(null);
  const detailTrigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const detailContent = useRef<HTMLDivElement>(null);
  const detailWork = (data.works ?? []).find((work: { id: string }) => work.id === selection?.workId);
  const active = detailWork && selection && (!selection.slot || detailWork.assets?.[selection.slot]) ? selection : null;

  useEffect(() => {
    if (active) {
      closeButton.current?.focus({ preventScroll: true });
      if (detailContent.current) detailContent.current.scrollTop = 0;
    }
  }, [active?.workId, active?.slot]);

  const openDetail = (work: CreationWorkSelection, trigger: HTMLButtonElement) => {
    detailTrigger.current = trigger;
    setSelection(work);
  };
  const closeDetail = () => {
    setSelection(null);
    detailTrigger.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <PageHead title="创作中心" action={<button type="button" onClick={() => go("lyric-writing")}>AI作词</button>} />
      <div className="creation-layout">
        <CreationWorkspace draft={draft} update={update} selection={active} onOpenWork={openDetail} />
        {active && (
          <section
            className="creation-detail"
            id="creation-work-detail"
            aria-labelledby="creation-work-detail-title"
            onKeyDown={event => {
              if (event.key === "Escape" && !event.defaultPrevented) {
                event.preventDefault();
                closeDetail();
              }
            }}
          >
            <div className="creation-detail-toolbar">
              <h2 id="creation-work-detail-title">作品详情</h2>
              <div className="button-row">
                {active.slot && <button type="button" onClick={() => setSelection({ workId: active.workId })}>作品资料</button>}
                <button type="button" ref={closeButton} onClick={closeDetail}>关闭详情</button>
              </div>
            </div>
            <div className="creation-detail-content" ref={detailContent} key={active.workId}>
              <CreationWorkShare work={detailWork} slot={active.slot} key={active.slot ?? "work"} />
              <Track id={active.workId} slot={active.slot} />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
