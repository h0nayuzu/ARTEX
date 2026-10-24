"use client";

// Shell 管理:列表层(Webshell | VShell 顶部标签)+ 全屏工作台路由。
// 工作台通过 ?view=ws|vs&id=… 进入,浏览器前进/后退可用。
import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useShellRoute } from "./_components/use-shell-route";
import { VshellManager } from "./_components/vshell-manager";
import { VshellWorkspace } from "./_components/vshell-workspace";
import { WebshellManager } from "./_components/webshell-manager";
import { WebshellWorkspace } from "./_components/webshell-workspace";

export default function ShellPage() {
  const { route, navigate } = useShellRoute();

  if (route.view === "ws" && route.id) {
    return <WebshellWorkspace id={route.id} onBack={() => navigate({ view: "", id: "" })} />;
  }
  if (route.view === "vs" && route.id) {
    return (
      <VshellWorkspace
        id={route.id}
        sub={route.sub as "dashboard" | "clients" | "listeners" | "tunnels"}
        host={route.host}
        hostsub={route.hostsub as "terminal" | "files"}
        onBack={() => navigate({ view: "", id: "", host: "", hostsub: "terminal" })}
        onNavigate={navigate}
      />
    );
  }

  return (
    <Tabs
      value={route.tab}
      onValueChange={(v) => navigate({ tab: v as "webshell" | "vshell" })}
      className="flex min-h-0 flex-1 flex-col gap-4 pt-4" data-content-padding="false"
    >
      <TabsList className="mx-4 lg:mx-6">
        <TabsTrigger value="webshell">Webshell 管理</TabsTrigger>
        <TabsTrigger value="vshell">VShell 管理</TabsTrigger>
      </TabsList>
      <TabsContent value="webshell" className="mt-0">
        <WebshellManager onOpen={(id) => navigate({ view: "ws", id })} />
      </TabsContent>
      <TabsContent value="vshell" className="mt-0">
        <VshellManager onOpen={(id) => navigate({ view: "vs", id, sub: "dashboard", host: "" })} />
      </TabsContent>
    </Tabs>
  );
}
