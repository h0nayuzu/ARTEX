"use client";

// VShell 站点工作台(全屏,仿 vshell 原版 web):顶部子导航
// 仪表盘 | 客户端管理 | 监听管理 | 隧道代理;客户端行 → 终端/文件 全屏子页。
import * as React from "react";
import {
  ArrowLeftIcon,
  HeadphonesIcon,
  LaptopIcon,
  MonitorSmartphoneIcon,
  PencilIcon,
  RefreshCwIcon,
  TerminalIcon,
  FolderOpenIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";

import { VshellFilesTab } from "./vshell/files-tab";
import { VshellTerminalTab } from "./vshell/terminal-tab";
import { VshellTunnelsTab } from "./vshell/tunnels-tab";

type Sub = "dashboard" | "clients" | "listeners" | "tunnels";

export function VshellWorkspace({
  id,
  sub,
  host,
  hostsub,
  onBack,
  onNavigate,
}: {
  id: string;
  sub: Sub;
  host: string;
  hostsub: "terminal" | "files";
  onBack: () => void;
  onNavigate: (patch: { sub?: Sub; host?: string; hostsub?: "terminal" | "files" }) => void;
}) {
  const [server, setServer] = React.useState<VshellServer | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api
      .vshellServers()
      .then((items) => {
        if (cancelled) return;
        const hit = items.find((s) => s.id === id);
        if (hit) setServer(hit);
        else setMissing(true);
      })
      .catch(() => setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const check = async () => {
    if (!server) return;
    setChecking(true);
    try {
      await api.vshellCheck(server.id);
      toast.success("站点连通");
      const items = await api.vshellServers();
      setServer(items.find((s) => s.id === id) ?? server);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "检查失败");
      const items = await api.vshellServers().catch(() => [] as VshellServer[]);
      setServer(items.find((s) => s.id === id) ?? server);
    } finally {
      setChecking(false);
    }
  };

  if (missing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-muted-foreground text-sm">站点不存在或已被删除。</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeftIcon className="size-4" /> 返回列表
        </Button>
      </div>
    );
  }
  if (!server) {
    return <div className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-sm">加载中…</div>;
  }

  // 聚焦主机子页(终端/文件)
  if (host) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-4 pb-6 lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onNavigate({ host: "", hostsub: "terminal" })}>
            <ArrowLeftIcon className="size-4" /> 客户端管理
          </Button>
          <span className="text-muted-foreground text-sm">/</span>
          <span className="font-mono text-sm font-medium">#{host}</span>
          <div className="ml-auto flex gap-2">
            <Button variant={hostsub === "terminal" ? "default" : "outline"} size="sm" onClick={() => onNavigate({ hostsub: "terminal" })}>
              <TerminalIcon className="size-4" /> 终端
            </Button>
            <Button variant={hostsub === "files" ? "default" : "outline"} size="sm" onClick={() => onNavigate({ hostsub: "files" })}>
              <FolderOpenIcon className="size-4" /> 文件
            </Button>
          </div>
        </div>
        {hostsub === "files" ? <VshellFilesTab server={server} fixedHostId={host} /> : <VshellTerminalTab server={server} fixedHostId={host} />}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-6 lg:px-6">
      {/* 站点头 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon className="size-4" /> 返回列表
        </Button>
        <h2 className="text-lg font-semibold">{server.name || "VShell 站点"}</h2>
        <span className="text-muted-foreground font-mono text-xs">{server.base_url}</span>
        {server.last_status === "ok" ? (
          <Badge className="bg-emerald-600">在线</Badge>
        ) : server.last_status === "error" ? (
          <Badge variant="destructive">异常</Badge>
        ) : (
          <Badge variant="outline">未检查</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>
            <RefreshCwIcon className={`size-4 ${checking ? "animate-spin" : ""}`} /> 检查连接
          </Button>
        </div>
      </div>

      {/* 子导航(仿原版顶部导航) */}
      <Tabs value={sub} onValueChange={(v) => onNavigate({ sub: v as Sub })} className="gap-4">
        <TabsList>
          <TabsTrigger value="dashboard">仪表盘</TabsTrigger>
          <TabsTrigger value="clients">客户端管理</TabsTrigger>
          <TabsTrigger value="listeners">监听管理</TabsTrigger>
          <TabsTrigger value="tunnels">隧道代理</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-0">
          <VshellDashboard server={server} />
        </TabsContent>
        <TabsContent value="clients" className="mt-0">
          <VshellClients server={server} onOpenHost={(hid, kind) => onNavigate({ host: hid, hostsub: kind })} />
        </TabsContent>
        <TabsContent value="listeners" className="mt-0">
          <VshellListeners server={server} />
        </TabsContent>
        <TabsContent value="tunnels" className="mt-0">
          <VshellTunnelsTab server={server} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

