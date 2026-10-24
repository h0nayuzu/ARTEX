"use client";

// webshell 数据库控制台:每连接多套档案(PDO 原生:mysql/pgsql/sqlite/mssql)
// + 库→表→列逐级展开 + SQL 执行(前 200 行预览)。
import * as React from "react";
import { DatabaseIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { WebshellConn, WebshellDBProfile } from "@/lib/types";

interface DbQueryResult {
  cols?: string[];
  rows?: (string | null)[][];
  affected?: number;
  truncated?: boolean;
  error?: string;
}

export function WebshellDBPanel({ conn }: { conn: WebshellConn }) {
  const [profiles, setProfiles] = React.useState<WebshellDBProfile[]>([]);
  const [profileId, setProfileId] = React.useState("");
  const [dbs, setDbs] = React.useState<string[]>([]);
  const [tables, setTables] = React.useState<string[]>([]);
  const [selDb, setSelDb] = React.useState("");
  const [sql, setSql] = React.useState("");
  const [result, setResult] = React.useState<DbQueryResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<Partial<WebshellDBProfile> | null>(null);

  const loadProfiles = React.useCallback(async () => {
    try {
      const items = await api.webshellDBProfiles(conn.id);
      setProfiles(items);
      setProfileId((cur) => (items.some((p) => p.id === cur) ? cur : items[0]?.id ?? ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "档案加载失败");
    }
  }, [conn.id]);

  React.useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const profile = profiles.find((p) => p.id === profileId);

  const loadDbs = React.useCallback(async () => {
    if (!profileId) return;
    try {
      const r = (await api.webshellDB(conn.id, { op: "dbs", profile_id: profileId })) as { databases?: string[] };
      setDbs(r.databases ?? []);
    } catch {
      setDbs([]);
    }
  }, [conn.id, profileId]);

  const loadTables = React.useCallback(
    async (database: string) => {
      if (!profileId) return;
      try {
        const r = (await api.webshellDB(conn.id, { op: "tables", profile_id: profileId, database })) as { tables?: string[] };
        setTables(r.tables ?? []);
      } catch {
        setTables([]);
      }
    },
    [conn.id, profileId],
  );

  React.useEffect(() => {
    void loadDbs();
    setTables([]);
    setSelDb("");
  }, [loadDbs]);

  const runSQL = async (text?: string) => {
    const q = (text ?? sql).trim();
    if (!q) return;
    setBusy(true);
    setResult(null);
    try {
      const r = (await api.webshellDB(conn.id, { op: "exec", profile_id: profileId, database: selDb, sql: q })) as DbQueryResult;
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "SQL 执行失败");
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!editing) return;
    try {
      await api.webshellDBProfileSave(conn.id, editing as WebshellDBProfile);
      toast.success("档案已保存");
      setEditing(null);
      await loadProfiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
        <DatabaseIcon className="h-10 w-10 opacity-40" />
        <p className="text-sm">还没有数据库档案——PDO 原生连接(mysql/pgsql/sqlite/mssql),凭据从目标机发出。</p>
        <Button size="sm" onClick={() => setEditing({ type: "mysql", host: "", port: "3306", username: "", password: "", database: "", remark: "" })}>
          <PlusIcon className="h-4 w-4" /> 新建档案
        </Button>
        {editing && <ProfileForm editing={editing} setEditing={setEditing} onSave={() => void saveProfile()} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="选择档案" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.type} · {p.host}:{p.port}/{p.database || "—"} {p.remark ? `(${p.remark})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setEditing(profile ? { ...profile, password: "" } : null)}>
          编辑档案
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing({ type: "mysql", host: "", port: "3306", username: "", password: "", database: "", remark: "" })}
        >
          <PlusIcon className="h-4 w-4" /> 新建
        </Button>
        <Button size="sm" variant="outline" className="text-destructive" disabled={!profile} onClick={() => profile && confirm("删除该档案?") && void api.webshellDBProfileDelete(conn.id, profile.id).then(() => loadProfiles())}>
          <Trash2Icon className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => void loadDbs()} title="刷新库列表">
          <RefreshCwIcon className="h-4 w-4" />
        </Button>
        {profile && (
          <span className="text-sm text-muted-foreground">
            {profile.type}://{profile.host}:{profile.port}/{profile.database || "(未指定库)"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={selDb}
          onValueChange={(v) => {
            setSelDb(v);
            void loadTables(v);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="选择数据库" />
          </SelectTrigger>
          <SelectContent>
            {dbs.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tables.length > 0 && (
          <Select
            value=""
            onValueChange={(t) => {
              if (t) void runSQL(`SELECT * FROM \`${t}\` LIMIT 50`);
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder={`表(${tables.length}) — 选表预览`} />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <textarea
        className="h-24 w-full rounded-md border bg-black p-3 font-mono text-sm text-zinc-200 outline-none"
        placeholder="SQL(只读心态操作;SELECT 预览前 200 行)"
        value={sql}
        spellCheck={false}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void runSQL();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !sql.trim()} onClick={() => void runSQL()}>
          {busy ? "执行中…" : "执行(⌘/Ctrl+Enter)"}
        </Button>
        <span className="text-sm text-muted-foreground">执行走目标机 PDO——不依赖目标机 CLI 客户端。</span>
      </div>

      {result && (
        <div className="overflow-auto rounded-md border">
          {result.error ? (
            <p className="p-3 text-sm text-destructive">{result.error}</p>
          ) : result.cols && result.cols.length > 0 ? (
            <Table className="[&_th]:h-12 [&_td]:h-12">
              <TableHeader>
                <TableRow>
                  {result.cols.map((c) => (
                    <TableHead key={c} className="font-mono text-sm">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(result.rows ?? []).map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, j) => (
                      <TableCell key={j} className="max-w-64 truncate font-mono text-sm" title={cell ?? ""}>
                        {cell ?? <span className="text-muted-foreground">NULL</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-3 text-sm">
              affected: <b>{result.affected ?? 0}</b> 行
              {result.truncated ? "(结果已截断到 200 行)" : ""}
            </p>
          )}
        </div>
      )}

      {editing && <ProfileForm editing={editing} setEditing={setEditing} onSave={() => void saveProfile()} />}
    </div>
  );
}

function ProfileForm({
  editing,
  setEditing,
  onSave,
}: {
  editing: Partial<WebshellDBProfile>;
  setEditing: (v: Partial<WebshellDBProfile> | null) => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<WebshellDBProfile>) => setEditing({ ...editing, ...patch });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
      <div className="w-[28rem] rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <p className="mb-3 text-sm font-medium">{editing.id ? "编辑数据库档案" : "新建数据库档案"}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            类型
            <Select value={editing.type ?? "mysql"} onValueChange={(v) => set({ type: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["mysql", "pgsql", "sqlite", "mssql"].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            端口
            <Input value={editing.port ?? ""} placeholder="3306" onChange={(e) => set({ port: e.target.value })} />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            主机(sqlite 填文件路径)
            <Input value={editing.host ?? ""} onChange={(e) => set({ host: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            用户名
            <Input value={editing.username ?? ""} onChange={(e) => set({ username: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            密码{editing.id ? "(留空保持)" : ""}
            <Input type="password" value={editing.password ?? ""} onChange={(e) => set({ password: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            数据库
            <Input value={editing.database ?? ""} onChange={(e) => set({ database: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            备注
            <Input value={editing.remark ?? ""} onChange={(e) => set({ remark: e.target.value })} />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
            取消
          </Button>
          <Button size="sm" onClick={onSave}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
