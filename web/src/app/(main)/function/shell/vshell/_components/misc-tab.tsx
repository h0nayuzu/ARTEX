"use client";

// VShell 监听清单 / 站点概览(dashboard/info 原样展示)。
import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VshellServer } from "@/lib/types";

export function VshellMiscTab({ server, view }: { server: VshellServer; view: "listeners" | "overview" }) {
  const [data, setData] = React.useState<Record<string, unknown>[] | Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      if (view === "listeners") {
        setData(await api.vshellListeners(server.id));
      } else {
        setData(await api.vshellInfo(server.id));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [server.id, view]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {view === "listeners" ? "vshell 服务端监听(listener)清单——payload 回连配置参考。" : "站点运行态(版本/授权/流量/负载),来自 dashboard/info。"}
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
        </Button>
      </div>
      {view === "listeners" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-32">监听地址</TableHead>
              <TableHead className="w-24">协议</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!data || (data as unknown[]).length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {loading ? "加载中…" : "暂无监听"}
                </TableCell>
              </TableRow>
            )}
            {(Array.isArray(data) ? data : []).map((l, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">#{String(l.Id ?? l.id ?? i)}</TableCell>
                <TableCell className="text-xs">{String(l.Name ?? l.name ?? "—")}</TableCell>
                <TableCell className="font-mono text-xs">{String(l.Host ?? l.host ?? "")}:{String(l.Port ?? l.port ?? "")}</TableCell>
                <TableCell className="font-mono text-xs uppercase">{String(l.Protocol ?? l.protocol ?? l.Mode ?? "")}</TableCell>
                <TableCell className="text-xs">{String(l.Status ?? l.status ?? "—")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <pre className="max-h-[420px] overflow-auto rounded-md border bg-black p-3 font-mono text-xs text-zinc-200">
          {data ? JSON.stringify(data, null, 2) : "加载中…"}
        </pre>
      )}
    </div>
  );
}
