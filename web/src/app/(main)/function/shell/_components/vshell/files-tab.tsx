"use client";

// VShell 文件管理:主机选择 + 目录浏览器(ls)+ 文本查看/编辑(cat/edit 整文件覆盖)
// + 上传(multipart)+ 下载(三步链流回浏览器)+ mkdir/rm/mv/touch/wget。
import * as React from "react";
import { DownloadIcon, FolderUpIcon, RefreshCwIcon, SaveIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";

interface VFileItem {
  Name?: string;
  IsDir?: boolean;
  Size?: number;
  ModTime?: string;
  [key: string]: unknown;
}

function fname(e: VFileItem): string {
  return (e.Name ?? (e.name as string) ?? "") as string;
}
function fdir(e: VFileItem): boolean {
  return Boolean((e.IsDir ?? e.isDir ?? e.isdir) ?? false);
}

export function VshellFilesTab({ server, fixedHostId }: { server: VshellServer; fixedHostId?: string }) {
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [hostId, setHostId] = React.useState(fixedHostId ?? "");
  const [dir, setDir] = React.useState("/");
  const [items, setItems] = React.useState<VFileItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [viewer, setViewer] = React.useState<{ name: string; content: string; dirty: boolean; binary: boolean } | null>(null);
  const [newName, setNewName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const uploadRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (fixedHostId) {
      setHostId(fixedHostId);
      api
        .vshellHosts(server.id, false)
        .then((items) => setHosts(items.filter((h) => String(h.Id) === fixedHostId)))
        .catch(() => {});
      return;
    }
    api
      .vshellHosts(server.id, false)
      .then((items) => {
        setHosts(items);
        const first = items.find((h) => h.IsConnect) ?? items[0];
        if (first) setHostId(String(first.Id));
      })
      .catch(() => {});
  }, [server.id, fixedHostId]);

  const load = React.useCallback(async () => {
    if (!hostId) return;
    setLoading(true);
    try {
      const r = (await api.vshellFile(server.id, { op: "ls", host_id: hostId, path: dir })) as { items?: VFileItem[] };
      setItems(r.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "列目录失败");
    } finally {
      setLoading(false);
    }
  }, [server.id, hostId, dir]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const action = async (op: string, target: string, to?: string, content?: string) => {
    setBusy(true);
    try {
      await api.vshellFile(server.id, { op, host_id: hostId, path: dir, target, to, content });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (name: string) => {
    try {
      const r = (await api.vshellFile(server.id, { op: "read", host_id: hostId, path: dir, target: name })) as { content?: string };
      setViewer({ name, content: r.content ?? "", dirty: false, binary: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取失败");
    }
  };

  const saveFile = async () => {
    if (!viewer) return;
    try {
      await api.vshellFile(server.id, { op: "write", host_id: hostId, path: dir, target: viewer.name, content: viewer.content });
      toast.success("已保存(整文件覆盖)");
      setViewer((v) => (v ? { ...v, dirty: false } : v));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const upload = async (file: File) => {
    try {
      await api.vshellUpload(server.id, hostId, dir, file);
      toast.success(`已上传 ${file.name}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    }
  };

  const download = (name: string) => {
    const q = new URLSearchParams({ host: hostId, path: dir, name });
    window.open(`/api/shell/vshell/${server.id}/download?${q}`, "_blank");
  };

  const parent = () => {
    const parts = dir.replace(/\/+$/, "").split("/");
    parts.pop();
    setDir(parts.length <= 1 ? "/" : parts.join("/"));
  };

  const current = hosts.find((h) => String(h.Id) === hostId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!fixedHostId && (
          <Select value={hostId} onValueChange={setHostId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="选择主机" />
            </SelectTrigger>
            <SelectContent>
              {hosts.map((h) => (
                <SelectItem key={h.Id} value={String(h.Id)}>
                  #{h.Id} {h.HostName || h.Addr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Input value={dir} className="font-mono text-xs" onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} />
          <Button size="icon" variant="outline" onClick={() => void load()} disabled={loading || !hostId} title="刷新">
            <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="icon" variant="outline" onClick={parent} title="上级">
            <FolderUpIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={newName} placeholder="新文件/目录名" className="h-8 w-44 text-xs" onChange={(e) => setNewName(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!newName || busy} onClick={() => void action("mkdir", newName)}>
          建目录
        </Button>
        <Button size="sm" variant="outline" disabled={!newName || busy} onClick={() => void action("touch", newName)}>
          建文件
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => uploadRef.current?.click()}>
          <UploadIcon className="h-4 w-4" /> 上传(≤8MB)
        </Button>
        <input
          ref={uploadRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        {current && (
          <span className="text-xs text-muted-foreground">
            {current.OsName} · {current.HostName}
          </span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-24">大小</TableHead>
            <TableHead className="w-44">修改时间</TableHead>
            <TableHead className="w-48">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                {loading ? "加载中…" : "空目录"}
              </TableCell>
            </TableRow>
          )}
          {items.map((e, i) => {
            const name = fname(e);
            return (
              <TableRow key={`${name}-${i}`}>
                <TableCell className="font-mono text-xs">
                  {fdir(e) ? (
                    <button className="text-blue-500 hover:underline" onClick={() => setDir(joinPath(dir, name))}>
                      📁 {name}
                    </button>
                  ) : (
                    <span>📄 {name}</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{fdir(e) ? "—" : fmtSize(Number(e.Size ?? 0))}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{String(e.ModTime ?? "")}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {!fdir(e) && (
                      <>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => void openFile(name)}>
                          查看/编辑
                        </Button>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => download(name)}>
                          <DownloadIcon className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-destructive"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`删除 ${name}?`)) void action(fdir(e) ? "rm" : "rm", name);
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setViewer(null)}>
          <div className="flex h-full max-h-[80vh] w-full max-w-4xl flex-col rounded-lg border bg-background shadow-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-2">
              <p className="font-mono text-sm font-medium">
                {dir}/{viewer.name} {viewer.dirty && <span className="text-amber-500">(未保存)</span>}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void saveFile()} disabled={!viewer.dirty}>
                  <SaveIcon className="h-4 w-4" /> 保存
                </Button>
                <Button size="sm" variant="outline" onClick={() => setViewer(null)}>
                  关闭
                </Button>
              </div>
            </div>
            <textarea
              className="flex-1 resize-none rounded-b-lg bg-black p-3 font-mono text-xs text-zinc-200 outline-none"
              value={viewer.content}
              spellCheck={false}
              onChange={(e) => setViewer((v) => (v ? { ...v, content: e.target.value, dirty: true } : v))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function joinPath(dir: string, name: string) {
  if (dir.endsWith("/")) return dir + name;
  return dir + "/" + name;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
