"use client";

// VShell 主机:在线/台账双视图 + 10s 自动刷新 + 改备注写回 vshell。
import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";

export function VshellHostsTab({ server }: { server: VshellServer }) {
  const [online, setOnline] = React.useState(true);
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [auto, setAuto] = React.useState(false);
  const [editingRemark, setEditingRemark] = React.useState<{ host: VshellHost; value: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setHosts(await api.vshellHosts(server.id, online));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "主机列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [server.id, online]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [auto, load]);

  const saveRemark = async () => {
    if (!editingRemark) return;
    try {
      await api.vshellRemark(server.id, editingRemark.host.Id, editingRemark.value);
      toast.success("备注已写回 vshell");
      setEditingRemark(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "备注写入失败");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={online} onCheckedChange={setOnline} /> 仅在线
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={auto} onCheckedChange={setAuto} /> 10s 自动刷新
          </label>
          <span className="text-muted-foreground">{hosts.length} 台</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">ID</TableHead>
            <TableHead>主机名</TableHead>
            <TableHead>出口 IP</TableHead>
            <TableHead>内网 IP</TableHead>
            <TableHead>系统 / 用户</TableHead>
            <TableHead>归属地</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>备注</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hosts.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                {loading ? "加载中…" : online ? "没有在线主机" : "台账为空"}
              </TableCell>
            </TableRow>
          )}
          {hosts.map((h) => (
            <TableRow key={h.Id}>
              <TableCell className="font-mono text-xs">#{h.Id}</TableCell>
              <TableCell className="font-medium">{h.HostName || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{h.Addr || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{h.LocalIP || "—"}</TableCell>
              <TableCell className="text-xs">
                {h.OsName || "—"}
                {h.UserName ? ` / ${h.UserName}` : ""}
              </TableCell>
              <TableCell className="text-xs">{h.Location || "—"}</TableCell>
              <TableCell>
                {h.IsConnect ? <Badge className="bg-emerald-600">在线</Badge> : <Badge variant="secondary">离线</Badge>}
              </TableCell>
              <TableCell
                className="max-w-40 cursor-pointer truncate text-xs"
                title="点击修改备注"
                onClick={() => setEditingRemark({ host: h, value: h.Remark || "" })}
              >
                {h.Remark || <span className="text-muted-foreground">(点击添加)</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {editingRemark && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingRemark(null)}>
          <div className="w-96 rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-medium">
              #{editingRemark.host.Id} {editingRemark.host.HostName} — 修改备注(写回 vshell)
            </p>
            <input
              className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
              value={editingRemark.value}
              autoFocus
              onChange={(e) => setEditingRemark((r) => (r ? { ...r, value: e.target.value } : r))}
              onKeyDown={(e) => e.key === "Enter" && void saveRemark()}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditingRemark(null)}>
                取消
              </Button>
              <Button size="sm" onClick={() => void saveRemark()}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
