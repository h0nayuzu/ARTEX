"use client";

// Shell 管理 · VShell 管理:VShell C2 站点登记 + 主机/终端/文件/隧道/监听/概览。
import * as React from "react";
import { PlusIcon, RefreshCwIcon, RadioTowerIcon, ServerIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { VshellServer } from "@/lib/types";

import { VshellHostsTab } from "./_components/hosts-tab";
import { VshellTerminalTab } from "./_components/terminal-tab";
import { VshellFilesTab } from "./_components/files-tab";
import { VshellTunnelsTab } from "./_components/tunnels-tab";
import { VshellMiscTab } from "./_components/misc-tab";

export default function VshellPage() {
  const [servers, setServers] = React.useState<VshellServer[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [editing, setEditing] = React.useState<VshellServer | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [active, setActive] = React.useState<VshellServer | null>(null);
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
      if (active?.id === s.id) setActive(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RadioTowerIcon className="h-5 w-5" /> VShell 管理
          </h2>
          <p className="text-sm text-muted-foreground">
            登记 VShell C2 站点(网关 Basic + 账号密码自动登录)——上线主机 / 终端 / 文件 / 代理隧道 / 监听 / 概览。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" /> 登记站点
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <ServerIcon className="h-10 w-10 opacity-40" />
            <p className="text-sm">还没有登记任何 VShell C2 站点。</p>
            <p className="text-xs">站点根地址(如 https://c2.example.com)+ 登录账号密码即可——token 自动缓存、失效自动重登。</p>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>站点地址</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>最近检查</TableHead>
              <TableHead className="w-72">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name || <span className="text-muted-foreground">(未命名)</span>}</TableCell>
                <TableCell className="font-mono text-xs">{s.base_url}</TableCell>
                <TableCell className="font-mono text-xs">{s.username}</TableCell>
                <TableCell>
                  {s.last_status === "ok" ? (
                    <Badge className="bg-emerald-600">在线</Badge>
                  ) : s.last_status === "error" ? (
                    <Badge variant="destructive">异常</Badge>
                  ) : (
                    <Badge variant="outline">未知</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.last_check_at || "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setActive(s)}>
                      管理
                    </Button>
                    <Button size="sm" variant="outline" disabled={checking === s.id} onClick={() => void check(s)}>
                      {checking === s.id ? "检查中…" : "检查连接"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                      编辑
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleting(s)}>
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

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
            <AlertDialogDescription>
              只删除 ARTEX 里的站点登记与 token 缓存,不影响 vshell 服务端;操作台账保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && void remove(deleting)}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={active !== null} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-4xl">
          <SheetHeader className="border-b pb-3">
            <SheetTitle className="flex items-center gap-2">
              <RadioTowerIcon className="h-4 w-4" /> {active?.name || active?.base_url}
            </SheetTitle>
            <SheetDescription className="font-mono text-xs">{active?.base_url}</SheetDescription>
          </SheetHeader>
          {active && (
            <div className="flex-1 overflow-auto p-4">
              <Tabs defaultValue="hosts">
                <TabsList className="mb-3">
                  <TabsTrigger value="hosts">主机</TabsTrigger>
                  <TabsTrigger value="terminal">终端</TabsTrigger>
                  <TabsTrigger value="files">文件</TabsTrigger>
                  <TabsTrigger value="tunnels">代理隧道</TabsTrigger>
                  <TabsTrigger value="listeners">监听</TabsTrigger>
                  <TabsTrigger value="overview">概览</TabsTrigger>
                </TabsList>
                <TabsContent value="hosts">
                  <VshellHostsTab server={active} />
                </TabsContent>
                <TabsContent value="terminal">
                  <VshellTerminalTab server={active} />
                </TabsContent>
                <TabsContent value="files">
                  <VshellFilesTab server={active} />
                </TabsContent>
                <TabsContent value="tunnels">
                  <VshellTunnelsTab server={active} />
                </TabsContent>
                <TabsContent value="listeners">
                  <VshellMiscTab server={active} view="listeners" />
                </TabsContent>
                <TabsContent value="overview">
                  <VshellMiscTab server={active} view="overview" />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
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
