"use client";

import * as React from "react";

// Shell 管理页内路由:静态导出环境(无动态路由)用查询参数表达视图层级,
// pushState + popstate 让浏览器前进/后退在 列表 ↔ 工作台 ↔ 主机子页 间正常工作。
export interface ShellRoute {
  /** 列表层哪个子系统 */
  tab: "webshell" | "vshell";
  /** 空=列表;ws=webshell 工作台;vs=vshell 站点工作台 */
  view: "" | "ws" | "vs";
  /** 工作台目标连接/站点 id */
  id: string;
  /** vshell 工作台子页:dashboard|clients|listeners|tunnels */
  sub: string;
  /** vshell 聚焦的主机 Id(客户端管理 → 终端/文件) */
  host: string;
  /** 主机子页:terminal|files */
  hostsub: string;
}

function parse(search: string): ShellRoute {
  const q = new URLSearchParams(search);
  const tab = q.get("tab") === "vshell" ? "vshell" : "webshell";
  const viewRaw = q.get("view");
  const view = viewRaw === "ws" || viewRaw === "vs" ? viewRaw : "";
  const subRaw = q.get("sub") ?? "";
  const sub = ["dashboard", "clients", "listeners", "generator", "plugins", "tunnels", "settings"].includes(subRaw) ? subRaw : "dashboard";
  const hostsub = q.get("hostsub") === "files" ? "files" : "terminal";
  return { tab, view, id: q.get("id") ?? "", sub, host: q.get("host") ?? "", hostsub };
}

export function useShellRoute() {
  const [route, setRoute] = React.useState<ShellRoute>(() =>
    typeof window === "undefined" ? { tab: "webshell", view: "", id: "", sub: "dashboard", host: "", hostsub: "terminal" } : parse(window.location.search),
  );

  React.useEffect(() => {
    const onPop = () => setRoute(parse(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = React.useCallback((patch: Partial<ShellRoute>) => {
    const url = new URL(window.location.href);
    const merged = { ...parse(window.location.search), ...patch };
    const map: Record<string, string> = {
      tab: merged.tab,
      view: merged.view,
      id: merged.id,
      sub: merged.sub,
      host: merged.host,
      hostsub: merged.hostsub,
    };
    for (const [k, v] of Object.entries(map)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    window.history.pushState(null, "", url);
    setRoute(merged);
  }, []);

  return { route, navigate };
}
