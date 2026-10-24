"use client";

// Shell 管理共享终端:整块黑底终端(输出区 flex 撑满 + 底部内嵌提示符输入行),
// 逐条执行 + 历史(↑/↓)+ 快捷命令 chips。exec 回调由调用方注入。
import * as React from "react";
import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

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
  height = "100%",
  minHeight = 420,
}: {
  exec: (command: string) => Promise<string>;
  quickOS?: "linux" | "windows";
  placeholder?: string;
  /** 终端盒高度(默认撑满父容器;父容器需给定高度或走 flex) */
  height?: string;
  minHeight?: number;
}) {
  const [lines, setLines] = React.useState<TerminalLine[]>([]);
  const [cmd, setCmd] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>([]);
  const [histIdx, setHistIdx] = React.useState(-1);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

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
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {(quickOS === "windows" ? QUICK_WIN : QUICK_LINUX).map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => {
              setCmd(q);
              inputRef.current?.focus();
            }}
            className="hover:bg-accent rounded border px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400"
          >
            {q}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLines([])}
          title="清屏"
          className="hover:bg-accent text-muted-foreground ml-auto rounded border p-1"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-col overflow-hidden rounded-md border border-zinc-800 bg-[#1e1f22]"
        style={{ height, minHeight }}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[13px] leading-6">
          {lines.length === 0 && !busy && <div className="text-zinc-500"># {placeholder}</div>}
          {lines.map((l, i) => (
            <div key={i} className="mb-2">
              <div className="text-emerald-400">
                <span className="text-zinc-500">$ </span>
                {l.cmd}
              </div>
              <pre className={`whitespace-pre-wrap break-all ${l.err ? "text-red-400" : "text-zinc-200"}`}>{l.out || "(无输出)"}</pre>
            </div>
          ))}
          {busy && <div className="animate-pulse text-amber-400">… 执行中</div>}
          <div ref={bottomRef} />
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2 font-mono text-[13px]">
          <span className="shrink-0 text-emerald-400">$</span>
          <input
            ref={inputRef}
            value={cmd}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-zinc-100 caret-emerald-400 outline-none placeholder:text-zinc-600"
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
          {busy && <span className="shrink-0 text-amber-400/80 text-xs">运行中</span>}
        </div>
      </div>
    </div>
  );
}
