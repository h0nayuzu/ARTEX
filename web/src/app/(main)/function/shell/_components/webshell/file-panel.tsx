"use client";

// webshell 文件管理:统一操作面(原生操作码 > eval 片段 > 命令翻译,后端自动降级)。
// ls / 读写(二进制安全分块) / 删除 / 建目录 / 重命名 / chmod / 时间戳伪造 /
// 远程下载 / md5 / 上传 / 下载到本机 / 盘符根。
import * as React from "react";
import { DownloadIcon, FolderUpIcon, HardDriveIcon, RefreshCwIcon, SaveIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { WebshellConn, WebshellFileEntry } from "@/lib/types";

export function WebshellFilePanel({ conn }: { conn: WebshellConn }) {
  const [dir, setDir] = React.useState("/");
  const [items, setItems] = React.useState<WebshellFileEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [viewer, setViewer] = React.useState<{ path: string; text: string; dirty: boolean; b64: string; binary: boolean } | null>(null);
  const [newName, setNewName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const [saveAs, setSaveAs] = React.useState<{ b64: string } | null>(null);

  React.useEffect(() => {
    // 首开:windows 先取盘符,linux 直接 /
    if (conn.os === "windows") {
      api
        .webshellFile(conn.id, { op: "roots" })
        .then((r) => {
          const roots = (r.roots as string[]) ?? [];
          if (roots.length > 0) setDir(roots[0]);
        })
        .catch(() => setDir("/"));
    }
  }, [conn.id, conn.os]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = (await api.webshellFile(conn.id, { op: "ls", path: dir })) as { items?: WebshellFileEntry[] };
      setItems(r.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "列目录失败");
    } finally {
      setLoading(false);
    }
  }, [conn.id, dir]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const fullPath = (name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + "/" + name);

  const action = async (op: string, path: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await api.webshellFile(conn.id, { op, path, ...extra });
      await load();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (entry: WebshellFileEntry) => {
    const path = fullPath(entry.name);
    try {
      const r = (await api.webshellFile(conn.id, { op: "read", path })) as { b64?: string };
      const b64 = r.b64 ?? "";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const binary = bytes.length > 0 && bytes.slice(0, 4096).some((b) => b === 0);
      const text = binary ? "" : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      setViewer({ path, text, dirty: false, b64, binary });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取失败");
    }
  };

  const saveFile = async () => {
    if (!viewer) return;
    const b64 = btoa(unescape(encodeURIComponent(viewer.text)));
    try {
      await api.webshellFile(conn.id, { op: "write", path: viewer.path, b64 });
      toast.success("已保存");
      setViewer((v) => (v ? { ...v, dirty: false } : v));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const upload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      await api.webshellFile(conn.id, { op: "write", path: fullPath(file.name), b64 });
      toast.success(`已上传 ${file.name}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    }
  };

  const download = (name: string) => {
    const q = new URLSearchParams({ path: fullPath(name) });
    window.open(`/api/shell/webshell/${conn.id}/download?${q}`, "_blank");
  };

  const parent = () => {
    const norm = dir.replace(/[\\/]+$/, "");
    const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
    if (i <= 0) {
      setDir(conn.os === "windows" ? dir : "/");
      return;
    }
    setDir(norm.slice(0, i + 1));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Input value={dir} className="font-mono text-sm" onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} />
        <Button size="icon" variant="outline" onClick={() => void load()} disabled={loading} title="刷新">
          <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="icon" variant="outline" onClick={parent} title="上级">
          <FolderUpIcon className="h-4 w-4" />
        </Button>
        {conn.os === "windows" && (
          <Button
            size="icon"
            variant="outline"
            title="盘符"
            onClick={async () => {
              const r = await api.webshellFile(conn.id, { op: "roots" }).catch(() => null);
              const roots = ((r?.roots as string[]) ?? []);
              if (roots.length) toast.info(`盘符:${roots.join(" ")}`);
            }}
          >
            <HardDriveIcon className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={newName} placeholder="新名字" className="h-8 w-36 text-sm" onChange={(e) => setNewName(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!newName || busy} onClick={() => void action("mkdir", fullPath(newName))}>
          建目录
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => uploadRef.current?.click()}>
          <UploadIcon className="h-4 w-4" /> 上传
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
        <span className="text-sm text-muted-foreground">
          读写走原生操作码/eval 片段,二进制安全自动分块;命令通道自动降级命令翻译。
        </span>
      </div>

      <Table className="[&_th]:h-12 [&_td]:h-12">
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-24">大小</TableHead>
            <TableHead className="w-20">权限</TableHead>
            <TableHead className="w-40">修改时间</TableHead>
            <TableHead className="w-64">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                {loading ? "加载中…" : "空目录"}
              </TableCell>
            </TableRow>
          )}
          {items.map((e) => (
            <TableRow key={e.name}>
              <TableCell className="font-mono text-sm">
                {e.is_dir ? (
                  <button className="text-blue-500 hover:underline" onClick={() => setDir(fullPath(e.name))}>
                    📁 {e.name}
                  </button>
                ) : (
                  <span>📄 {e.name}</span>
                )}
              </TableCell>
              <TableCell className="text-sm">{e.is_dir ? "—" : fmtSize(e.size)}</TableCell>
              <TableCell className="font-mono text-sm">{e.perm || "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{e.mtime || "—"}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {!e.is_dir && (
                    <>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => void openFile(e)}>
                        查看/编辑
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => download(e.name)}>
                        <DownloadIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        title="MD5 校验"
                        onClick={async () => {
                          const r = await action("hash", fullPath(e.name));
                          if (r) toast.info(`MD5: ${String(r.md5 ?? "")}`);
                        }}
                      >
                        md5
                      </Button>
                    </>
                  )}
                  {!e.is_dir && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      title="重命名/移动"
                      disabled={busy}
                      onClick={() => {
                        const to = prompt("移动/重命名为(绝对路径):", fullPath(e.name));
                        if (to && to !== fullPath(e.name)) void action("mv", `${fullPath(e.name)}→${to}`);
                      }}
                    >
                      移动
                    </Button>
                  )}
                  {!e.is_dir && conn.os !== "windows" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      title="改权限"
                      disabled={busy}
                      onClick={() => {
                        const mode = prompt("八进制权限(如 0644):", e.perm || "0644");
                        if (mode) void action("chmod", fullPath(e.name), { mode });
                      }}
                    >
                      chmod
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-destructive"
                    disabled={busy}
                    onClick={() => confirm(`删除 ${e.name}?${e.is_dir ? "(目录将递归删除)" : ""}`) && void action(e.is_dir ? "delete-dir" : "delete", fullPath(e.name))}
                  >
                    删除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setViewer(null)}>
          <div className="flex h-full max-h-[80vh] w-full max-w-4xl flex-col rounded-lg border bg-background shadow-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-2">
              <p className="font-mono text-sm font-medium">
                {viewer.path} {viewer.dirty && <span className="text-amber-500">(未保存)</span>}
                {viewer.binary && <span className="ml-2 text-sm text-red-500">二进制文件(只读)</span>}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void saveFile()} disabled={!viewer.dirty || viewer.binary}>
                  <SaveIcon className="h-4 w-4" /> 保存
                </Button>
                <Button size="sm" variant="outline" onClick={() => setViewer(null)}>
                  关闭
                </Button>
              </div>
            </div>
            {viewer.binary ? (
              <p className="flex-1 p-4 text-sm text-muted-foreground">二进制文件——用「下载」取回本机处理。</p>
            ) : (
              <textarea
                className="flex-1 resize-none rounded-b-lg bg-black p-3 font-mono text-sm text-zinc-200 outline-none"
                value={viewer.text}
                spellCheck={false}
                onChange={(e) => setViewer((v) => (v ? { ...v, text: e.target.value, dirty: true } : v))}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
