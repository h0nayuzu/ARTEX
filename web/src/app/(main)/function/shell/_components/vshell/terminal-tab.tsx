"use client";

// VShell 终端:交互式(xterm↔WS 代理,真终端)为主,非交互式(terminal/shell 同步逐条)备用——
// 与原版「交互式终端 / 非交互式终端(备用)」按钮组一致。
import * as React from "react";

import { ShellTerminal } from "../shell-terminal";
import { InteractiveTerminal } from "./interactive-terminal";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";

export function VshellTerminalTab({ server, fixedHostId }: { server: VshellServer; fixedHostId?: string }) {
  const [mode, setMode] = React.useState<"interactive" | "basic">("interactive");
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [hostId, setHostId] = React.useState<string>(fixedHostId ?? "");

  React.useEffect(() => {
    if (fixedHostId) {
      setHostId(fixedHostId);
      return;
    }
    let cancelled = false;
    api
      .vshellHosts(server.id, false)
      .then((items) => {
        if (cancelled) return;
        setHosts(items);
        const first = items.find((h) => h.IsConnect) ?? items[0];
        if (first) setHostId(String(first.Id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [server.id, fixedHostId]);

  React.useEffect(() => {
    if (!fixedHostId || hosts.length > 0) return;
    api
      .vshellHosts(server.id, false)
      .then((items) => setHosts(items.filter((h) => String(h.Id) === fixedHostId)))
      .catch(() => {});
  }, [server.id, fixedHostId, hosts.length]);

  const exec = React.useCallback(
    async (command: string) => {
      if (!hostId) throw new Error("先选择一台主机");
      const r = await api.vshellExec(server.id, hostId, command);
      return r.output || "(无输出)";
    },
    [server.id, hostId],
  );

  const current = hosts.find((h) => String(h.Id) === hostId);
  const hostLabel = fixedHostId ? (
    <p className="text-muted-foreground text-xs">
      {current ? `${current.OsName} · ${current.LocalIP || current.Addr} · ${current.UserName}` : `#${hostId}`}
    </p>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border">
          <button
            className={`px-3 py-1.5 text-xs font-medium ${mode === "interactive" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            onClick={() => setMode("interactive")}
          >
            交互式终端
          </button>
          <button
            className={`border-l px-3 py-1.5 text-xs font-medium ${mode === "basic" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            onClick={() => setMode("basic")}
          >
            非交互式终端(备用)
          </button>
        </div>
        {!fixedHostId && (
          <Select value={hostId} onValueChange={setHostId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="选择主机" />
            </SelectTrigger>
            <SelectContent>
              {hosts.map((h) => (
                <SelectItem key={h.Id} value={String(h.Id)}>
                  #{h.Id} {h.HostName || h.Addr} {h.IsConnect ? "🟢" : "⚪"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hostLabel}
      </div>
      {mode === "interactive" ? (
        <>
          {hostId ? (
            <InteractiveTerminal serverId={server.id} hostId={hostId} height="calc(100vh - 22rem)" />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">先选择一台在线主机。</p>
          )}
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            非交互式(备用):同步阻塞逐条执行;退出码非 0 时 vshell 不回传输出——需要输出时以 <code>; true</code> 收尾。
          </p>
          <ShellTerminal exec={exec} quickOS={current?.OsName?.toLowerCase().includes("win") ? "windows" : "linux"} height="calc(100vh - 26rem)" minHeight={360} />
        </>
      )}
    </div>
  );
}
