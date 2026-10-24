"use client";

// 真·交互式终端:xterm.js ↔ ARTEX WS 代理 ↔ vshell /api/terminal/ws。
// 帧原样透传(AttachAddon 协议:入站 write,出站 send 字符串)。
import * as React from "react";

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

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

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      lineHeight: 1.25,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { foreground: "#e4e4e7", background: "#1e1f22", cursor: "#34d399", selectionBackground: "#3f3f46" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box);
    term.writeln("\x1b[90m—— 交互式终端(vshell) 连接中…\x1b[0m");

    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    const token = localStorage.getItem("artex_token") ?? "";
    const socket = new WebSocket(`${proto}${location.host}/api/shell/vshell/${serverId}/terminal/ws?host=${encodeURIComponent(hostId)}&token=${encodeURIComponent(token)}`);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      setStatus("live");
      term.reset();
      fit.fit();
      term.focus();
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data === "string") term.write(ev.data);
      else term.write(new Uint8Array(ev.data));
    };
    socket.onclose = () => {
      setStatus("closed");
      term.writeln("\r\n\x1b[90m—— 连接已断开(客户端离线或超时)\x1b[0m");
    };
    socket.onerror = () => {
      if (status !== "live") term.writeln("\x1b[31m—— 连接失败:检查客户端是否在线\x1b[0m");
    };
    term.onData((d) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(d);
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* 容器隐藏时 fit 会抛 */
      }
    });
    ro.observe(box);

    return () => {
      ro.disconnect();
      socket.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, hostId]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-[#1e1f22] p-1" style={{ minHeight }}>
      <div ref={boxRef} className="h-full w-full" />
      <span
        className={`absolute top-2 right-3 rounded-full px-2 py-0.5 text-[10px] font-medium ${
          status === "live" ? "bg-emerald-500/15 text-emerald-500" : status === "connecting" ? "bg-amber-500/15 text-amber-500" : "bg-zinc-500/15 text-zinc-400"
        }`}
      >
        {status === "live" ? "● 已连接" : status === "connecting" ? "连接中" : "已断开"}
      </span>
    </div>
  );
}
