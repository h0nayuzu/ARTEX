"use client";

// Shell 管理 · Webshell 管理:连接注册表(11 通道 PHP 系 + 通用)+ 终端 + 文件 +
// 数据库 + 信息/台账 工作台 + 生成器。协议与能力移植自 dsh-redteam-model。
import * as React from "react";
import { GlobeIcon, PlusIcon, RefreshCwIcon, TerminalIcon, Trash2Icon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ShellOpLog, WebshellConn, WebshellProtocolMeta } from "@/lib/types";

import { WebshellConnDialog } from "./_components/conn-dialog";
import { WebshellDBPanel } from "./_components/db-panel";
import { WebshellFilePanel } from "./_components/file-panel";
import { WebshellGeneratorDialog } from "./_components/generator-dialog";
import { ShellTerminal } from "../_components/shell-terminal";

const PROTOCOL_BADGE: Record<string, string> = {
  "dsh-aes": "bg-violet-600",
  "dsh-mem": "bg-orange-600",
  "cmd-eval": "bg-sky-600",
  "cmd-system": "bg-slate-600",
  behinder: "bg-cyan-700",
  godzilla: "bg-rose-700",
};

export default function WebshellPage() {
  const [conns, setConns] = React.useState<WebshellConn[]>([]);
  const [protocols, setProtocols] = React.useState<WebshellProtocolMeta[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [editing, setEditing] = React.useState<WebshellConn | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [generatorOpen, setGeneratorOpen] = React.useState(false);
  const [active, setActive] = React.useState<WebshellConn | null>(null);
  const [deleting, setDeleting] = React.useState<WebshellConn | null>(null);
  const [probing, setProbing] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setConns(await api.webshells());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    api.webshellProtocols().then(setProtocols).catch(() => {});
  }, [load, refreshKey]);

  const probe = async (c: WebshellConn) => {
    setProbing(c.id);
    try {
      const r = await api.webshellProbe(c.id);
      toast.success(`探活成功 · OS=${r.os}`);
      await load();
      if (active?.id === c.id) setActive(r.conn ?? c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "探活失败");
      await load();
    } finally {
      setProbing(null);
    }
  };

  const remove = async (c: WebshellConn) => {
    try {
      await api.webshellDelete(c.id);
      toast.success("连接已删除(目标上的马不受影响)");
      setDeleting(null);
      if (active?.id === c.id) setActive(null);
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
            <GlobeIcon className="h-5 w-5" /> Webshell 管理
          </h2>
          <p className="text-sm text-muted-foreground">
            连接注册表 + 协议自动识别(dsh-aes/内存马/一句话/冰蝎/哥斯拉)+ 终端 + 文件 + 数据库(PDO)+ 生成器。仅限已授权测试环境。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => setGeneratorOpen(true)}>
            <WrenchIcon className="h-4 w-4" /> 生成器
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" /> 登记连接
          </Button>
        </div>
      </div>

      {conns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <TerminalIcon className="h-10 w-10 opacity-40" />
            <p className="text-sm">还没有登记任何 webshell 连接。</p>
            <p className="text-xs">填马地址 + 口令跑「自动识别」,或在生成器里起一个新马。</p>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>地址</TableHead>
              <TableHead>协议</TableHead>
              <TableHead className="w-20">形态</TableHead>
              <TableHead className="w-20">OS</TableHead>
              <TableHead>探活</TableHead>
              <TableHead className="w-64">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conns.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name || <span className="text-muted-foreground">(未命名)</span>}</TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs" title={c.url}>
                  {c.url}
                </TableCell>
                <TableCell>
                  <Badge className={PROTOCOL_BADGE[c.protocol] ?? ""}>{c.protocol}</Badge>
                </TableCell>
                <TableCell className="text-xs">{c.kind === "mem" ? "内存马" : "文件马"}</TableCell>
                <TableCell className="font-mono text-xs">{c.os}</TableCell>
                <TableCell>
                  {c.last_status === "ok" ? (
                    <Badge className="bg-emerald-600">在线</Badge>
                  ) : c.last_status === "error" ? (
                    <Badge variant="destructive">异常</Badge>
                  ) : (
                    <Badge variant="outline">未知</Badge>
                  )}
                  {c.last_probe_at && <span className="ml-1 text-[10px] text-muted-foreground">{c.last_probe_at.slice(5, 16)}</span>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setActive(c)}>
                      工作台
                    </Button>
                    <Button size="sm" variant="outline" disabled={probing === c.id} onClick={() => void probe(c)}>
                      {probing === c.id ? "探测中…" : "探活"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                      编辑
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleting(c)}>
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <WebshellConnDialog
        open={creating}
        onOpenChange={setCreating}
        conn={null}
        protocols={protocols}
        onSaved={async () => {
          setCreating(false);
          await load();
        }}
      />
      <WebshellConnDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        conn={editing}
        protocols={protocols}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
      <WebshellGeneratorDialog open={generatorOpen} onOpenChange={setGeneratorOpen} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除连接 {deleting?.name || deleting?.url}?</AlertDialogTitle>
            <AlertDialogDescription>
              只删除 ARTEX 里的登记(连接/档案/缓存);不删目标上的马,清痕按行动纪律另行执行——台账可对账。
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
              <TerminalIcon className="h-4 w-4" /> {active?.name || active?.url}
            </SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-2 font-mono text-xs">
              {active && <Badge className={PROTOCOL_BADGE[active.protocol] ?? ""}>{active.protocol}</Badge>}
              <span>{active?.url}</span>
              {active?.os && <span>· {active.os}</span>}
            </SheetDescription>
          </SheetHeader>
          {active && (
            <div className="flex-1 overflow-auto p-4">
              <Tabs defaultValue="terminal">
                <TabsList className="mb-3">
                  <TabsTrigger value="terminal">终端</TabsTrigger>
                  <TabsTrigger value="files">文件</TabsTrigger>
                  <TabsTrigger value="db">数据库</TabsTrigger>
                  <TabsTrigger value="info">信息/台账</TabsTrigger>
                </TabsList>
                <TabsContent value="terminal">
                  <WebshellTerminalTab conn={active} />
                </TabsContent>
                <TabsContent value="files">
                  <WebshellFilePanel conn={active} />
                </TabsContent>
                <TabsContent value="db">
                  <WebshellDBPanel conn={active} />
                </TabsContent>
                <TabsContent value="info">
                  <WebshellInfoTab conn={active} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function WebshellTerminalTab({ conn }: { conn: WebshellConn }) {
  const exec = React.useCallback(
    async (command: string) => {
      const r = await api.webshellExec(conn.id, command);
      return r.output || "(无输出)";
    },
    [conn.id],
  );
  return <ShellTerminal exec={exec} quickOS={conn.os === "windows" ? "windows" : "linux"} />;
}

function WebshellInfoTab({ conn }: { conn: WebshellConn }) {
  const [ops, setOps] = React.useState<ShellOpLog[]>([]);
  React.useEffect(() => {
    api.webshellOps(conn.id, 50).then(setOps).catch(() => {});
  }, [conn.id]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium">基本信息(最近一次探活)</p>
        <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {conn.basic_info && Object.keys(conn.basic_info).length > 0 ? JSON.stringify(conn.basic_info, null, 2) : "暂无——跑一次「探活」采集。"}
        </pre>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">操作台账(最近 50 条,报告门/清痕对账用)</p>
        <div className="max-h-72 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">时间</TableHead>
                <TableHead className="w-32">动作</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ops.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-4 text-center text-xs text-muted-foreground">
                    暂无记录
                  </TableCell>
                </TableRow>
              )}
              {ops.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("zh-CN", { hour12: false })}</TableCell>
                  <TableCell className="font-mono text-xs">{l.action}</TableCell>
                  <TableCell className="max-w-96 truncate font-mono text-xs" title={l.detail}>
                    {l.detail}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
