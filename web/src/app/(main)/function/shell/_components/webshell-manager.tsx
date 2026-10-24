"use client";

// Webshell 管理子系统:连接注册表(搜索/协议/状态筛选)+ 工作台(终端/文件/数据库/台账)+ 生成器。
import * as React from "react";
import { PlusIcon, RefreshCwIcon, SearchIcon, TerminalIcon, Trash2Icon, WrenchIcon, XIcon } from "lucide-react";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { WebshellConn, WebshellProtocolMeta } from "@/lib/types";

import { WebshellConnDialog } from "./webshell/conn-dialog";
import { WebshellGeneratorDialog } from "./webshell/generator-dialog";

const PROTOCOL_BADGE: Record<string, string> = {
  "dsh-aes": "bg-violet-600",
  "dsh-mem": "bg-orange-600",
  "cmd-eval": "bg-sky-600",
  "cmd-system": "bg-slate-600",
  behinder: "bg-cyan-700",
  godzilla: "bg-rose-700",
};

const PROTOCOL_LABEL: Record<string, string> = {
  "dsh-aes": "自研加密",
  "dsh-mem": "内存马",
  "cmd-eval": "一句话·eval",
  "cmd-system": "一句话·命令",
  behinder: "冰蝎",
  godzilla: "哥斯拉",
};

export function WebshellManager({ onOpen }: { onOpen: (id: string) => void }) {
  const [conns, setConns] = React.useState<WebshellConn[]>([]);
  const [protocols, setProtocols] = React.useState<WebshellProtocolMeta[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [protoFilter, setProtoFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [editing, setEditing] = React.useState<WebshellConn | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [generatorOpen, setGeneratorOpen] = React.useState(false);
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
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const filtered = conns.filter((c) => {
    const q = query.trim().toLowerCase();
    if (q && !`${c.name} ${c.url} ${c.remark}`.toLowerCase().includes(q)) return false;
    if (protoFilter !== "all" && c.protocol !== protoFilter) return false;
    if (statusFilter !== "all" && c.last_status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 lg:px-6">
      <Card>
        <CardContent className="flex flex-col gap-4 px-0 pt-6">
          <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
            <div className="relative w-full sm:max-w-xs">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                placeholder="搜索名称 / 地址 / 备注"
                value={query}
                className="pl-8"
                onChange={(e) => setQuery(e.target.value)}
              />
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
            <Select value={protoFilter} onValueChange={setProtoFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="协议" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部协议</SelectItem>
                  {protocols.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {PROTOCOL_LABEL[p.id] ?? p.id}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
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
                {filtered.length}/{conns.length} 条连接
              </span>
              <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
                <RefreshCwIcon className={loading ? "animate-spin" : ""} /> 刷新
              </Button>
              <Button variant="outline" size="sm" onClick={() => setGeneratorOpen(true)}>
                <WrenchIcon /> 生成器
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <PlusIcon /> 登记连接
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <Empty className="pb-8">
              <EmptyHeader>
                <EmptyMedia>
                  <TerminalIcon />
                </EmptyMedia>
                <EmptyTitle>{conns.length === 0 ? "还没有 webshell 连接" : "没有匹配的连接"}</EmptyTitle>
                <EmptyDescription>
                  {conns.length === 0
                    ? "填马地址 + 口令跑「自动识别」,或在生成器里起一个新马。仅限已授权测试环境。"
                    : "调整搜索词或筛选条件。"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto px-4 lg:px-6">
              <Table className="[&_th]:h-12 [&_td]:h-12">
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>地址</TableHead>
                    <TableHead className="w-32">协议</TableHead>
                    <TableHead className="w-20">OS</TableHead>
                    <TableHead className="w-32">探活</TableHead>
                    <TableHead className="w-56">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => onOpen(c.id)}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{c.name || "(未命名)"}</span>
                          {c.remark && <span className="text-muted-foreground text-sm">{c.remark}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-64">
                        <span className="text-muted-foreground block truncate font-mono text-sm" title={c.url}>
                          {c.url}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge className={PROTOCOL_BADGE[c.protocol] ?? ""}>{PROTOCOL_LABEL[c.protocol] ?? c.protocol}</Badge>
                          {c.kind === "mem" && <span className="text-muted-foreground text-[10px]">内存马</span>}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{c.os}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {c.last_status === "ok" ? (
                            <span className="inline-flex size-2 rounded-full bg-emerald-500" title="在线" />
                          ) : c.last_status === "error" ? (
                            <span className="inline-flex size-2 rounded-full bg-red-500" title="异常" />
                          ) : (
                            <span className="bg-muted-foreground/40 inline-flex size-2 rounded-full" title="未知" />
                          )}
                          <span className="text-muted-foreground text-sm">{c.last_probe_at ? c.last_probe_at.slice(5, 16) : "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => onOpen(c.id)}>
                            工作台
                          </Button>
                          <Button size="sm" variant="ghost" disabled={probing === c.id} onClick={() => void probe(c)}>
                            {probing === c.id ? "探测中…" : "探活"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                            编辑
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(c)}>
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

    </div>
  );
}
