"use client";

// VShell 代理/隧道:socks5·http·tcp·udp 清单 + 新增(挂靠上线主机)/启停/删。
import * as React from "react";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";
import { HostOption } from "./plugins-page";

interface Tunnel {
  Id?: number;
  Mode?: string;
  Port?: number;
  Username?: string;
  Password?: string;
  ClientId?: number;
  Status?: string | number | boolean;
  Remark?: string;
  Target?: string;
  [key: string]: unknown;
}

function tid(t: Tunnel): number {
  return Number(t.Id ?? t.id ?? 0);
}
function running(t: Tunnel): boolean {
  const s = t.Status ?? t.status;
  if (typeof s === "boolean") return s;
  if (typeof s === "number") return s === 1;
  const str = String(s ?? "").toLowerCase();
  return str === "run" || str === "running" || str === "true" || str === "启动";
}

export function VshellTunnelsTab({ server }: { server: VshellServer }) {
  const [tunnels, setTunnels] = React.useState<Tunnel[]>([]);
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ hostId: "", mode: "socks5", port: "", target: "", username: "", password: "", remark: "" });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setTunnels((await api.vshellTunnels(server.id)) as unknown as Tunnel[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "隧道清单加载失败");
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  React.useEffect(() => {
    void load();
    api
      .vshellHosts(server.id, false)
      .then(setHosts)
      .catch(() => {});
  }, [load, server.id]);

  const act = async (op: string, id: number) => {
    try {
      await api.vshellTunnelAction(server.id, { op, id });
      toast.success("操作成功");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const add = async () => {
    if (!form.hostId || !form.port) {
      toast.error("需要选择主机并填服务端端口");
      return;
    }
    try {
      await api.vshellTunnelAction(server.id, {
        op: "add",
        host_id: form.hostId,
        mode: form.mode,
        port: Number(form.port),
        target: form.target,
        username: form.username,
        password: form.password,
        remark: form.remark,
      });
      toast.success("隧道已创建");
      setAdding(false);
      setForm({ hostId: "", mode: "socks5", port: "", target: "", username: "", password: "", remark: "" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          代理挂在 vshell 服务器端口上:socks5/http 即 <code>vshell服务器IP:端口</code> 配账密直用;tcp/udp 为端口转发(Target 如 10.0.0.5:3389)。
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon className="h-4 w-4" /> 新增
          </Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">ID</TableHead>
            <TableHead className="w-24">模式</TableHead>
            <TableHead className="w-28">服务端端口</TableHead>
            <TableHead>账密 / 目标</TableHead>
            <TableHead className="w-24">所属主机</TableHead>
            <TableHead className="w-20">状态</TableHead>
            <TableHead>备注</TableHead>
            <TableHead className="w-44">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tunnels.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                {loading ? "加载中…" : "暂无隧道"}
              </TableCell>
            </TableRow>
          )}
          {tunnels.map((t, i) => (
            <TableRow key={tid(t) || i}>
              <TableCell className="font-mono text-sm">#{tid(t)}</TableCell>
              <TableCell className="font-mono text-sm uppercase">{String(t.Mode ?? t.mode ?? "")}</TableCell>
              <TableCell>
                <button
                  className="font-mono text-sm text-blue-500 hover:underline"
                  title="点击复制代理地址"
                  onClick={() => {
                    const addr = `${server.base_url.replace(/^https?:\/\//, "").split("/")[0]}:${t.Port ?? t.port}`;
                    void navigator.clipboard.writeText(addr);
                    toast.success(`已复制:${addr}`);
                  }}
                >
                  {String(t.Port ?? t.port ?? "")}
                </button>
              </TableCell>
              <TableCell className="font-mono text-sm">
                {["socks5", "http"].includes(String(t.Mode ?? t.mode))
                  ? `${t.Username ?? ""}:${t.Password ?? "****"}`
                  : String(t.Target ?? t.target ?? "—")}
              </TableCell>
              <TableCell className="font-mono text-sm">#{String(t.ClientId ?? t.clientId ?? "")}</TableCell>
              <TableCell>{running(t) ? <Badge className="bg-emerald-600">运行</Badge> : <Badge variant="secondary">停止</Badge>}</TableCell>
              <TableCell className="text-sm">{String(t.Remark ?? t.remark ?? "")}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {running(t) ? (
                    <Button size="sm" variant="outline" className="h-7" onClick={() => void act("stop", tid(t))}>
                      停止
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7" onClick={() => void act("start", tid(t))}>
                      启动
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-destructive"
                    onClick={() => confirm("删除该隧道?") && void act("del", tid(t))}
                  >
                    删除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAdding(false)}>
          <div className="w-[30rem] rounded-lg border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="mb-4 text-base font-semibold">新增代理/隧道</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2 flex flex-col gap-1">
                挂靠主机
                <Select value={form.hostId} onValueChange={(v) => setForm((f) => ({ ...f, hostId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择上线主机" />
                  </SelectTrigger>
                  <SelectContent>
                    {hosts.map((h) => (
                      <SelectItem key={h.Id} value={String(h.Id)}>
                        <HostOption host={h} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                模式
                <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["socks5", "http", "tcp", "udp"].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                服务端端口
                <Input value={form.port} placeholder="1080" onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} />
              </label>
              {["tcp", "udp"].includes(form.mode) ? (
                <label className="col-span-2 flex flex-col gap-1">
                  转发目标(host:port)
                  <Input value={form.target} placeholder="10.0.0.5:3389" onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} />
                </label>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    认证用户
                    <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    认证密码
                    <Input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                  </label>
                </>
              )}
              <label className="col-span-2 flex flex-col gap-1">
                备注
                <Input value={form.remark} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                取消
              </Button>
              <Button size="sm" onClick={() => void add()}>
                创建
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
