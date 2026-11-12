import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context } from "../../src/renderer/context";
import ConfigurationCenter from "../../src/renderer/pages/ConfigurationCenter";
import PlatformConfigurationPanel from "../../src/renderer/components/PlatformConfigurationPanel";
import PlatformAccounts from "../../src/renderer/pages/PlatformAccounts";
import PublicationDiagnostics from "../../src/renderer/pages/PublicationDiagnostics";
const data = {
  mode: "production",
  works: [],
  artists: [{ id: "artist-a", name: "默认艺人甲" }],
  accounts: [
    {
      id: "net",
      provider: "netease",
      name: "云音乐账号",
      authStatus: "local_only",
    },
    {
      id: "tme",
      provider: "tme",
      name: "腾讯本地备注",
      authStatus: "not_connected",
    },
    {
      id: "qq",
      provider: "qqmusic",
      name: "QQ本地备注",
      authStatus: "local_only",
    },
    { id: "suno", provider: "suno", name: "生成平台不应出现" },
  ],
  platformConfigurations: [],
  batches: [],
  units: [],
  targets: [],
  exceptions: [],
  budget: { costLimit: 0, candidateLimit: 0 },
  resources: { submissions: [] },
  tools: {},
  bindings: [],
};
const value: any = {
  data,
  runtime: { mode: "production" },
  call: async () => {},
  notify: () => {},
  go: () => {},
  exportArtifact: () => {},
  importAsset: () => {},
};
export function renderConfiguration(target = "qqmusic") {
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <ConfigurationCenter initialTarget={target as any} />
    </Context.Provider>,
  );
}
export function renderPlatform(target = "qqmusic") {
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <PlatformConfigurationPanel target={target as any} />
    </Context.Provider>,
  );
}
export function renderAccountManagement() {
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <PlatformAccounts initialProvider="tme" />
    </Context.Provider>,
  );
}

// Exercise this component's real event handlers and persistent hook state without
// mounting Electron-only descendant effects. React is pinned by this project.
export function configurationCategoryCycle() {
  const internals = (React as any)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H,
    states: any[] = [],
    effects: any[] = [];
  let cursor = 0,
    tree: any;
  const walk = (node: any, predicate: (node: any) => boolean): any => {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = walk(child, predicate);
      if (found) return found;
    }
    return null;
  };
  const render = () => {
    cursor = 0;
    internals.H = {
      useContext: () => value,
      useState: (initial: any) => {
        const index = cursor++;
        if (!(index in states))
          states[index] = typeof initial === "function" ? initial() : initial;
        return [
          states[index],
          (next: any) =>
            (states[index] =
              typeof next === "function" ? next(states[index]) : next),
        ];
      },
      useEffect: (effect: () => void, deps: any[]) => {
        const index = cursor++;
        if (
          !effects[index] ||
          deps.some((dep, i) => dep !== effects[index][i])
        ) {
          effects[index] = deps;
          effect();
        }
      },
    };
    try {
      tree = ConfigurationCenter({});
    } finally {
      internals.H = previous;
    }
  };
  const tab = (title: string) => {
    const node = walk(
      tree,
      (node) => node.props?.role === "tab" && node.props.children === title,
    );
    node.props.onClick();
    render();
  };
  const mounted = () =>
    !!walk(tree, (node) => node.type === PublicationDiagnostics);
  render();
  tab("诊断与历史");
  const initial = mounted();
  walk(
    tree,
    (node) => node.props?.className === "panel publication-diagnostics",
  ).props.onToggle({
    currentTarget: { open: true },
  });
  render();
  const opened = mounted();
  tab("发布平台");
  const left = mounted();
  tab("诊断与历史");
  const returned = mounted();
  return { initial, opened, left, returned };
}
