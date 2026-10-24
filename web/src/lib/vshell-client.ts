"use client";

// VShell 调用层:直连优先、ARTEX 代理回落。
//
// 直连模式:站点登记了 direct_base_url(nginx 把 vshell 反代到与 ARTEX 同源的
// 前缀下,并在该 location 注入 vshell 的 Basic 网关凭据)——浏览器直发请求,
// 只带 vshell 的 Token 头(JWT 由 ARTEX /token 端点一次性披露,内存缓存)。
// 大文件/交互延迟不再过 ARTEX 隧道双跳。
// 回落:直连失败(网络/401/CORS)→ 该站点标记 60s 冷却,本次请求走
// ARTEX 代理;401 时刷新一次 vshell token 重试。
import { auth } from "@/lib/auth";

interface Runtime {
  direct: string; // 绝对化后的直连前缀;"" = 未配置
  rawDirect: string;
  token: string;
  tokenExp: number;
  deadUntil: number;
}

const runtimes = new Map<string, Runtime>();
const runtimeLoading = new Map<string, Promise<Runtime>>();

function absolute(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  if (!b) return "";
  if (b.startsWith("/")) return `${location.origin}${b}`;
  return b;
}

function authHeaders(): Record<string, string> {
  const t = auth.getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function loadRuntime(serverId: string): Promise<Runtime> {
  const r = await fetch(`/api/shell/vshell/${serverId}/token`, { headers: authHeaders() });
  const payload = (await r.json().catch(() => ({}))) as {
    token?: string;
    direct_base_url?: string;
    error?: string;
  };
  if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
  const direct = absolute(payload.direct_base_url ?? "");
  // vshell JWT 12h——解析 exp,取不到按 6h 兜底
  let tokenExp = Date.now() + 6 * 3600e3;
  try {
    const seg = (payload.token ?? "").split(".")[1];
    if (seg) {
      const claims = JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
      if (Number(claims.exp) > 0) tokenExp = Number(claims.exp) * 1000;
    }
  } catch {
    /* keep fallback */
  }
  const rt: Runtime = { direct, rawDirect: payload.direct_base_url ?? "", token: payload.token ?? "", tokenExp, deadUntil: 0 };
  runtimes.set(serverId, rt);
  return rt;
}

async function getRuntime(serverId: string): Promise<Runtime> {
  const hit = runtimes.get(serverId);
  if (hit) return hit;
  const inflight = runtimeLoading.get(serverId);
  if (inflight) return inflight;
  const p = loadRuntime(serverId).finally(() => runtimeLoading.delete(serverId));
  runtimeLoading.set(serverId, p);
  return p;
}

async function refreshToken(serverId: string): Promise<Runtime> {
  runtimes.delete(serverId);
  return getRuntime(serverId);
}

/** 站点当前直连配置(未配置直连时 direct 为空串)。 */
export async function vshellRuntime(serverId: string): Promise<{ direct: string; rawDirect: string }> {
  const rt = await getRuntime(serverId);
  return { direct: rt.direct, rawDirect: rt.rawDirect };
}

/** 清除缓存(站点编辑后)。 */
export function dropVshellRuntime(serverId: string) {
  runtimes.delete(serverId);
}

// ---------------------------------------------------------------- API 调用

async function directOnce(rt: Runtime, serverId: string, endpoint: string, body: unknown): Promise<unknown | null> {
  if (!rt.direct || Date.now() < rt.deadUntil || Date.now() > rt.tokenExp) return null;
  const res = await fetch(`${rt.direct}/api/${endpoint.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Token: rt.token },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 401 || res.status === 403) {
    // Basic 网关拒绝(nginx 未注入)或 token 失效——降温 + 回落
    rt.deadUntil = Date.now() + 60e3;
    return null;
  }
  const j = (await res.json().catch(() => null)) as { code?: number; message?: string; result?: unknown } | null;
  if (!j) {
    rt.deadUntil = Date.now() + 60e3;
    return null;
  }
  if (j.code === 401) {
    await refreshToken(serverId);
    return directOnce(rt, serverId, endpoint, body); // 新 token 重试一次
  }
  if (j.code !== 0) {
    const err = new Error(j.message || `${endpoint} 失败 code ${j.code}`);
    (err as Error & { vshellCode?: number }).vshellCode = j.code;
    throw err;
  }
  return j.result ?? null;
}

/**
 * vshell 业务调用:直连优先,失败/未配置回落 ARTEX 代理。
 * 返回 vshell 信封里的 result。
 */
export async function vshellApi<T = unknown>(serverId: string, endpoint: string, body?: unknown): Promise<T> {
  let rt: Runtime;
  try {
    rt = await getRuntime(serverId);
  } catch {
    rt = { direct: "", rawDirect: "", token: "", tokenExp: 0, deadUntil: 0 };
  }
  if (rt.direct) {
    try {
      const direct = await directOnce(rt, serverId, endpoint, body);
      if (direct !== null) return direct as T;
    } catch (e) {
      // vshell 业务错误(code!=0):直连链路是通的,原样抛,不走代理重放
      if ((e as Error & { vshellCode?: number }).vshellCode !== undefined) throw e;
      rt.deadUntil = Date.now() + 60e3; // 链路问题 → 回落
    }
  }
  const res = await fetch(`/api/shell/vshell/${serverId}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ endpoint, body: body ?? {} }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; result?: unknown };
  if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return (payload.result ?? null) as T;
}

