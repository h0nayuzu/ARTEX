"use client";

// VShell 客户端生成(仿原版七标签):stage / shellcode / stageless / dll stageless /
// listen / dll listen / ebpf listen。全部经 ARTEX 代理 /download/* 端点下载。
import * as React from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { vshellApi, vshellGenerateDownload } from "@/lib/vshell-client";
import type { VshellServer } from "@/lib/types";

import { VshellListenersPage } from "./listeners-page";

const ARCHES = ["darwin_amd64", "darwin_arm64", "linux_amd64", "linux_i386", "linux_arm64", "linux_arm", "windows_amd64", "windows_i386"];


interface ListenerBrief {
  Id: number;
  Remark: string;
  Mode: string;
  Vkey: string;
  EncryptSalt: string;
}

export function VshellGeneratorPage({ server }: { server: VshellServer }) {
  const [listeners, setListeners] = React.useState<ListenerBrief[]>([]);
  const [tab, setTab] = React.useState("stage");

  React.useEffect(() => {
    vshellApi(server.id, "listener/list", { page: 1, pageSize: 9999, status: true })
      .then((res) => setListeners(((res as { items?: ListenerBrief[] })?.items ?? []) as ListenerBrief[]))
      .catch(() => {});
  }, [server.id]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col gap-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="stage">stage</TabsTrigger>
        <TabsTrigger value="shellcode">shellcode</TabsTrigger>
        <TabsTrigger value="stageless">stageless</TabsTrigger>
        <TabsTrigger value="dllstageless">dll stageless</TabsTrigger>
        <TabsTrigger value="listen">listen</TabsTrigger>
        <TabsTrigger value="dlllisten">dll listen</TabsTrigger>
        <TabsTrigger value="ebpf">ebpf listen</TabsTrigger>
      </TabsList>

      <TabsContent value="stage" className="mt-0">
        <Card>
          <CardContent className="px-6 py-5">
            <p className="text-base font-semibold">Stage 反向客户端</p>
            <p className="text-muted-foreground mb-5 text-sm">小体积客户端,反连模式上线。/download/stage?arch=&id=(监听 Id)。</p>
            <StageForm arches={ARCHES} listeners={listeners} server={server} kind="stage" />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="shellcode" className="mt-0">
        <Card>
          <CardContent className="px-6 py-5">
            <p className="text-base font-semibold">Shellcode 反向客户端</p>
            <p className="text-muted-foreground mb-5 text-sm">Windows shellcode,反连上线;/download/shellcode?arch=&format=&id=。</p>
            <StageForm arches={ARCHES} listeners={listeners} server={server} kind="shellcode" extraParam={{ name: "format", placeholder: "_raw(可空)" }} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="stageless" className="mt-0">
        <Card>
          <CardContent className="px-6 py-5">
            <p className="text-base font-semibold">Stageless 反向客户端</p>
            <p className="text-muted-foreground mb-5 text-sm">/download/stageless?id=&arch=&upx=&proxy=。</p>
            <UpxProxyForm server={server} kind="stageless" hasId listeners={listeners} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="dllstageless" className="mt-0">
        <Card>
          <CardContent className="px-6 py-5">
            <p className="text-base font-semibold">DLL Stageless</p>
            <p className="text-muted-foreground mb-5 text-sm">/download/dll?id=&arch=&upx=&proxy=;arch=loader 下载 loader.go。</p>
            <UpxProxyForm server={server} kind="dll" hasId listeners={listeners} allowLoader />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="listen" className="mt-0">
        <Card>
          <CardContent className="px-6 py-5">
            <p className="text-base font-semibold">正向客户端(监听)</p>
            <p className="text-muted-foreground mb-5 text-sm">/download/listen?arch=&tp=&host=&port=&vkey=&salt=&upx=。</p>
            <ListenForm server={server} kind="listen" />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="dlllisten" className="mt-0">
        <Card>
          <CardContent className="px-6 py-5">
            <p className="text-base font-semibold">DLL 正向客户端(listendll)</p>
            <p className="text-muted-foreground mb-5 text-sm">/download/listendll?arch=&tp=&host=&port=&vkey=&salt=&upx=。</p>
            <ListenForm server={server} kind="listendll" />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ebpf" className="mt-0">
        <Card>
          <CardContent className="px-6 py-5">
            <p className="text-base font-semibold">eBPF 正向客户端</p>
            <p className="text-muted-foreground mb-5 text-sm">/download/listen?...&listen=true&ebpf=true——仅 linux 内核支持。</p>
            <ListenForm server={server} kind="listen" ebpf />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function download(serverId: string, kind: string, params: Record<string, string>) {
  vshellGenerateDownload(serverId, kind, params);
}

function StageForm({
  arches,
  listeners,
  server,
  kind,
  extraParam,
}: {
  arches: string[];
  listeners: ListenerBrief[];
  server: VshellServer;
  kind: string;
  extraParam?: { name: string; placeholder: string };
}) {
  const [arch, setArch] = React.useState("windows_amd64");
  const [listenerId, setListenerId] = React.useState("");
  const [extra, setExtra] = React.useState("");
  return (
    <FieldGroup className="max-w-3xl gap-5">
      <Field>
        <FieldLabel>客户端类型</FieldLabel>
        <div className="grid w-fit grid-cols-4 gap-2">
          {arches.map((a) => (
            <Button key={a} size="sm" variant={arch === a ? "default" : "outline"} className="h-9 w-36 justify-start font-mono text-sm" onClick={() => setArch(a)}>
              {a}
            </Button>
          ))}
        </div>
      </Field>
      {extraParam && (
        <Field>
          <FieldLabel>{extraParam.name}</FieldLabel>
          <Input value={extra} placeholder={extraParam.placeholder} className="font-mono text-sm" onChange={(e) => setExtra(e.target.value)} />
        </Field>
      )}
      <Field>
        <FieldLabel>选择监听器</FieldLabel>
        <Select value={listenerId} onValueChange={setListenerId}>
          <SelectTrigger>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {listeners.map((l) => (
              <SelectItem key={l.Id} value={String(l.Id)}>
                #{l.Id} {l.Remark || l.Mode} ({l.Mode})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button
        className="h-10 w-fit px-6"
        disabled={!listenerId}
        onClick={() => {
          const params: Record<string, string> = { arch: arch.replace(/^.*?_/, ""), id: listenerId };
          if (extraParam && extra) params[extraParam.name] = extra;
          download(server.id, kind, params);
          toast.info("已发起生成下载");
        }}
      >
        <DownloadIcon className="size-4" /> 生成下载
      </Button>
    </FieldGroup>
  );
}

function UpxProxyForm({
  server,
  kind,
  hasId,
  listeners,
  allowLoader,
}: {
  server: VshellServer;
  kind: string;
  hasId?: boolean;
  listeners: ListenerBrief[];
  allowLoader?: boolean;
}) {
  const [arch, setArch] = React.useState("windows_amd64");
  const [listenerId, setListenerId] = React.useState("");
  const [upx, setUpx] = React.useState(false);
  const [proxy, setProxy] = React.useState("");
  return (
    <FieldGroup className="max-w-3xl gap-5">
      <Field>
        <FieldLabel>客户端类型</FieldLabel>
        <div className="grid w-fit grid-cols-4 gap-2">
          {ARCHES.map((a) => (
            <Button key={a} size="sm" variant={arch === a ? "default" : "outline"} className="h-9 w-36 justify-start font-mono text-sm" onClick={() => setArch(a)}>
              {a}
            </Button>
          ))}
        </div>
      </Field>
      {hasId && (
        <Field>
          <FieldLabel>选择监听器</FieldLabel>
          <Select value={listenerId} onValueChange={setListenerId}>
            <SelectTrigger>
              <SelectValue placeholder="请选择" />
            </SelectTrigger>
            <SelectContent>
              {listeners.map((l) => (
                <SelectItem key={l.Id} value={String(l.Id)}>
                  #{l.Id} {l.Remark || l.Mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel>UPX 压缩</FieldLabel>
          <div className="flex h-9 items-center gap-2">
            <Switch checked={upx} onCheckedChange={setUpx} /> <span className="text-muted-foreground text-sm">{upx ? "开启" : "关闭"}</span>
          </div>
        </Field>
        <Field>
          <FieldLabel>使用代理(留空不使用)</FieldLabel>
          <Input value={proxy} placeholder="socks5://1.2.3.4:1080" className="font-mono text-sm" onChange={(e) => setProxy(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          className="h-10 px-6"
          disabled={hasId && !listenerId}
          onClick={() =>
            download(server.id, kind, {
              id: listenerId,
              arch: arch.replace(/^.*?_/, ""),
              upx: upx ? "true" : "false",
              proxy,
            })
          }
        >
          <DownloadIcon className="size-4" /> 生成下载
        </Button>
        {allowLoader && (
          <Button variant="outline" onClick={() => download(server.id, kind, { arch: "loader" })}>
            <DownloadIcon className="size-4" /> 下载 loader.go
          </Button>
        )}
      </div>
    </FieldGroup>
  );
}

function ListenForm({ server, kind, ebpf }: { server: VshellServer; kind: string; ebpf?: boolean }) {
  const [arch, setArch] = React.useState("windows_amd64");
  const [tp, setTp] = React.useState("tcp");
  const [host, setHost] = React.useState("0.0.0.0");
  const [port, setPort] = React.useState("");
  const [vkey, setVkey] = React.useState("qwe123qwe");
  const [salt, setSalt] = React.useState("qwe123qwe");
  const [upx, setUpx] = React.useState(false);
  return (
    <FieldGroup className="max-w-3xl gap-5">
      <Field>
        <FieldLabel>客户端类型</FieldLabel>
        <div className="grid w-fit grid-cols-4 gap-2">
          {(ebpf ? ARCHES.filter((a) => a.startsWith("linux")) : ARCHES).map((a) => (
            <Button key={a} size="sm" variant={arch === a ? "default" : "outline"} className="h-9 w-36 justify-start font-mono text-sm" onClick={() => setArch(a)}>
              {a}
            </Button>
          ))}
        </div>
      </Field>
      <Field>
        <FieldLabel>连接方式</FieldLabel>
        <Select value={tp} onValueChange={setTp}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tcp">TCP</SelectItem>
            <SelectItem value="kcp">KCP/UDP</SelectItem>
            <SelectItem value="ws">WebSocket</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel>IP 或域名</FieldLabel>
          <Input className="h-9 font-mono text-sm" value={host} onChange={(e) => setHost(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>端口</FieldLabel>
          <Input className="h-9 font-mono text-sm" value={port} placeholder="49319" onChange={(e) => setPort(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Vkey</FieldLabel>
          <Input className="h-9 font-mono text-sm" value={vkey} onChange={(e) => setVkey(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>流量加密盐</FieldLabel>
          <Input className="h-9 font-mono text-sm" value={salt} onChange={(e) => setSalt(e.target.value)} />
        </Field>
      </div>
      <Field>
        <FieldLabel>UPX 压缩</FieldLabel>
        <div className="flex h-9 items-center gap-2">
          <Switch checked={upx} onCheckedChange={setUpx} /> <span className="text-muted-foreground text-sm">{upx ? "开启" : "关闭"}</span>
        </div>
      </Field>
      <Button
        className="h-10 w-fit px-6"
        disabled={!port}
        onClick={() => {
          const params: Record<string, string> = {
            arch: arch.replace(/^.*?_/, ""),
            tp,
            host,
            port,
            vkey,
            salt,
            upx: upx ? "true" : "false",
          };
          if (ebpf) {
            params.listen = "true";
            params.ebpf = "true";
          }
          download(server.id, kind, params);
          toast.info("已发起生成下载");
        }}
      >
        <DownloadIcon className="size-4" /> 生成下载
      </Button>
    </FieldGroup>
  );
}

// 供外部确认 re-export(监听页在生成页下方提供快捷入口)
export { VshellListenersPage };
