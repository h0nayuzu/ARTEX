"use client";

// VShell 站点工作台(全屏,仿 vshell 原版 web):顶部子导航
// 仪表盘 | 客户端管理 | 监听管理 | 隧道代理;客户端行 → 终端/文件 全屏子页。
import * as React from "react";
import {
  ArrowLeftIcon,
  PlusIcon,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";

import { VshellFilesTab } from "./vshell/files-tab";
import { VshellGeneratorPage, callApi } from "./vshell/generator-page";
import { VshellListenersPage } from "./vshell/listeners-page";
import { VshellPluginsPage, VshellSettingsPage } from "./vshell/plugins-page";
import { VshellTerminalTab } from "./vshell/terminal-tab";
import { VshellTunnelsTab } from "./vshell/tunnels-tab";

type Sub = "dashboard" | "clients" | "listeners" | "generator" | "plugins" | "tunnels" | "settings";

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

  const autoCheckedRef = React.useRef("");
  React.useEffect(() => {
    if (!server || autoCheckedRef.current === server.id) return;
    autoCheckedRef.current = server.id;
    void (async () => {
      setChecking(true);
      try {
        await api.vshellCheck(server.id);
        const items = await api.vshellServers();
        setServer(items.find((s) => s.id === id) ?? server);
      } catch {
        const items = await api.vshellServers().catch(() => [] as VshellServer[]);
        setServer(items.find((s) => s.id === id) ?? server);
      } finally {
        setChecking(false);
      }
    })();
  }, [server, id]);

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
        <TabsList className="flex-wrap">
          <TabsTrigger value="dashboard">仪表盘</TabsTrigger>
          <TabsTrigger value="clients">客户端管理</TabsTrigger>
          <TabsTrigger value="listeners">监听管理</TabsTrigger>
          <TabsTrigger value="generator">客户端生成</TabsTrigger>
          <TabsTrigger value="plugins">插件运行</TabsTrigger>
          <TabsTrigger value="tunnels">隧道代理</TabsTrigger>
          <TabsTrigger value="settings">系统设置</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-0">
          <VshellDashboard server={server} />
        </TabsContent>
        <TabsContent value="clients" className="mt-0">
          <VshellClients server={server} onOpenHost={(hid, kind) => onNavigate({ host: hid, hostsub: kind })} />
        </TabsContent>
        <TabsContent value="listeners" className="mt-0">
          <VshellListenersPage server={server} />
        </TabsContent>
        <TabsContent value="generator" className="mt-0">
          <VshellGeneratorPage server={server} />
        </TabsContent>
        <TabsContent value="plugins" className="mt-0">
          <VshellPluginsPage server={server} />
        </TabsContent>
        <TabsContent value="tunnels" className="mt-0">
          <VshellTunnelsTab server={server} />
        </TabsContent>
        <TabsContent value="settings" className="mt-0">
          <VshellSettingsPage server={server} />
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

  const usedKeys = new Set(
    [...sysBars, ...sysKv, ...cfgRows].flatMap((r) => r.keys.map((k) => k.toLowerCase())),
  );
  const restEntries = info
    ? Object.entries(info)
        .filter(([k, v]) => !usedKeys.has(k.toLowerCase()) && v !== null && v !== "")
        .slice(0, 80)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
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
            <CardTitle className="text-base">系统信息</CardTitle>
          </CardHeader>
          <CardContent>
            {info ? (
              <dl className="divide-y text-sm">
                {sysBars.map((b) => {
                  const v = lookup(info, b.keys);
                  if (v === null) return null;
                  const pct = Math.max(0, Math.min(100, Number(v) || 0));
                  return (
                    <div key={b.label} className="py-2">
                      <div className="mb-1 flex items-center justify-between">
                        <dt className="text-muted-foreground">{b.label}</dt>
                        <dd className="font-mono text-xs">{pct}%</dd>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
                {sysKv.map((row) => {
                  const v = lookup(info, row.keys);
                  if (v === null) return null;
                  return (
                    <div key={row.label} className="flex items-center justify-between py-2">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-mono text-xs">{row.rate ? fmtRate(Number(v) || 0) : String(v)}</dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="text-muted-foreground py-4 text-sm">{loading ? "加载中…" : "dashboard/info 不可用。"}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">配置信息</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {cfgRows.map((row) => {
                const v = info ? lookup(info, row.keys) : null;
                const shown = v !== null ? fmtBool(v) : "—";
                return (
                  <div key={row.label} className="flex items-center justify-between py-1.5">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="font-mono text-xs">{shown}</dd>
                  </div>
                );
              })}
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-muted-foreground">站点地址</dt>
                <dd className="max-w-56 truncate font-mono text-xs" title={server.base_url}>
                  {server.base_url}
                </dd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-muted-foreground">最近检查</dt>
                <dd className="font-mono text-xs">{server.last_check_at || "—"}</dd>
              </div>
            </dl>
            {info && restEntries.length > 0 && (
              <details className="mt-2">
                <summary className="text-muted-foreground cursor-pointer text-xs select-none">其余字段({restEntries.length})</summary>
                <dl className="divide-y mt-1 text-xs">
                  {restEntries.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-1">
                      <dt className="text-muted-foreground font-mono">{k}</dt>
                      <dd className="max-w-48 truncate font-mono" title={typeof v === "object" ? JSON.stringify(v) : String(v)}>
                        {typeof v === "object" ? "{…}" : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// 仪表盘字段映射:大小写不敏感取第一个命中的 key;命中过的 key 不进「其余字段」。
function lookup(info: Record<string, unknown>, keys: string[]): string | null {
  const lower = Object.keys(info).reduce<Record<string, string>>((m, k) => {
    m[k.toLowerCase()] = k;
    return m;
  }, {});
  for (const k of keys) {
    const hit = lower[k.toLowerCase()];
    if (hit !== undefined && info[hit] !== null && info[hit] !== "") return String(info[hit]);
  }
  return null;
}

function fmtBool(v: string) {
  if (v === "true") return "true";
  if (v === "false") return "false";
  return v;
}

function fmtRate(kbPerSec: number) {
  if (kbPerSec >= 1024) return `${(kbPerSec / 1024).toFixed(2)} MB/s`;
  if (kbPerSec >= 1) return `${kbPerSec.toFixed(2)} KB/s`;
  return `${(kbPerSec * 1024).toFixed(0)} B/s`;
}

const sysBars = [
  { keys: ["cpu", "cpupercnt"], label: "处理器" },
  { keys: ["disk", "diskpercnt"], label: "磁盘" },
  { keys: ["mem", "mempercnt", "memory"], label: "内存" },
  { keys: ["virtualmem", "vmem", "virtualmempercnt"], label: "虚拟内存" },
];

const sysKv = [
  { keys: ["tcp", "tcpcount", "tcpestablished"], label: "TCP 通讯(已建立)" },
  { keys: ["udp", "udpcount", "udpestablished"], label: "UDP 通讯(已建立)" },
  { keys: ["io_send", "iosend", "outflow"], label: "流出带宽", rate: true },
  { keys: ["io_recv", "iorecv", "inflow"], label: "流入带宽", rate: true },
];

const cfgRows = [
  { keys: ["version"], label: "版本" },
  { keys: ["webport"], label: "WEB端口" },
  { keys: ["basicauth"], label: "Basic认证" },
  { keys: ["expiretime", "expire", "expiredate"], label: "授权到期时间" },
  { keys: ["advancedauth", "advanced"], label: "高级授权" },
  { keys: ["clientnum", "clientlimit"], label: "授权客户端数量" },
  { keys: ["iplimit"], label: "IP 上限" },
  { keys: ["httpproxyport"], label: "HTTP 代理端口" },
  { keys: ["httpsproxyport"], label: "HTTPS 代理端口" },
]

// ---------------------------------------------------------------- clients

function VshellClients({ server, onOpenHost }: { server: VshellServer; onOpenHost: (hostId: string, kind: "terminal" | "files") => void }) {
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [online, setOnline] = React.useState(false);
  const [auto, setAuto] = React.useState(false);
  const [editingRemark, setEditingRemark] = React.useState<{ host: VshellHost; value: string } | null>(null);
  const [forward, setForward] = React.useState(false);

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
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setForward(true)}>
            <PlusIcon className="size-4" /> 正向连接
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
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

      {forward && <ForwardConnectDialog server={server} onClose={() => setForward(false)} onDone={() => void load()} />}

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

// 正向连接:让已上线的客户端主动回连 ARTEX 填写的 IP:端口(client/add,字段逐字对齐)。
function ForwardConnectDialog({ server, onClose, onDone }: { server: VshellServer; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = React.useState({ ip: "", port: "", tp: "tcp", vkey: "qwe123qwe", salt: "qwe123qwe", proxy: "" });
  const [busy, setBusy] = React.useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    if (!form.ip || !form.port) {
      toast.error("IP 和端口必填");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        ip: form.ip,
        port: form.port,
        tp: form.tp,
        vkey: form.vkey,
        salt: form.salt,
      };
      if (form.proxy) body.proxy = form.proxy;
      await callApi(server.id, "client/add", body);
      toast.success("正向连接已下发");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "下发失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增正向客户端</DialogTitle>
          <DialogDescription>选择一台已上线客户端,让它回连你填写的 IP:端口(需要目标能出网到该地址)。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            连接方式
            <Select value={form.tp} onValueChange={(v) => set({ tp: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="kcp">KCP/UDP</SelectItem>
                <SelectItem value="ws">WebSocket</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            IP 或域名
            <Input value={form.ip} placeholder="1.2.3.4" onChange={(e) => set({ ip: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            端口
            <Input value={form.port} placeholder="49319" onChange={(e) => set({ port: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Vkey
            <Input value={form.vkey} onChange={(e) => set({ vkey: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            流量加密盐
            <Input value={form.salt} onChange={(e) => set({ salt: e.target.value })} />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            使用代理(不使用请留空)
            <Input value={form.proxy} placeholder="socks5://user:pass@1.2.3.4:1080" onChange={(e) => set({ proxy: e.target.value })} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "下发中…" : "连接"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
