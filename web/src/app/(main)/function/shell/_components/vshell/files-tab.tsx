"use client";

// VShell 文件管理(仿原版布局):左侧文件树(懒加载展开)+ 右侧
// [主目录/上级/刷新/路径/Open/新建文件夹/新建文件/wget文件/上传] + 表格。
// vshell file/ls 行字段:{name, isDir, time, mode, size}(全小写,2026-10 实测)。
import * as React from "react";
import {
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderUpIcon,
  HardDriveIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  TrashIcon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { HostOption } from "./plugins-page";
import type { VshellHost, VshellServer } from "@/lib/types";

interface VFileItem {
  name: string;
  isDir: boolean;
  time?: string;
  mode?: string;
  size?: number;
  Name?: string;
  IsDir?: boolean;
  Size?: number;
  ModTime?: string;
}

function fname(e: VFileItem): string {
  return String(e.name ?? e.Name ?? "");
}
function fdir(e: VFileItem): boolean {
  return Boolean(e.isDir ?? e.IsDir ?? false);
}
function ftime(e: VFileItem): string {
  return String(e.time ?? e.ModTime ?? "");
}
function fsize(e: VFileItem): number {
  return Number(e.size ?? e.Size ?? 0);
}
function fmode(e: VFileItem): string {
  return String(e.mode ?? "");
}

export function VshellFilesTab({ server, fixedHostId }: { server: VshellServer; fixedHostId?: string }) {
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [hostId, setHostId] = React.useState(fixedHostId ?? "");
  const [dir, setDir] = React.useState("/");
  const [items, setItems] = React.useState<VFileItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [viewer, setViewer] = React.useState<{ name: string; content: string; dirty: boolean } | null>(null);
  const [newName, setNewName] = React.useState("");
  const [wgetURL, setWgetURL] = React.useState("");
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
      const list = [...(r.items ?? [])];
      // 目录在前,各自按名称排序
      list.sort((a, b) => (fdir(b) ? 1 : 0) - (fdir(a) ? 1 : 0) || fname(a).localeCompare(fname(b)));
      setItems(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "列目录失败");
      setItems([]);
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
      setViewer({ name, content: r.content ?? "", dirty: false });
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
    const norm = dir.replace(/\/+$/, "");
    const i = norm.lastIndexOf("/");
    setDir(i <= 0 ? "/" : norm.slice(0, i) || "/");
  };

  const current = hosts.find((h) => String(h.Id) === hostId);
  const crumbs = dir.split("/").filter(Boolean);

  return (
    <div className="flex h-[calc(100vh-9.5rem)] min-h-[560px] gap-3">
      {/* 左:文件树 */}
      <FileTree server={server} hostId={hostId} dir={dir} onNavigate={setDir} />

      {/* 右:工具栏 + 表格 */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="icon" variant="outline" className="size-9" title="根目录" onClick={() => setDir("/")}>
            <HardDriveIcon className="size-4" />
          </Button>
          <Button size="icon" variant="outline" className="size-9" title="上级" onClick={parent}>
            <FolderUpIcon className="size-4" />
          </Button>
          <Button size="icon" variant="outline" className="size-9" title="刷新" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Input
            value={dir}
            className="h-9 min-w-40 flex-1 font-mono text-sm"
            onChange={(e) => setDir(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
          />
          <Button size="sm" variant="outline" className="h-9" onClick={() => void load()}>
            Open
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input value={newName} placeholder="名称" className="h-9 w-36 text-sm" onChange={(e) => setNewName(e.target.value)} />
          <Button size="sm" variant="outline" className="h-9" disabled={!newName || busy} onClick={() => void action("mkdir", newName)}>
            新建文件夹
          </Button>
          <Button size="sm" variant="outline" className="h-9" disabled={!newName || busy} onClick={() => void action("touch", newName)}>
            新建文件
          </Button>
          <Input value={wgetURL} placeholder="wget 文件 URL" className="h-9 w-56 font-mono text-sm" onChange={(e) => setWgetURL(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            disabled={!wgetURL || busy}
            onClick={() => {
              const name = wgetURL.split("/").filter(Boolean).pop() ?? "download.bin";
              void action("wget", name, undefined, wgetURL);
            }}
            title="wget 下载到当前目录"
          >
            wget文件
          </Button>
          <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => uploadRef.current?.click()}>
            <UploadIcon className="size-4" /> 上传文件
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
            <span className="text-muted-foreground ml-auto text-sm">
              #{current.Id} {current.HostName} · {current.OsName} · {current.LocalIP}
            </span>
          )}
        </div>

        {/* 面包屑 */}
        <div className="flex items-center gap-0.5 text-sm">
          <button className="hover:text-foreground text-muted-foreground" onClick={() => setDir("/")}>
            /
          </button>
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              <button
                className="hover:text-foreground text-muted-foreground"
                onClick={() => setDir("/" + crumbs.slice(0, i + 1).join("/"))}
              >
                {c}
              </button>
              {i < crumbs.length - 1 && <span className="text-muted-foreground/50">/</span>}
            </React.Fragment>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table className="[&_th]:h-12 [&_td]:h-12">
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-40">Time</TableHead>
                <TableHead className="w-20">Mode</TableHead>
                <TableHead className="w-24">Size</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                    {loading ? "加载中…" : "暂无数据"}
                  </TableCell>
                </TableRow>
              )}
              {items.map((e, i) => {
                const name = fname(e);
                const isDir = fdir(e);
                return (
                  <ContextMenu key={`${name}-${i}`}>
                  <ContextMenuTrigger asChild>
                  <TableRow className="cursor-default select-none">
                    <TableCell className="max-w-80">
                      {isDir ? (
                        <button
                          className="flex min-w-0 items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
                          onClick={() => setDir(joinPath(dir, name))}
                          title={name}
                        >
                          <FolderIcon className="text-muted-foreground/80 size-4 shrink-0" />
                          <span className="truncate font-mono text-sm">{name}</span>
                        </button>
                      ) : (
                        <span className="flex min-w-0 items-center gap-1.5" title={name}>
                          <FileIcon className="text-muted-foreground/60 size-4 shrink-0" />
                          <span className="truncate font-mono text-sm">{name}</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{ftime(e) || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{fmode(e) || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{isDir ? "—" : fmtSize(fsize(e))}</TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        {!isDir && (
                          <>
                            <Button size="icon" variant="ghost" className="size-8" title="查看/编辑" onClick={() => void openFile(name)}>
                              <PencilIcon className="size-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-8" title="下载" onClick={() => download(name)}>
                              <DownloadIcon className="size-3.5" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive size-8"
                          title="删除"
                          disabled={busy}
                          onClick={() => confirm(`删除 ${name}?`) && void action("rm", name)}
                        >
                          <TrashIcon className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-44">
                    {isDir ? (
                      <ContextMenuItem onClick={() => setDir(joinPath(dir, name))}>打开</ContextMenuItem>
                    ) : (
                      <ContextMenuItem onClick={() => void openFile(name)}>查看 / 编辑</ContextMenuItem>
                    )}
                    {!isDir && <ContextMenuItem onClick={() => download(name)}>下载</ContextMenuItem>}
                    <ContextMenuItem onClick={() => void navigator.clipboard.writeText(joinPath(dir, name)).then(() => toast.success("已拷贝路径"))}>
                      拷贝路径
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        const to = prompt(`重命名 ${name} 为:`, name);
                        if (to && to !== name) void action("mv", name, to);
                      }}
                    >
                      重命名
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        const v = prompt(`修改时间 ${name}(YYYY-MM-DD HH:MM:SS 或 epoch 秒):`, ftime(e));
                        if (!v) return;
                        const epoch = /^\d+$/.test(v.trim()) ? Number(v.trim()) : Math.floor(new Date(v.replace(" ", "T") + "Z").getTime() / 1000);
                        if (!epoch || Number.isNaN(epoch)) {
                          toast.error("时间格式无法解析");
                          return;
                        }
                        void genericModifyTime(server.id, hostId, dir, name, epoch);
                      }}
                    >
                      修改时间
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => confirm(`删除 ${name}?`) && void action("rm", name)}
                    >
                      删除
                    </ContextMenuItem>
                  </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setViewer(null)}>
          <div className="flex h-full max-h-[80vh] w-full max-w-4xl flex-col rounded-lg border bg-background shadow-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-2">
              <p className="font-mono text-sm font-medium">
                {dir}/{viewer.name} {viewer.dirty && <span className="text-amber-500">(未保存)</span>}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void saveFile()} disabled={!viewer.dirty}>
                  <SaveIcon className="size-4" /> 保存
                </Button>
                <Button size="sm" variant="outline" onClick={() => setViewer(null)}>
                  关闭
                </Button>
              </div>
            </div>
            <textarea
              className="flex-1 resize-none rounded-b-lg bg-black p-3 font-mono text-sm text-zinc-200 outline-none"
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

// ---------------------------------------------------------------- 文件树

interface TreeNode {
  path: string;
  name: string;
  loaded: boolean;
  children: TreeNode[];
  expanded: boolean;
}

function FileTree({
  server,
  hostId,
  dir,
  onNavigate,
}: {
  server: VshellServer;
  hostId: string;
  dir: string;
  onNavigate: (path: string) => void;
}) {
  const [roots, setRoots] = React.useState<string[]>(["/"]);
  const [rootsLoaded, setRootsLoaded] = React.useState(false);
  const [tree, setTree] = React.useState<TreeNode[]>([]);
  const [loadingNode, setLoadingNode] = React.useState("");

  // 盘符/根:file/getdisk(linux 返回 ["/"],windows 返回盘符;失败回退 /)
  React.useEffect(() => {
    if (!hostId) return;
    setRootsLoaded(false);
    (async () => {
      try {
        const r = await fetch(`/api/shell/vshell/${server.id}/api/file/getdisk`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("artex_token") ?? ""}` },
          body: JSON.stringify({ endpoint: "file/getdisk", body: { id: Number(hostId) } }),
        });
        const payload = (await r.json()) as { result?: unknown; error?: string };
        if (!r.ok || !payload.result) throw new Error(payload.error || `HTTP ${r.status}`);
        const res = payload.result as unknown;
        // 实测返回 [{name:"/",isDir:true,...}]——对象取 name,字符串直用
        const raw: unknown[] = Array.isArray(res)
          ? res
          : ((res as { disks?: unknown[]; items?: unknown[] })?.disks ?? (res as { items?: unknown[] })?.items ?? []);
        const disks = raw
          .map((v) => (typeof v === "string" ? v : String((v as { name?: string; Name?: string; path?: string })?.name ?? (v as { Name?: string })?.Name ?? (v as { path?: string })?.path ?? "")))
          .filter(Boolean);
        setRoots(disks.length > 0 ? disks : ["/"]);
      } catch {
        setRoots(["/"]);
      } finally {
        setRootsLoaded(true);
      }
    })();
  }, [server.id, hostId]);

  React.useEffect(() => {
    setTree(roots.map((r) => ({ path: r, name: r === "/" ? "/" : r, loaded: false, children: [], expanded: false })));
  }, [roots]);

  const loadChildren = async (node: TreeNode) => {
    if (node.loaded) return;
    setLoadingNode(node.path);
    try {
      const r = (await api.vshellFile(server.id, { op: "ls", host_id: hostId, path: node.path })) as { items?: VFileItem[] };
      const children = (r.items ?? [])
        .filter((e) => fdir(e))
        .map((e) => ({ path: joinPath(node.path, fname(e)), name: fname(e), loaded: false, children: [], expanded: false }))
        .slice(0, 200);
      setTree((t) => updateNode(t, node.path, (n) => ({ ...n, loaded: true, children })));
    } catch {
      setTree((t) => updateNode(t, node.path, (n) => ({ ...n, loaded: true, children: [] })));
    } finally {
      setLoadingNode("");
    }
  };

  const toggle = async (node: TreeNode) => {
    const willExpand = !node.expanded;
    setTree((t) => updateNode(t, node.path, (n) => ({ ...n, expanded: willExpand })));
    if (willExpand) await loadChildren(node);
  };

  const renderNode = (node: TreeNode, depth: number) => (
    <div key={node.path}>
      <div
        className={`hover:bg-accent flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 ${
          dir === node.path ? "bg-accent" : ""
        }`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => {
          onNavigate(node.path);
          void toggle(node);
        }}
      >
        <ChevronRightIcon
          className={`text-muted-foreground size-3 shrink-0 transition-transform ${node.expanded ? "rotate-90" : ""} ${
            loadingNode === node.path ? "animate-spin" : ""
          }`}
        />
        {node.expanded ? (
          <FolderOpenIcon className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="truncate font-mono text-sm">{node.name}</span>
      </div>
      {node.expanded && node.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="flex w-60 shrink-0 flex-col rounded-md border">
      <div className="text-muted-foreground flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        文件树
        <span className="ml-auto font-mono">#{hostId}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {!rootsLoaded ? (
          <p className="text-muted-foreground p-2 text-sm">加载中…</p>
        ) : (
          tree.map((n) => renderNode(n, 0))
        )}
      </div>
    </div>
  );
}

function updateNode(nodes: TreeNode[], path: string, patch: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return patch(n);
    if (n.children.length > 0) return { ...n, children: updateNode(n.children, path, patch) };
    return n;
  });
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



// file/modifytime 走通用代理(参数名按 vshell 端点惯例,失败透传错误)。
async function genericModifyTime(serverId: string, hostId: string, path: string, target: string, epoch: number) {
  try {
    const r = await fetch(`/api/shell/vshell/${serverId}/api/file/modifytime`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("artex_token") ?? ""}` },
      body: JSON.stringify({ endpoint: "file/modifytime", body: { id: Number(hostId), path, target, time: epoch, timestamp: epoch } }),
    });
    const payload = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
    toast.success("时间已修改");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "修改时间失败");
  }
}
