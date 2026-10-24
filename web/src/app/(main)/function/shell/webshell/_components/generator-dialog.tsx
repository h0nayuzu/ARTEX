"use client";

// webshell 生成器:11 种产物模板(PHP 一句话/基础/自研加密 v1v2/冰蝎/哥斯拉、
// JSP、ASPX、ASP)——生成入库 + 预览 + 下载 + 历史清单。
import * as React from "react";
import { DownloadIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { WebshellGenKind, WebshellGeneration } from "@/lib/types";

export function WebshellGeneratorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [kinds, setKinds] = React.useState<WebshellGenKind[]>([]);
  const [history, setHistory] = React.useState<WebshellGeneration[]>([]);
  const [kind, setKind] = React.useState("php-oneliner");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passParam, setPassParam] = React.useState("pass");
  const [cmdParam, setCmdParam] = React.useState("cmd");
  const [secretKey, setSecretKey] = React.useState("");
  const [product, setProduct] = React.useState<{ name: string; content: string; meta: { password: string; conn_hint: string } } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadHistory = React.useCallback(async () => {
    try {
      setHistory(await api.webshellGenerations());
    } catch {
      /* 历史加载失败不阻塞 */
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      api.webshellGenKinds().then(setKinds).catch(() => {});
      void loadHistory();
    }
  }, [open, loadHistory]);

  const generate = async () => {
    setBusy(true);
    setProduct(null);
    try {
      const r = await api.webshellGenerate({ kind, name, password, pass_param: passParam, cmd_param: cmdParam, secret_key: secretKey });
      setProduct(r);
      await loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Webshell 生成器</DialogTitle>
          <DialogDescription>
            面向「快速起一个能用的马」;免杀变体不在生成器职责内(免杀对抗自产)。产物入库,可反复下载。
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FieldGroup>
            <Field>
              <FieldLabel>类型</FieldLabel>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k.kind} value={k.kind}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>产物名(留空自动)</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field>
                <FieldLabel>口令(留空随机)</FieldLabel>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>pass 参数</FieldLabel>
                <Input value={passParam} onChange={(e) => setPassParam(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>cmd 参数</FieldLabel>
                <Input value={cmdParam} onChange={(e) => setCmdParam(e.target.value)} />
              </Field>
            </div>
            {["php-godzilla", "jsp-godzilla", "aspx-godzilla"].includes(kind) && (
              <Field>
                <FieldLabel>密钥源(哥斯拉;留空=口令)</FieldLabel>
                <Input value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
              </Field>
            )}
            <Button size="sm" disabled={busy} onClick={() => void generate()}>
              <SparklesIcon className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} /> {busy ? "生成中…" : "生成"}
            </Button>
            {product && (
              <div className="rounded-md border p-2 text-xs">
                <p>
                  ✅ <b>{product.name}</b> — 口令 <code>{product.meta.password}</code>
                </p>
                <p className="mt-1 text-muted-foreground">{product.meta.conn_hint}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    const blob = new Blob([product.content], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = product.name;
                    a.click();
                  }}
                >
                  <DownloadIcon className="h-4 w-4" /> 下载
                </Button>
              </div>
            )}
          </FieldGroup>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">历史产物</p>
            <div className="max-h-72 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead className="w-20">类型</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-4 text-center text-xs text-muted-foreground">
                        暂无
                      </TableCell>
                    </TableRow>
                  )}
                  {history.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-mono text-xs">
                        {g.name}.{g.ext}
                      </TableCell>
                      <TableCell className="text-xs">{g.kind}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => window.open(`/api/shell/webshell/generations/${g.id}/download`, "_blank")}>
                            <DownloadIcon className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-destructive"
                            onClick={() => void api.webshellGenerationDelete(g.id).then(() => loadHistory())}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