function StatCard({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between px-5">
        <div>
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
        </div>
        <Icon className="text-muted-foreground/50 size-10" />
      </CardContent>
    </Card>
  );
}

function VshellDashboard({ server }: { server: VshellServer }) {
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [listeners, setListeners] = React.useState<Record<string, unknown>[]>([]);
  const [info, setInfo] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [hs, ls, inf] = await Promise.all([
        api.vshellHosts(server.id, false),
        api.vshellListeners(server.id).catch(() => []),
        api.vshellInfo(server.id).catch(() => null),
      ]);
      setHosts(hs);
      setListeners(ls as Record<string, unknown>[]);
      setInfo(inf);
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onlineHosts = hosts.filter((h) => h.IsConnect).length;
  const listenerOnline = (l: Record<string, unknown>) => {
    const s = String(l.Status ?? l.status ?? l.Run ?? "").toLowerCase();
    return s === "run" || s === "running" || s === "online" || s === "true" || s === "1" || s === "在线" || s === "启动";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">站点运行态概览——数据来自 vshell /client/list、/listener/list、/dashboard/info。</p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} /> 刷新
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="监听总数" value={listeners.length} icon={HeadphonesIcon} />
        <StatCard label="在线监听数" value={listeners.filter(listenerOnline).length} icon={HeadphonesIcon} />
        <StatCard label="客户端总数" value={hosts.length} icon={MonitorSmartphoneIcon} />
        <StatCard label="在线客户端" value={onlineHosts} icon={LaptopIcon} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">站点信息(dashboard/info)</CardTitle>
          </CardHeader>
          <CardContent>
            {info ? (
              <dl className="divide-y text-sm">
                {Object.entries(info)
                  .filter(([, v]) => typeof v !== "object")
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-1.5">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-mono text-xs">{String(v)}</dd>
                    </div>
                  ))}
                {Object.entries(info)
                  .filter(([, v]) => typeof v === "object")
                  .map(([k, v]) => (
                    <div key={k} className="py-1.5">
                      <dt className="text-muted-foreground mb-1">{k}</dt>
                      <dd>
                        <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px]">{JSON.stringify(v, null, 2)}</pre>
                      </dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="text-muted-foreground py-4 text-sm">{loading ? "加载中…" : "dashboard/info 不可用。"}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">站点配置</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-muted-foreground">站点地址</dt>
                <dd className="font-mono text-xs">{server.base_url}</dd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-muted-foreground">账号</dt>
                <dd className="font-mono text-xs">{server.username || "—"}</dd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-muted-foreground">请求超时</dt>
                <dd className="font-mono text-xs">{server.timeout_ms}ms</dd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-muted-foreground">最近检查</dt>
                <dd className="font-mono text-xs">{server.last_check_at || "—"}</dd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-muted-foreground">最近错误</dt>
                <dd className="max-w-64 truncate font-mono text-xs" title={server.last_error}>
                  {server.last_error || "—"}
                </dd>
              </div>
              {server.remark && (
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-muted-foreground">备注</dt>
                  <dd className="text-xs">{server.remark}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- clients

function VshellClients({ server, onOpenHost }: { server: VshellServer; onOpenHost: (hostId: string, kind: "terminal" | "files") => void }) {
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [online, setOnline] = React.useState(false);
  const [auto, setAuto] = React.useState(false);
  const [editingRemark, setEditingRemark] = React.useState<{ host: VshellHost; value: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setHosts(await api.vshellHosts(server.id, !online ? false : true));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "客户端列表加载失败");
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
    <Card>
      <CardContent className="flex flex-col gap-4 px-0 pt-6">
        <div className="flex flex-wrap items-center gap-4 px-4 text-sm lg:px-6">
          <label className="flex items-center gap-2">
            <Switch checked={online} onCheckedChange={setOnline} /> 仅在线
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={auto} onCheckedChange={setAuto} /> 10s 自动刷新
          </label>
          <span className="text-muted-foreground text-xs">
            {hosts.length} 台 · 在线 {hosts.filter((h) => h.IsConnect).length}
          </span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
        </div>
        <div className="overflow-x-auto px-4 lg:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">ID</TableHead>
                <TableHead className="w-40">备注</TableHead>
                <TableHead>外网 IP</TableHead>
                <TableHead>归属地</TableHead>
                <TableHead>内网 IP</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>主机名</TableHead>
                <TableHead>系统类型</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hosts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-muted-foreground py-10 text-center">
                    {loading ? "加载中…" : online ? "没有在线主机" : "暂无数据"}
                  </TableCell>
                </TableRow>
              )}
              {hosts.map((h) => (
                <TableRow key={h.Id}>
                  <TableCell className="font-mono text-xs">#{h.Id}</TableCell>
                  <TableCell>
                    <button
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                      title="点击修改备注"
                      onClick={() => setEditingRemark({ host: h, value: h.Remark || "" })}
                    >
                      <PencilIcon className="size-3" /> {h.Remark || "添加"}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{h.Addr || "—"}</TableCell>
                  <TableCell className="text-xs">{h.Location || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{h.LocalIP || "—"}</TableCell>
                  <TableCell className="text-xs">{h.UserName || "—"}</TableCell>
                  <TableCell className="text-xs">{h.HostName || "—"}</TableCell>
                  <TableCell className="text-xs">{h.OsName || "—"}</TableCell>
                  <TableCell>{h.IsConnect ? <Badge className="bg-emerald-600">在线</Badge> : <Badge variant="secondary">离线</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" disabled={!h.IsConnect} onClick={() => onOpenHost(String(h.Id), "terminal")}>
                        终端
                      </Button>
                      <Button size="sm" variant="outline" disabled={!h.IsConnect} onClick={() => onOpenHost(String(h.Id), "files")}>
                        文件
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

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
    </Card>
  );
}

// ---------------------------------------------------------------- listeners

function VshellListeners({ server }: { server: VshellServer }) {
  const [listeners, setListeners] = React.useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setListeners((await api.vshellListeners(server.id)) as unknown as Record<string, unknown>[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "监听清单加载失败");
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 px-0 pt-6">
        <div className="flex items-center px-4 lg:px-6">
          <p className="text-muted-foreground text-sm">vshell 服务端监听清单——payload 回连配置参考。</p>
          <Button size="sm" variant="outline" className="ml-auto mr-4 lg:mr-6" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
        </div>
        <div className="overflow-x-auto px-4 lg:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>备注 / 名称</TableHead>
                <TableHead className="w-24">模式</TableHead>
                <TableHead>监听地址</TableHead>
                <TableHead className="w-24">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listeners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                    {loading ? "加载中…" : "暂无监听"}
                  </TableCell>
                </TableRow>
              )}
              {listeners.map((l, i) => {
                const raw = String(l.Status ?? l.status ?? "");
                const online = ["run", "running", "online", "true", "1", "在线", "启动"].includes(raw.toLowerCase());
                return (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">#{String(l.Id ?? l.id ?? i)}</TableCell>
                    <TableCell className="text-xs">{String(l.Name ?? l.name ?? l.Remark ?? l.remark ?? "—")}</TableCell>
                    <TableCell className="font-mono text-xs uppercase">{String(l.Protocol ?? l.protocol ?? l.Mode ?? l.mode ?? "")}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {String(l.Host ?? l.host ?? "")}
                      {l.Port != null || l.port != null ? `:${String(l.Port ?? l.port)}` : ""}
                      {l.Url ? ` ${String(l.Url)}` : ""}
                    </TableCell>
                    <TableCell>{online ? <Badge className="bg-emerald-600">在线</Badge> : <Badge variant="secondary">{raw || "离线"}</Badge>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
