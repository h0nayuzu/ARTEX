"use client";

// Webshell 连接工作台(全屏):终端 / 文件 / 数据库 / 信息台账。
import * as React from "react";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ShellOpLog, WebshellConn } from "@/lib/types";

import { WebshellDBPanel } from "./webshell/db-panel";
import { WebshellFilePanel } from "./webshell/file-panel";
import { ShellTerminal } from "./shell-terminal";

const PROTOCOL_LABEL: Record<string, string> = {
  "dsh-aes": "自研加密",
  "dsh-mem": "内存马",
  "cmd-eval": "一句话·eval",
  "cmd-system": "一句话·命令",
  behinder: "冰蝎",
  godzilla: "哥斯拉",
};

const PROTOCOL_BADGE: Record<string, string> = {
  "dsh-aes": "bg-violet-600",
  "dsh-mem": "bg-orange-600",
  "cmd-eval": "bg-sky-600",
  "cmd-system": "bg-slate-600",
  behinder: "bg-cyan-700",
  godzilla: "bg-rose-700",
};

export function WebshellWorkspace({ id, onBack }: { id: string; onBack: () => void }) {
  const [conn, setConn] = React.useState<WebshellConn | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [probing, setProbing] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api
      .webshells()
      .then((items) => {
        if (cancelled) return;
        const hit = items.find((c) => c.id === id);
        if (hit) setConn(hit);
        else setMissing(true);
      })
      .catch(() => setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const probe = async () => {
    if (!conn) return;
    setProbing(true);
    try {
      const r = await api.webshellProbe(conn.id);
      toast.success(`探活成功 · OS=${r.os}`);
      if (r.conn) setConn(r.conn);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "探活失败");
    } finally {
      setProbing(false);
    }
  };

  if (missing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-muted-foreground text-sm">连接不存在或已被删除。</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeftIcon className="size-4" /> 返回列表
        </Button>
      </div>
    );
  }
  if (!conn) {
    return <div className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-sm">加载中…</div>;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-6 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon className="size-4" /> 返回列表
        </Button>
        <h2 className="text-lg font-semibold">{conn.name || "webshell"}</h2>
        <Badge className={PROTOCOL_BADGE[conn.protocol] ?? ""}>{PROTOCOL_LABEL[conn.protocol] ?? conn.protocol}</Badge>
        {conn.kind === "mem" && <Badge variant="outline">内存马</Badge>}
        <span className="text-muted-foreground truncate font-mono text-sm" title={conn.url}>
          {conn.url}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {conn.os && <span className="text-muted-foreground font-mono text-sm">{conn.os}</span>}
          <Button variant="outline" size="sm" disabled={probing} onClick={() => void probe()}>
            <RefreshCwIcon className={`size-4 ${probing ? "animate-spin" : ""}`} /> {probing ? "探测中…" : "探活"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="terminal" className="flex flex-1 flex-col gap-4">
        <TabsList>
          <TabsTrigger value="terminal">终端</TabsTrigger>
          <TabsTrigger value="files">文件</TabsTrigger>
          <TabsTrigger value="db">数据库</TabsTrigger>
          <TabsTrigger value="info">信息 / 台账</TabsTrigger>
        </TabsList>
        <TabsContent value="terminal" className="mt-0">
          <WebshellTerminal conn={conn} />
        </TabsContent>
        <TabsContent value="files" className="mt-0">
          <WebshellFilePanel conn={conn} />
        </TabsContent>
        <TabsContent value="db" className="mt-0">
          <WebshellDBPanel conn={conn} />
        </TabsContent>
        <TabsContent value="info" className="mt-0">
          <WebshellInfo conn={conn} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WebshellTerminal({ conn }: { conn: WebshellConn }) {
  const exec = React.useCallback(
    async (command: string) => {
      const r = await api.webshellExec(conn.id, command);
      return r.output || "(无输出)";
    },
    [conn.id],
  );
  return <ShellTerminal exec={exec} quickOS={conn.os === "windows" ? "windows" : "linux"} height="calc(100vh - 17rem)" minHeight={480} />;
}

function WebshellInfo({ conn }: { conn: WebshellConn }) {
  const [ops, setOps] = React.useState<ShellOpLog[]>([]);
  React.useEffect(() => {
    api.webshellOps(conn.id, 100).then(setOps).catch(() => {});
  }, [conn.id]);
  return (
    <div className="flex flex-col gap-4">
      <Card className="py-0">
        <div className="px-5 py-4">
          <p className="mb-2 text-sm font-medium">基本信息(最近一次探活)</p>
          <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-sm">
            {conn.basic_info && Object.keys(conn.basic_info).length > 0 ? JSON.stringify(conn.basic_info, null, 2) : "暂无——点「探活」采集。"}
          </pre>
        </div>
      </Card>
      <Card className="py-0">
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">操作台账(最近 100 条,报告门/清痕对账用)</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => api.webshellOps(conn.id, 100).then(setOps).catch(() => {})}
            >
              <RefreshCwIcon className="size-4" />
            </Button>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border">
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
                    <TableCell colSpan={3} className="text-muted-foreground py-6 text-center text-sm">
                      暂无记录
                    </TableCell>
                  </TableRow>
                )}
                {ops.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-muted-foreground text-sm">{new Date(l.created_at).toLocaleString("zh-CN", { hour12: false })}</TableCell>
                    <TableCell className="font-mono text-sm">{l.action}</TableCell>
                    <TableCell className="max-w-[36rem] truncate font-mono text-sm" title={l.detail}>
                      {l.detail}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </div>
  );
}
