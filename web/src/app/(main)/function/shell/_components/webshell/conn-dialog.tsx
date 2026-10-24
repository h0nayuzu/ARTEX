"use client";

// webshell 连接 新增/编辑对话框:支持「自动识别」(探测链逐通道试)与手动选协议。
import * as React from "react";
import { RadarIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { WebshellConn, WebshellDetectResult, WebshellProtocolMeta } from "@/lib/types";

export function WebshellConnDialog({
  open,
  onOpenChange,
  conn,
  protocols,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conn: WebshellConn | null;
  protocols: WebshellProtocolMeta[];
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [url, setURL] = React.useState("");
  const [protocol, setProtocol] = React.useState("auto");
  const [kind, setKind] = React.useState("file");
  const [passParam, setPassParam] = React.useState("pass");
  const [cmdParam, setCmdParam] = React.useState("cmd");
  const [password, setPassword] = React.useState("");
  const [secretKey, setSecretKey] = React.useState("");
  const [method, setMethod] = React.useState("post");
  const [encoding, setEncoding] = React.useState("auto");
  const [os, setOS] = React.useState("auto");
  const [timeoutMs, setTimeoutMs] = React.useState(20000);
  const [remark, setRemark] = React.useState("");
  const [detecting, setDetecting] = React.useState(false);
  const [detectResult, setDetectResult] = React.useState<WebshellDetectResult | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(conn?.name ?? "");
      setURL(conn?.url ?? "");
      setProtocol(conn?.protocol ?? "auto");
      setKind(conn?.kind ?? "file");
      setPassParam(conn?.pass_param ?? "pass");
      setCmdParam(conn?.cmd_param ?? "cmd");
      setPassword("");
      setSecretKey(conn?.secret_key ?? "");
      setMethod(conn?.method ?? "post");
      setEncoding(conn?.encoding ?? "auto");
      setOS(conn?.os ?? "auto");
      setTimeoutMs(conn?.timeout_ms ?? 20000);
      setRemark(conn?.remark ?? "");
      setDetectResult(null);
    }
  }, [open, conn]);

  const protoMeta = protocols.find((p) => p.id === protocol);

  const runDetect = async () => {
    if (!url.trim()) {
      toast.error("先填马地址(URL)");
      return;
    }
    setDetecting(true);
    setDetectResult(null);
    try {
      const r = await api.webshellDetect({ url: url.trim(), password, secret_key: secretKey, pass_param: passParam, cmd_param: cmdParam, method });
      setDetectResult(r);
      if (r.hit && r.protocol) {
        setProtocol(r.protocol);
        if (r.kind_hint) setKind(r.kind_hint);
        if (r.os && r.os !== "auto") setOS(r.os);
        toast.success(`识别命中:${r.protocol}`);
      } else {
        toast.error(r.error || "未命中任何通道");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "识别失败");
    } finally {
      setDetecting(false);
    }
  };

  const save = async () => {
    if (!url.trim()) {
      toast.error("URL 不能为空");
      return;
    }
    if (protocol === "auto") {
      toast.error("请选择协议,或先跑一次自动识别");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name,
        url: url.trim(),
        protocol,
        kind,
        pass_param: passParam,
        cmd_param: cmdParam,
        secret_key: secretKey,
        method,
        encoding,
        os,
        timeout_ms: timeoutMs,
        remark,
      };
      if (password) body.password = password;
      if (conn) await api.webshellUpdate(conn.id, body);
      else await api.webshellCreate(body);
      toast.success(conn ? "连接已更新" : "连接已登记");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{conn ? "编辑连接" : "登记 webshell 连接"}</DialogTitle>
          <DialogDescription>
            填马地址与凭据后可「自动识别」(dsh-aes → 内存马 → 一句话 → 冰蝎 → 哥斯拉 逐通道探测);或手动指定协议。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>名称</FieldLabel>
              <Input value={name} placeholder="如:目标站 uploads 马" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>形态</FieldLabel>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">文件马</SelectItem>
                  <SelectItem value="mem">内存马</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel>马地址(URL)*</FieldLabel>
            <Input value={url} className="font-mono text-sm" placeholder="http://target/uploads/shell.php" onChange={(e) => setURL(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>协议</FieldLabel>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动识别…</SelectItem>
                  {protocols.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>OS</FieldLabel>
              <Select value={os} onValueChange={setOS}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动探测</SelectItem>
                  <SelectItem value="linux">linux</SelectItem>
                  <SelectItem value="windows">windows</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {protoMeta && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{protoMeta.note}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>连接密码 {conn && conn.password_set ? `(已存 ${conn.password_tail},留空保持)` : ""}</FieldLabel>
              <Input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>密钥源(哥斯拉用)</FieldLabel>
              <Input value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field>
              <FieldLabel>pass 参数</FieldLabel>
              <Input value={passParam} onChange={(e) => setPassParam(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>cmd 参数</FieldLabel>
              <Input value={cmdParam} onChange={(e) => setCmdParam(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>方法</FieldLabel>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="post">POST</SelectItem>
                  <SelectItem value="get">GET</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>编码</FieldLabel>
              <Select value={encoding} onValueChange={setEncoding}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["auto", "utf-8", "gbk", "gb18030", "big5", "shift_jis", "euc-jp"].map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>超时(ms)</FieldLabel>
              <Input type="number" value={timeoutMs} min={3000} max={120000} onChange={(e) => setTimeoutMs(Number(e.target.value) || 20000)} />
            </Field>
            <Field>
              <FieldLabel>备注</FieldLabel>
              <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
            </Field>
          </div>
          {detectResult && (
            <div className="rounded-md border p-2 text-sm">
              {detectResult.hit ? (
                <>
                  <p>
                    命中 <Badge>{detectResult.protocol}</Badge> 形态:{detectResult.kind_hint === "mem" ? "内存马" : "文件马"} · OS:
                    {detectResult.os} · 语言:{detectResult.shell_lang}
                  </p>
                  {detectResult.basic_info && (
                    <pre className="mt-1 max-h-32 overflow-auto text-[10px] text-muted-foreground">
                      {JSON.stringify(detectResult.basic_info, null, 2)}
                    </pre>
                  )}
                </>
              ) : (
                <>
                  <p className="text-destructive">{detectResult.error}</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {detectResult.attempts.map((a, i) => (
                      <li key={i}>
                        {a.protocol}: {a.error}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </FieldGroup>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={detecting} onClick={() => void runDetect()}>
            <RadarIcon className={`h-4 w-4 ${detecting ? "animate-pulse" : ""}`} /> {detecting ? "识别中…" : "自动识别"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
