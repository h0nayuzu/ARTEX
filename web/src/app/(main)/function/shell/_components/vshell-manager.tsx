"use client";

// VShell 管理子系统:站点登记 + 主机/终端/文件/代理隧道/监听/概览 工作台。
import * as React from "react";
import { PlusIcon, RefreshCwIcon, SearchIcon, ServerIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VshellServer } from "@/lib/types";

export function VshellManager({ onOpen }: { onOpen: (id: string) => void }) {
  const [servers, setServers] = React.useState<VshellServer[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [editing, setEditing] = React.useState<VshellServer | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<VshellServer | null>(null);
  const [checking, setChecking] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setServers(await api.vshellServers());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const check = async (s: VshellServer) => {
    setChecking(s.id);
    try {
      await api.vshellCheck(s.id);
      toast.success(`站点连通:${s.name || s.base_url}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "检查失败");
      await load();
    } finally {
      setChecking(null);
    }
  };

  const remove = async (s: VshellServer) => {
    try {
      await api.vshellDelete(s.id);
      toast.success("已删除站点");
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const filtered = servers.filter((s) => {
    const q = query.trim().toLowerCase();
    if (q && !`${s.name} ${s.base_url} ${s.remark} ${s.username}`.toLowerCase().includes(q)) return false;
    if (statusFilter !== "all" && s.last_status !== statusFilter) return false;
    return true;
  });
  const okCount = servers.filter((s) => s.last_status === "ok").length;

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 lg:px-6">
      <Card>
        <CardContent className="flex flex-col gap-4 px-0 pt-6">
          <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
            <div className="relative w-full sm:max-w-xs">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input placeholder="搜索名称 / 地址 / 账号" value={query} className="pl-8" onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="清除搜索"
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="ok">在线</SelectItem>
                  <SelectItem value="error">异常</SelectItem>
                  <SelectItem value="unknown">未知</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-muted-foreground hidden text-sm sm:inline">
                {filtered.length}/{servers.length} 站点 · {okCount} 在线
              </span>
              <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
                <RefreshCwIcon className={loading ? "animate-spin" : ""} /> 刷新
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <PlusIcon /> 登记站点
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <Empty className="pb-8">
              <EmptyHeader>
                <EmptyMedia>
                  <ServerIcon />
                </EmptyMedia>
                <EmptyTitle>{servers.length === 0 ? "还没有登记 VShell C2 站点" : "没有匹配的站点"}</EmptyTitle>
                <EmptyDescription>
                  {servers.length === 0
                    ? "站点根地址 + 登录账号密码即可——token 自动缓存、失效自动重登。"
                    : "调整搜索词或筛选条件。"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto px-4 lg:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>站点地址</TableHead>
                    <TableHead className="w-36">账号</TableHead>
                    <TableHead className="w-28">状态</TableHead>
                    <TableHead className="w-36">最近检查</TableHead>
                    <TableHead className="w-56">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => onOpen(s.id)}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{s.name || "(未命名)"}</span>
                          {s.remark && <span className="text-muted-foreground text-sm">{s.remark}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground block max-w-72 truncate font-mono text-sm" title={s.base_url}>
                          {s.base_url}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{s.username}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {s.last_status === "ok" ? (
                            <span className="inline-flex size-2 rounded-full bg-emerald-500" title="在线" />
                          ) : s.last_status === "error" ? (
                            <span className="inline-flex size-2 rounded-full bg-red-500" title="异常" />
                          ) : (
                            <span className="bg-muted-foreground/40 inline-flex size-2 rounded-full" title="未知" />
                          )}
                          <span className="text-sm">
                            {s.last_status === "ok" ? "在线" : s.last_status === "error" ? "异常" : "未知"}
                          </span>
                          {s.last_error && (
                            <span className="text-destructive truncate text-[10px]" title={s.last_error}>
                              {s.last_error.slice(0, 24)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{s.last_check_at || "—"}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => onOpen(s.id)}>
                            管理
                          </Button>
                          <Button size="sm" variant="ghost" disabled={checking === s.id} onClick={() => void check(s)}>
                            {checking === s.id ? "检查中…" : "检查"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                            编辑
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(s)}>
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <VshellServerDialog
        open={creating}
        onOpenChange={setCreating}
        server={null}
        onSaved={async () => {
          setCreating(false);
          await load();
        }}
      />
      <VshellServerDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        server={editing}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除站点 {deleting?.name || deleting?.base_url}?</AlertDialogTitle>
            <AlertDialogDescription>只删除 ARTEX 里的站点登记与 token 缓存,不影响 vshell 服务端;操作台账保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && void remove(deleting)}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

export function VshellServerDialog({
  open,
  onOpenChange,
  server,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  server: VshellServer | null;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [timeoutMs, setTimeoutMs] = React.useState(30000);
  const [remark, setRemark] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(server?.name ?? "");
      setBaseURL(server?.base_url ?? "");
      setUsername(server?.username ?? "");
      setPassword("");
      setTimeoutMs(server?.timeout_ms ?? 30000);
      setRemark(server?.remark ?? "");
    }
  }, [open, server]);

  const save = async () => {
    if (!baseURL.trim()) {
      toast.error("站点地址不能为空");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name, base_url: baseURL.trim(), username, timeout_ms: timeoutMs, remark };
      if (password) body.password = password;
      if (server) await api.vshellUpdate(server.id, body);
      else await api.vshellCreate(body as { base_url: string });
      toast.success(server ? "站点已更新" : "站点已登记");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{server ? "编辑站点" : "登记 VShell C2 站点"}</DialogTitle>
          <DialogDescription>
            站点根地址 + 账号密码;凭据同时用于站点 Basic 网关与 /api/login。{server ? "密码留空 = 保持原密码。" : ""}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>名称</FieldLabel>
            <Input value={name} placeholder="如:本次行动 C2" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>站点地址 *</FieldLabel>
            <Input value={baseURL} placeholder="https://c2.example.com" onChange={(e) => setBaseURL(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>用户名</FieldLabel>
            <Input value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>密码 {server && server.password_set ? `(已设置 ${server.password_tail},留空保持)` : ""}</FieldLabel>
            <Input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>超时(ms)</FieldLabel>
            <Input type="number" value={timeoutMs} min={5000} max={300000} onChange={(e) => setTimeoutMs(Number(e.target.value) || 30000)} />
          </Field>
          <Field>
            <FieldLabel>备注</FieldLabel>
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
