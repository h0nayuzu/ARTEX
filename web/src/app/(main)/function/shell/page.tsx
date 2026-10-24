"use client";

// Shell 管理:webshell 连接注册表与 VShell C2 站点两个子系统,顶部标签切换。
import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { WebshellManager } from "./_components/webshell-manager";
import { VshellManager } from "./_components/vshell-manager";

type ShellTab = "webshell" | "vshell";

function initialTab(): ShellTab {
  if (typeof window === "undefined") return "webshell";
  return new URLSearchParams(window.location.search).get("tab") === "vshell" ? "vshell" : "webshell";
}

export default function ShellPage() {
  const [tab, setTab] = React.useState<ShellTab>(initialTab);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as ShellTab);
        // 同步到 URL(静态导出环境用 history API,不触发导航)
        const url = new URL(window.location.href);
        url.searchParams.set("tab", v);
        window.history.replaceState(null, "", url);
      }}
      className="flex flex-1 flex-col gap-4"
    >
      <TabsList className="mx-4 lg:mx-6">
        <TabsTrigger value="webshell">Webshell 管理</TabsTrigger>
        <TabsTrigger value="vshell">VShell 管理</TabsTrigger>
      </TabsList>
      <TabsContent value="webshell" className="mt-0">
        <WebshellManager />
      </TabsContent>
      <TabsContent value="vshell" className="mt-0">
        <VshellManager />
      </TabsContent>
    </Tabs>
  );
}
