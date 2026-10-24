"use client";

// VShell 终端:选主机逐条同步执行(/terminal/shell)。
import * as React from "react";
import { toast } from "sonner";

import { ShellTerminal } from "../../_components/shell-terminal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";

export function VshellTerminalTab({ server }: { server: VshellServer }) {
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [hostId, setHostId] = React.useState<string>("");

  React.useEffect(() => {
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
  }, [server.id]);

  const exec = React.useCallback(
    async (command: string) => {
      if (!hostId) throw new Error("先选择一台主机");
      const r = await api.vshellExec(server.id, hostId, command);
      return r.output || "(无输出)";
    },
    [server.id, hostId],
  );

  const current = hosts.find((h) => String(h.Id) === hostId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">目标主机:</span>
        <Select value={hostId} onValueChange={setHostId}>
          <SelectTrigger className="w-72">
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
        {current && (
          <span className="text-xs text-muted-foreground">
            {current.OsName} · {current.LocalIP || current.Addr}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        vshell 终端为同步阻塞:命令跑完才回传;退出码非 0 时 vshell 不回传输出——需要输出时以 <code>; true</code> 收尾。
      </p>
      <ShellTerminal exec={exec} quickOS={current?.OsName?.toLowerCase().includes("win") ? "windows" : "linux"} />
    </div>
  );
}
