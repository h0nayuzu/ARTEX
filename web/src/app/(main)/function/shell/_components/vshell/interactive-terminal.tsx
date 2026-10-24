"use client";

// 真·交互式终端:xterm.js ↔ vshell /api/terminal/ws。
// WS 地址由 vshell-client 解析:直连优先(nginx 注入 Basic + ?token=vshellJWT),
// 直连建立失败(未收到任何数据即断开)自动降级 ARTEX 代理重连一次。
import * as React from "react";

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { vshellTerminalWs } from "@/lib/vshell-client";

export function InteractiveTerminal({
  serverId,
  hostId,
  minHeight = 420,
}: {
  serverId: string;
  hostId: string;
  minHeight?: number;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [status, setStatus] = React.useState<"connecting" | "live" | "closed">("connecting");
  const [mode, setMode] = React.useState<"direct" | "proxy">("direct");

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      lineHeight: 1.25,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { foreground: "#e4e4e7", background: "#1e1f22", cursor: "#34d399", selectionBackground: "#3f3f46" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box);
    term.writeln("\x1b[90m—— 交互式终端(vshell) 连接中…\x1b[0m");

    let active: WebSocket | null = null;
    let ro: ResizeObserver | null = null;
    let disposed = false;

    const attach = (socket: WebSocket, m: "direct" | "proxy") => {
      active = socket;
      setMode(m);
      socket.binaryType = "arraybuffer";
      let gotData = false;
      socket.onopen = () => {
        if (disposed) return;
        setStatus("live");
        term.reset();
        fit.fit();
        term.focus();
      };
      socket.onmessage = (ev) => {
        gotData = true;
        if (typeof ev.data === "string") term.write(ev.data);
        else term.write(new Uint8Array(ev.data));
      };
      socket.onclose = () => {
        if (disposed) return;
        setStatus("closed");
        // 直连链路失败(nginx 未注入 Basic/CORS/可达性)→ 代理降级重连一次
        if (m === "direct" && !gotData) {
          term.writeln("\r\n\x1b[90m—— 直连不可用,切换 ARTEX 代理…\x1b[0m");
          const fallback = `${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}/api/shell/vshell/${serverId}/terminal/ws?host=${encodeURIComponent(hostId)}&token=${encodeURIComponent(localStorage.getItem("artex_token") ?? "")}`;
          attach(new WebSocket(fallback), "proxy");
          return;
        }
        term.writeln("\r\n\x1b[90m—— 连接已断开(客户端离线或超时)\x1b[0m");
      };
      term.onData((d) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(d);
      });
    };

    void (async () => {
      const { url, mode: m } = await vshellTerminalWs(serverId, hostId);
      if (disposed) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        setStatus("closed");
        term.writeln("\r\n\x1b[31m—— 连接创建失败\x1b[0m");
        return;
      }
      attach(socket, m);
      ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* 容器隐藏时 fit 会抛 */
        }
      });
      ro.observe(box);
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      active?.close();
      term.dispose();
    };
  }, [serverId, hostId]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-[#1e1f22] p-1" style={{ minHeight }}>
      <div ref={boxRef} className="h-full w-full" />
      <span
        className={`absolute top-2 right-3 rounded-full px-2 py-0.5 text-[10px] font-medium ${
          status === "live"
            ? mode === "direct"
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-sky-500/15 text-sky-500"
            : status === "connecting"
              ? "bg-amber-500/15 text-amber-500"
              : "bg-zinc-500/15 text-zinc-400"
        }`}
        title={mode === "direct" ? "直连 vshell(不经 ARTEX)" : "经 ARTEX 代理"}
      >
        {status === "live" ? (mode === "direct" ? "● 已连接·直连" : "● 已连接·代理") : status === "connecting" ? "连接中" : "已断开"}
      </span>
    </div>
  );
}
