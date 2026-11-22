import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context } from "../../src/renderer/context";
import Overview from "../../src/renderer/pages/Overview";
import Insights from "../../src/renderer/pages/Insights";
import CoverStudio from "../../src/renderer/pages/CoverStudio";
import HelpNote from "../../src/renderer/components/HelpNote";
import Track from "../../src/renderer/pages/Track";

const data = {
  mode: "production",
  works: [],
  artists: [],
  plans: [],
  runs: [],
  exceptions: [],
  series: [
    {
      id: "series",
      title: "真实系列标题",
      story: "用户写下的系列故事",
      workIds: [],
    },
  ],
  assets: [],
  metrics: [],
  resources: {
    finished: 0,
    cost: { available: 0, reserved: 0 },
    candidate: { available: 0, spent: 0, reserved: 0 },
  },
};
const pages = {
  overview: Overview,
  insights: Insights,
  cover: CoverStudio,
};
export function renderTrack() {
  const work={id:'copy-work',title:'原创详情样本',revision:1,artistId:'copy-artist',assets:{},assetHistory:[],parameters:{},config:{genre:'民谣'},story:'用户故事',lyrics:'用户歌词',prompt:'用户提示',rights:'用户授权记录',ai:'unknown'};
  return renderToStaticMarkup(<Context.Provider value={{data:{...data,works:[work],revisions:[],artists:[{id:'copy-artist',name:'样本艺人'}]},call:async()=>{},play:()=>{},go:()=>{},notify:()=>{},importAsset:async()=>{},setSelected:()=>{}} as any}><Track id={work.id}/></Context.Provider>);
}
export function renderPage(page: keyof typeof pages) {
  const Page = pages[page];
  return renderToStaticMarkup(
    <Context.Provider
      value={
        {
          data,
          selected: [],
          go: () => {},
          call: async () => {},
          notify: () => {},
        } as any
      }
    >
      <Page />
    </Context.Provider>,
  );
}
export function helpNoteInteraction() {
  const internals = (React as any)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  let dismissed = false;
  const render = () => {
    internals.H = {
      useId: () => "help-test",
      useRef: (initial: any) => ({ current: initial }),
      useEffect: () => {},
      useState: () => [
        dismissed,
        (next: boolean) => {
          dismissed = next;
        },
      ],
    };
    try {
      return HelpNote({ label: "收件方式", children: "完整帮助" });
    } finally {
      internals.H = previous;
    }
  };
  let tree = render();
  let button = React.Children.toArray(tree.props.children)[0] as any;
  const tooltip = React.Children.toArray(tree.props.children)[1] as any;
  const initial = {
    tag: button.type,
    type: button.props.type,
    label: button.props.children[0],
    describedBy: button.props["aria-describedby"],
    tooltipId: tooltip.props.id,
    role: tooltip.props.role,
  };
  button.props.onKeyDown({ key: "Escape", preventDefault() {} });
  tree = render();
  const escaped = tree.props.className.includes("is-dismissed");
  button = React.Children.toArray(tree.props.children)[0] as any;
  button.props.onFocus();
  tree = render();
  const refocused = !tree.props.className.includes("is-dismissed");
  (React.Children.toArray(tree.props.children)[0] as any).props.onKeyDown({
    key: "Escape",
    preventDefault() {},
  });
  tree = render();
  tree.props.onMouseEnter();
  tree = render();
  return {
    initial,
    escaped,
    refocused,
    hovered: !tree.props.className.includes("is-dismissed"),
  };
}
