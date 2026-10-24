"use client";

// VShell 插件运行(仿原版):选择客户端 + 选择插件(runner/list)+ 参数 → runplugin;
// 插件上传走 /runner/upload(multipart)。系统设置(dingding/wx 通知)也在本文件。
import * as React from "react";
import { PlayIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { VshellHost, VshellServer } from "@/lib/types";

export function VshellPluginsPage({ server }: { server: VshellServer }) {
  const [hosts, setHosts] = React.useState<VshellHost[]>([]);
  const [plugins, setPlugins] = React.useState<{ id: number; name: string }[]>([]);
  const [hostId, setHostId] = React.useState("");
  const [pluginName, setPluginName] = React.useState("");
  const [args, setArgs] = React.useState("");
  const [output, setOutput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const [hs, ps] = await Promise.all([
        api.vshellHosts(server.id, false),
        callApi(server.id, "runner/list") as Promise<{ id: number; name: string }[]>,
      ]);
      setHosts(hs);
      setPlugins(Array.isArray(ps) ? ps : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "插件清单加载失败");
    }
  }, [server.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    if (!hostId || !pluginName) {
      toast.error("先选择客户端和插件");
      return;
    }
    setBusy(true);
    setOutput("");
    try {
      // 原版表单契约:id=客户端 Id,pluginName=插件文件名,procArg=参数
      const res = (await callApi(server.id, "runner/runplugin", { id: Number(hostId), pluginName, procArg: args })) as unknown;
      setOutput(typeof res === "string" ? res : JSON.stringify(res, null, 2));
      toast.success("插件执行完成");
    } catch (e) {
      setOutput(`执行失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("artex_token") ?? "";
      const r = await fetch(`/api/shell/vshell/${server.id}/runner/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const payload = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
      toast.success(`插件 ${file.name} 已上传(vshell plugins 目录)`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardContent className="px-6 py-5">
        <p className="text-muted-foreground mb-5 text-sm">
          plugins 目录内的文件都视为插件,内存加载运行,支持 exe / .net / elf / dll / so / dylib(自行添加需遵循后缀规范)。
        </p>
        <FieldGroup className="max-w-4xl gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>选择客户端</FieldLabel>
              <Select value={hostId} onValueChange={setHostId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((h) => (
                    <SelectItem key={h.Id} value={String(h.Id)}>
                      <HostOption host={h} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>选择插件</FieldLabel>
              <Select value={pluginName} onValueChange={setPluginName}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {plugins.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      <span className="font-mono text-sm">{p.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel>参数</FieldLabel>
            <Input className="h-10 text-sm" value={args} placeholder="请输入" onChange={(e) => setArgs(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button className="h-10 px-6" disabled={busy} onClick={() => void run()}>
              <PlayIcon className={`size-4 ${busy ? "animate-pulse" : ""}`} /> {busy ? "运行中…" : "运行"}
            </Button>
            <Button className="h-10" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <UploadIcon className="size-4" /> {uploading ? "上传中…" : "上传插件"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </div>
          <Field>
            <FieldLabel>output</FieldLabel>
            <textarea
              className="h-96 w-full resize-none rounded-md border bg-black p-4 font-mono text-[13px] leading-6 text-zinc-200 outline-none"
              value={output}
              readOnly
              placeholder=""
            />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

export function VshellSettingsPage({ server }: { server: VshellServer }) {
  const [dingToken, setDingToken] = React.useState("");
  const [dingKeyword, setDingKeyword] = React.useState("");
  const [wxKey, setWxKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    callApi(server.id, "setting/get")
      .then((res) => {
        const s = (res ?? {}) as { dingding_access_token?: string; dingding_key_word?: string; wx_key?: string };
        setDingToken(s.dingding_access_token ?? "");
        setDingKeyword(s.dingding_key_word ?? "");
        setWxKey(s.wx_key ?? "");
      })
      .catch(() => {});
  }, [server.id]);

  const save = async () => {
    setBusy(true);
    try {
      await callApi(server.id, "setting/edit", {
        dingding_access_token: dingToken,
        dingding_key_word: dingKeyword,
        wx_key: wxKey,
      });
      toast.success("设置已保存(vshell 无需重启生效)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="px-6 py-5">
        <p className="font-medium">设置</p>
        <p className="text-muted-foreground mb-5 text-sm">无需重启修改部分设置——上线通知推送(vshell 侧)。</p>
        <FieldGroup className="max-w-4xl gap-5">
          <Field>
            <FieldLabel>钉钉 token</FieldLabel>
            <Input value={dingToken} onChange={(e) => setDingToken(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>钉钉 key_word</FieldLabel>
            <Input value={dingKeyword} onChange={(e) => setDingKeyword(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>微信 wx_key</FieldLabel>
            <Input value={wxKey} onChange={(e) => setWxKey(e.target.value)} />
          </Field>
          <Button className="w-fit" disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

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


// 主机下拉选项:在线点 + 主机名 + 内网 IP(终端/文件/隧道/插件共用)。
export function HostOption({ host }: { host: { Id: number; HostName: string; Addr: string; LocalIP: string; IsConnect: boolean; OsName?: string } }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <span className={`inline-flex size-2 shrink-0 rounded-full ${host.IsConnect ? "bg-emerald-500" : "bg-zinc-400"}`} />
      <span className="shrink-0 font-mono text-sm text-zinc-500">#{host.Id}</span>
      <span className="shrink-0 text-sm font-medium">{host.HostName || host.Addr || "(未命名)"}</span>
      <span className="text-muted-foreground truncate font-mono text-sm">{host.LocalIP || host.Addr}</span>
      {host.OsName && <span className="text-muted-foreground/70 ml-auto shrink-0 font-mono text-[11px]">{host.OsName}</span>}
    </span>
  );
}