// ---------------------------------------------------------------- WebSocket

/** 交互式终端 WS 地址:直连优先(nginx 注入 Basic + ?token=),回落 ARTEX 代理。 */
export async function vshellTerminalWs(serverId: string, hostId: string): Promise<{ url: string; mode: "direct" | "proxy" }> {
  const artexToken = auth.getToken() ?? "";
  const proxyUrl = `${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}/api/shell/vshell/${serverId}/terminal/ws?host=${encodeURIComponent(hostId)}&token=${encodeURIComponent(artexToken)}`;
  let rt: Runtime;
  try {
    rt = await getRuntime(serverId);
  } catch {
    return { url: proxyUrl, mode: "proxy" };
  }
  if (rt.direct && Date.now() <= rt.tokenExp) {
    return { url: `${rt.direct.replace(/^http/, "ws")}/api/terminal/ws?id=${encodeURIComponent(hostId)}&token=${encodeURIComponent(rt.token)}`, mode: "direct" };
  }
  return { url: proxyUrl, mode: "proxy" };
}

// ---------------------------------------------------------------- 上传/下载

/** multipart 上传:file/upload(webshell 语义)与 runner/upload(插件)共用。 */
export async function vshellUpload(serverId: string, kind: "file" | "runner", form: FormData): Promise<{ ok: boolean; size?: number }> {
  let rt: Runtime;
  try {
    rt = await getRuntime(serverId);
  } catch {
    rt = { direct: "", rawDirect: "", token: "", tokenExp: 0, deadUntil: 0 };
  }
  const send = (base: string, headers: Record<string, string>) =>
    fetch(`${base}/api/${kind}/upload`, { method: "POST", headers, body: form });
  if (rt.direct && Date.now() <= rt.tokenExp && Date.now() >= rt.deadUntil) {
    try {
      const res = await send(rt.direct, { Token: rt.token });
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
        if (j.code === 0) return { ok: true };
        if (j.code !== 401) throw new Error(j.message || `code ${j.code}`);
      }
      rt.deadUntil = Date.now() + 60e3;
    } catch (e) {
      if ((e as Error).message && !(e as TypeError).message?.includes("fetch")) throw e;
      rt.deadUntil = Date.now() + 60e3;
    }
  }
  // 回落:ARTEX 代理
  const proxyPath = kind === "runner" ? `/api/shell/vshell/${serverId}/runner/upload` : `/api/shell/vshell/${serverId}/upload`;
  const res = await fetch(proxyPath, { method: "POST", headers: authHeaders(), body: form });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; size?: number };
  if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return { ok: true, size: payload.size };
}

/** 文件下载(vshell 三步链)直连 Blob 化;失败回落 ARTEX 代理流。用于触发浏览器保存。 */
export async function vshellFileDownload(serverId: string, hostId: string, path: string, name: string): Promise<void> {
  const proxyUrl = `/api/shell/vshell/${serverId}/download?host=${encodeURIComponent(hostId)}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
  let rt: Runtime;
  try {
    rt = await getRuntime(serverId);
  } catch {
    window.open(proxyUrl, "_blank");
    return;
  }
  if (rt.direct && Date.now() <= rt.tokenExp && Date.now() >= rt.deadUntil) {
    try {
      // 三步:downloadtoserver → 轮询进度 → downloadtobrowser(直连)
      await vshellApi(serverId, "file/downloadtoserver", { id: Number(hostId), path, target: name });
      const deadline = Date.now() + 10 * 60e3;
      for (;;) {
        if (Date.now() > deadline) throw new Error("下载超时");
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const p = (await vshellApi(serverId, "file/getdownloadper", { id: Number(hostId), path, target: name })) as { pre?: number } | null;
          if ((p?.pre ?? 0) >= 100) break;
        } catch {
          /* 进度偶发失败不中断 */
        }
      }
      const res = await fetch(`${rt.direct}/api/file/downloadtobrowser?id=${encodeURIComponent(hostId)}&target=${encodeURIComponent(name)}`, { headers: { Token: rt.token } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    } catch {
      rt.deadUntil = Date.now() + 60e3; // 直连失败 → 代理流
    }
  }
  window.open(proxyUrl, "_blank");
}

/** 客户端生成下载:导航类请求无法带 Token 头,统一走 ARTEX 代理(已带 cookie 鉴权)。 */
export function vshellGenerateDownload(serverId: string, kind: string, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  window.open(`/api/shell/vshell/${serverId}/download/${kind}?${q}`, "_blank");
}
