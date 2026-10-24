"use client";

// Shell 管理共享的行缓冲终端:逐条执行 + 历史回显 + 快捷命令。
// webshell(exec)与 vshell(exec)共用,exec 回调由调用方注入。
import * as React from "react";
import { PlayIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface TerminalLine {
  cmd: string;
  out: string;
  err?: boolean;
  ts: number;
}

const QUICK_LINUX = ["id", "whoami", "uname -a", "ifconfig", "ps aux", "netstat -antp", "crontab -l", "ls -la /"];
const QUICK_WIN = ["whoami", "ver", "ipconfig /all", "tasklist", "net user", "netstat -ano"];

export function ShellTerminal({
  exec,
  quickOS = "linux",
  placeholder = "输入命令,回车执行",
  height = "420px",
}: {
  exec: (command: string) => Promise<string>;
  quickOS?: "linux" | "windows";
  placeholder?: string;
  height?: string;
}) {
  const [lines, setLines] = React.useState<TerminalLine[]>([]);
  const [cmd, setCmd] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>([]);
  const [histIdx, setHistIdx] = React.useState(-1);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, busy]);

  const run = async (command: string) => {
    const c = command.trim();
    if (!c || busy) return;
    setHistory((h) => [c, ...h].slice(0, 100));
    setHistIdx(-1);
    setCmd("");
    setBusy(true);
    try {
      const out = await exec(c);
      setLines((ls) => [...ls, { cmd: c, out, ts: Date.now() }]);
    } catch (e) {
      setLines((ls) => [...ls, { cmd: c, out: e instanceof Error ? e.message : String(e), err: true, ts: Date.now() }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {(quickOS === "windows" ? QUICK_WIN : QUICK_LINUX).map((q) => (
          <Button
            key={q}
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 font-mono text-[11px]"
            disabled={busy}
            onClick={() => setCmd(q)}
          >
            {q}
          </Button>
        ))}
      </div>
      <div className="overflow-auto rounded-md border bg-black p-3 font-mono text-xs leading-5" style={{ maxHeight: height }}>
        {lines.length === 0 && <div className="text-zinc-500">暂无输出——输入命令开始执行。</div>}
        {lines.map((l, i) => (
          <div key={i} className="mb-2">
            <div className="text-emerald-400">$ {l.cmd}</div>
            <pre className={`whitespace-pre-wrap break-all ${l.err ? "text-red-400" : "text-zinc-200"}`}>{l.out || "(无输出)"}</pre>
          </div>
        ))}
        {busy && <div className="animate-pulse text-amber-400">执行中…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <Input
          value={cmd}
          placeholder={placeholder}
          className="font-mono text-xs"
          disabled={busy}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run(cmd);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              const next = Math.min(histIdx + 1, history.length - 1);
              if (next >= 0) {
                setHistIdx(next);
                setCmd(history[next]);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const next = histIdx - 1;
              setHistIdx(next);
              setCmd(next >= 0 ? history[next] : "");
            }
          }}
        />
        <Button type="button" size="icon" disabled={busy || !cmd.trim()} onClick={() => run(cmd)}>
          <PlayIcon className="h-4 w-4" />
        </Button>
        <Button type="button" size="icon" variant="outline" title="清屏" onClick={() => setLines([])}>
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
