"use client";

import * as React from "react";

import {
  CheckIcon,
  GitBranchIcon,
  InfoIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type {
  AssetInterceptKind,
  AssetInterceptRule,
  LLMProfile,
  Task,
  TaskConstraint,
  TaskGoal,
  TaskScopeRow,
} from "@/lib/types";

// 项目设置区：渲染在总览页底部,只放"属于这个项目"的配置——任务信息（改名/
// 置顶）、目标管理、操作约束、任务级资产拦截、测试范围。上方总览只看运行状态。

// 测试范围一条的显示值：域名 / 网段 / 公司。
function scopeValue(row: TaskScopeRow): string {
  if (row.value) return row.value;
  if (row.domain) return row.domain;
  if (row.net) return row.net;
  if (row.company_id) return row.company_name?.trim() ? row.company_name : `企业 #${row.company_id}`;
  return "—";
}

const SCOPE_KIND_LABELS: Record<TaskScopeRow["kind"], string> = {
  company: "公司",
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  cidr: "网段",
  icp: "ICP",
  keyword: "关键词",
};

const SCOPE_SOURCE_LABELS: Record<TaskScopeRow["source"], string> = {
  auto: "自动",
  agent: "Agent",
  manual: "手动",
};

export function TaskSettingsSection({ taskId }: { taskId: string }) {
  // 任务信息（改名 / 置顶）。
  const [task, setTask] = React.useState<Task | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  const [nameBusy, setNameBusy] = React.useState(false);
  const [nameErr, setNameErr] = React.useState("");

  // Worker 并发（本任务）：覆盖全局 workers 设置。
  const [globalWorkers, setGlobalWorkers] = React.useState<number>(3);
  const [workersMode, setWorkersMode] = React.useState<"follow" | "override">("follow");
  const [workersDraft, setWorkersDraft] = React.useState("");
  const [workersBusy, setWorkersBusy] = React.useState(false);
  const [workersErr, setWorkersErr] = React.useState("");

  // Worker LLM 分配（分布式调度）。
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [planRows, setPlanRows] = React.useState<{ profile_id: number; slots: number }[]>([]);
  const [planBusy, setPlanBusy] = React.useState(false);
  const [planErr, setPlanErr] = React.useState("");

  const loadTask = React.useCallback(async () => {
    try {
      const t = await api.task(taskId);
      setTask(t);
      setNameDraft(t.name ?? "");
      setWorkersMode(t.workers_override != null && t.workers_override > 0 ? "override" : "follow");
      setWorkersDraft(t.workers_override != null && t.workers_override > 0 ? String(t.workers_override) : "");
      setPlanRows((t.worker_llm_plan ?? []).map((e) => ({ profile_id: Number(e.profile_id), slots: Number(e.slots) })));
    } catch {
      // 忽略：瞬时错误，下次操作后重试
    }
  }, [taskId]);

  React.useEffect(() => {
    void loadTask();
    api
      .settings()
      .then((s) => setGlobalWorkers(Number(s.workers) || 3))
      .catch(() => {});
    api
      .llmProfiles()
      .then(setProfiles)
      .catch(() => {});
  }, [loadTask]);

  const effectiveWorkers =
    task?.workers_override != null && task.workers_override > 0 ? task.workers_override : globalWorkers;

  const saveWorkers = async () => {
    let n = -1; // 跟随全局
    if (workersMode === "override") {
      const v = Number(workersDraft);
      if (!Number.isInteger(v) || v < 1) {
        setWorkersErr("并发数必须是 >=1 的整数");
        return;
      }
      n = v;
    }
    setWorkersBusy(true);
    setWorkersErr("");
    try {
      await api.updateTask(taskId, { workers: n });
      await loadTask();
    } catch (e) {
      setWorkersErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setWorkersBusy(false);
    }
  };

  const savePlan = async (rows: { profile_id: number; slots: number }[] | null) => {
    setPlanBusy(true);
    setPlanErr("");
    try {
      // null=清空计划(发空数组),否则发行列表
      await api.updateTask(taskId, { worker_llm_plan: rows ?? [] });
      await loadTask();
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPlanBusy(false);
    }
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    setNameBusy(true);
    setNameErr("");
    try {
      const t = await api.updateTask(taskId, { name });
      setTask((prev) => (prev ? { ...prev, ...t } : t));
    } catch (e) {
      setNameErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setNameBusy(false);
    }
  };

  const togglePinned = async () => {
    const next = !task?.pinned;
    setTask((prev) => (prev ? { ...prev, pinned: next } : prev));
    try {
      const t = await api.updateTask(taskId, { pinned: next });
      setTask((prev) => (prev ? { ...prev, ...t } : t));
    } catch {
      await loadTask(); // 失败还原
    }
  };

  // 目标管理：查看/新增/修改/删除本任务的探索目标。
  const [goals, setGoals] = React.useState<TaskGoal[]>([]);
  const [goalText, setGoalText] = React.useState("");
  const [goalVuln, setGoalVuln] = React.useState("");
  const [goalBusy, setGoalBusy] = React.useState(false);
  const [goalErr, setGoalErr] = React.useState("");
  const [editingGoalId, setEditingGoalId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [editVuln, setEditVuln] = React.useState("");

  const loadGoals = React.useCallback(async () => {
    try {
      const resp = await api.taskGoals(taskId);
      setGoals(resp.goals);
    } catch {
      // 忽略：瞬时错误，下次轮询重试
    }
  }, [taskId]);

  React.useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  const addGoal = async () => {
    const text = goalText.trim();
    if (!text) return;
    setGoalBusy(true);
    setGoalErr("");
    try {
      await api.addGoal(taskId, text, goalVuln.trim() || undefined);
      setGoalText("");
      setGoalVuln("");
      await loadGoals();
    } catch (e) {
      setGoalErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setGoalBusy(false);
    }
  };

  const startEditGoal = (g: TaskGoal) => {
    setEditingGoalId(g.id);
    setEditText(g.text);
    setEditVuln(g.vulnclass ?? "");
  };

  const cancelEditGoal = () => {
    setEditingGoalId(null);
    setEditText("");
    setEditVuln("");
  };

  const saveEditGoal = async (g: TaskGoal) => {
    const text = editText.trim();
    if (!text) return;
    setGoalBusy(true);
    setGoalErr("");
    try {
      await api.updateGoal(taskId, g.id, text, editVuln.trim() || undefined);
      cancelEditGoal();
      await loadGoals();
    } catch (e) {
      setGoalErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setGoalBusy(false);
    }
  };

  const removeGoal = async (g: TaskGoal) => {
    setGoals((prev) => prev.filter((x) => x.id !== g.id));
    try {
      await api.deleteGoal(taskId, g.id);
    } catch {
      await loadGoals(); // 删除失败：重新拉取还原
    }
  };

  // 操作约束：allow=允许 / deny=禁止。
  const [constraints, setConstraints] = React.useState<TaskConstraint[]>([]);
  const [conText, setConText] = React.useState("");
  const [conKind, setConKind] = React.useState<TaskConstraint["kind"]>("deny");
  const [conBusy, setConBusy] = React.useState(false);
  const [conErr, setConErr] = React.useState("");
  const [editingConId, setEditingConId] = React.useState<string | null>(null);
  const [editConText, setEditConText] = React.useState("");
  const [editConKind, setEditConKind] = React.useState<TaskConstraint["kind"]>("deny");

  const loadConstraints = React.useCallback(async () => {
    try {
      const resp = await api.taskConstraints(taskId);
      setConstraints(resp.constraints);
    } catch {
      // 忽略：瞬时错误，下次轮询重试
    }
  }, [taskId]);

  React.useEffect(() => {
    void loadConstraints();
  }, [loadConstraints]);

  const addConstraint = async () => {
    const text = conText.trim();
    if (!text) return;
    setConBusy(true);
    setConErr("");
    try {
      await api.addConstraint(taskId, text, conKind);
      setConText("");
      await loadConstraints();
    } catch (e) {
      setConErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setConBusy(false);
    }
  };

  const startEditConstraint = (c: TaskConstraint) => {
    setEditingConId(c.id);
    setEditConText(c.text);
    setEditConKind(c.kind);
  };

  const cancelEditConstraint = () => {
    setEditingConId(null);
    setEditConText("");
    setEditConKind("deny");
  };

  const saveEditConstraint = async (c: TaskConstraint) => {
    const text = editConText.trim();
    if (!text) return;
    setConBusy(true);
    setConErr("");
    try {
      await api.updateConstraint(taskId, c.id, text, editConKind);
      cancelEditConstraint();
      await loadConstraints();
    } catch (e) {
      setConErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setConBusy(false);
    }
  };

  const removeConstraint = async (c: TaskConstraint) => {
    setConstraints((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await api.deleteConstraint(taskId, c.id);
    } catch {
      await loadConstraints(); // 删除失败：重新拉取还原
    }
  };

  // 测试范围：覆盖度分母 + 授权边界，可手动增删。
  const [scope, setScope] = React.useState<TaskScopeRow[]>([]);
  const [scopeKind, setScopeKind] = React.useState<TaskScopeRow["kind"]>("root_domain");
  const [scopeValueInput, setScopeValueInput] = React.useState("");
  const [scopeBusy, setScopeBusy] = React.useState(false);
  const [scopeErr, setScopeErr] = React.useState("");
  // 测试范围分页：默认 10 条/页，可选 10/50/100——范围条数多时不再整页拉长。
  const [scopePage, setScopePage] = React.useState(1);
  const [scopePageSize, setScopePageSize] = React.useState(10);

  const loadScope = React.useCallback(async () => {
    try {
      const resp = await api.taskScope(taskId);
      setScope(resp.scope);
    } catch {
      // 忽略：无 asset store 时接口 503，范围卡片自然为空
    }
  }, [taskId]);

  React.useEffect(() => {
    void loadScope();
  }, [loadScope]);

  const addScope = async () => {
    const value = scopeValueInput.trim();
    if (!value) return;
    setScopeBusy(true);
    setScopeErr("");
    try {
      await api.addTaskScope(taskId, scopeKind, value);
      setScopeValueInput("");
      await loadScope();
    } catch (e) {
      setScopeErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setScopeBusy(false);
    }
  };

  const removeScope = async (row: TaskScopeRow) => {
    setScope((prev) => prev.filter((s) => s.id !== row.id));
    try {
      await api.deleteTaskScope(taskId, row.id);
    } catch {
      await loadScope(); // 删除失败：重新拉取还原
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Worker 并发（本任务）：默认跟随全局，可单独覆盖；保存后立即热生效。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersIcon className="size-4 text-primary" /> Worker 并发（本任务）
          </CardTitle>
          <CardDescription>
            默认跟随全局设置（当前 {globalWorkers}）；单独设置后只对本任务生效。保存后立即生效：扩容立即启动新
            worker，缩减时正在执行的意图跑完后该 worker 才退出。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              value={workersMode}
              onChange={(e) => setWorkersMode(e.target.value as "follow" | "override")}
            >
              <NativeSelectOption value="follow">跟随全局（当前 {globalWorkers}）</NativeSelectOption>
              <NativeSelectOption value="override">本任务单独设置</NativeSelectOption>
            </NativeSelect>
            {workersMode === "override" && (
              <Input
                type="number"
                min={1}
                className="h-8 w-24 text-sm"
                placeholder="如 5"
                value={workersDraft}
                onChange={(e) => setWorkersDraft(e.target.value)}
                disabled={workersBusy}
              />
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={
                workersBusy ||
                (workersMode === "override" && String(task?.workers_override ?? "") === workersDraft) ||
                (workersMode === "follow" && (task?.workers_override == null || task.workers_override <= 0))
              }
              onClick={() => void saveWorkers()}
            >
              <CheckIcon className="size-3.5" /> 保存
            </Button>
            {workersErr && <span className="text-xs text-red-500">{workersErr}</span>}
          </div>
          <p className="text-muted-foreground text-xs">当前生效：{effectiveWorkers} 个并发 worker。</p>
        </CardContent>
      </Card>

      {/* Worker LLM 分配：把 worker 槽位按配额固定到不同 LLM 配置（分布式调度）。
          planner / 主 Agent / 目标判定不受影响，始终走任务 LLM 配置链（主配置）。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranchIcon className="size-4 text-primary" /> Worker LLM 分配（分布式）
          </CardTitle>
          <CardDescription>
            未配置时全部 worker 走任务 LLM 配置链（顺序故障转移）。配置后按顺序把前若干 worker
            槽位固定到所选配置——多个来源分摊并发，避开单来源并发上限；超出配额总量的槽位仍走配置链。
            planner / 主 Agent 始终走配置链。保存后现有 worker 优雅换血到新分配。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {planRows.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {planRows.map((row, i) => {
                let slotStart = 1;
                for (let j = 0; j < i; j++) slotStart += planRows[j].slots;
                const p = profiles.find((x) => Number(x.id) === row.profile_id);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                    <span className="text-muted-foreground shrink-0 text-xs">work#{slotStart}</span>
                    <NativeSelect
                      size="sm"
                      className="min-w-44"
                      value={String(row.profile_id)}
                      onChange={(e) =>
                        setPlanRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, profile_id: Number(e.target.value) } : r)),
                        )
                      }
                    >
                      {profiles
                        .filter((x) => Number(x.id) === row.profile_id || !planRows.some((r) => r.profile_id === Number(x.id)))
                        .map((x) => (
                          <NativeSelectOption key={x.id} value={x.id}>
                            {x.name} · {x.model}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                    <Input
                      type="number"
                      min={1}
                      className="h-7 w-20 text-sm"
                      value={row.slots}
                      onChange={(e) =>
                        setPlanRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, slots: Math.max(1, Number(e.target.value) || 1) } : r)),
                        )
                      }
                      disabled={planBusy}
                    />
                    <span className="text-muted-foreground shrink-0 text-xs">
                      个槽位{p ? "" : "（配置已失效）"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={planBusy}
                      onClick={() => setPlanRows((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2Icon className="size-3.5 text-red-500" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">未配置：全部 worker 走任务 LLM 配置链（主配置）。</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={planBusy || profiles.length === 0 || planRows.length >= profiles.length}
              onClick={() => {
                const used = new Set(planRows.map((r) => r.profile_id));
                const free = profiles.find((x) => !used.has(Number(x.id)));
                if (free) setPlanRows((prev) => [...prev, { profile_id: Number(free.id), slots: 1 }]);
              }}
            >
              <PlusIcon className="size-3.5" /> 添加分配
            </Button>
            {planRows.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={planBusy}
                  onClick={() => void savePlan(planRows)}
                >
                  <CheckIcon className="size-3.5" /> 保存分配
                </Button>
                <Button size="sm" variant="ghost" disabled={planBusy} onClick={() => void savePlan(null)}>
                  清空
                </Button>
              </>
            )}
            {planErr && <span className="text-xs text-red-500">{planErr}</span>}
          </div>
          {planRows.length > 0 && (
            <p className="text-muted-foreground text-xs">
              生效预览：work#1 起按上述顺序分配
              {(() => {
                const total = planRows.reduce((a, r) => a + r.slots, 0);
                if (total < effectiveWorkers) {
                  return `，前 ${total} 个槽位固定，其余 ${effectiveWorkers - total} 个走配置链`;
                }
                return `（共 ${total} 个槽位，超出本任务并发数 ${effectiveWorkers} 的部分不生效）`;
              })()}。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 任务信息：改名 / 置顶。描述与目标在总览置顶展示，这里不重复。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <InfoIcon className="size-4 text-primary" /> 任务信息
          </CardTitle>
          <CardDescription>任务名称与置顶状态。描述/目标在总览页置顶展示，此处不重复。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 min-w-56 flex-1 text-sm"
              placeholder="任务名称"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
              }}
              disabled={nameBusy}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={nameBusy || !nameDraft.trim() || nameDraft.trim() === (task?.name ?? "")}
              onClick={() => void saveName()}
            >
              <CheckIcon className="size-3.5" /> 保存
            </Button>
            {nameErr && <span className="text-xs text-red-500">{nameErr}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <Switch checked={!!task?.pinned} onCheckedChange={() => void togglePinned()} /> 置顶
            </span>
            {task && (
              <>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">状态</span>
                  <StatusBadge domain="task" value={task.status} dot />
                </span>
                <span className="text-muted-foreground font-mono text-xs">ID {task.id}</span>
                {task.created_at && (
                  <span className="text-muted-foreground text-xs">
                    创建于 {new Date(task.created_at).toLocaleString("zh-CN")}
                  </span>
                )}
                {task.completed_unix && task.completed_unix > 0 && (
                  <span className="text-muted-foreground text-xs">
                    完成于 {new Date(task.completed_unix * 1000).toLocaleString("zh-CN")}
                  </span>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 目标管理：新增/修改会通知规划者并复活任务，删除仅通知规划者（不复活）。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecksIcon className="size-4 text-primary" /> 目标管理
            <span className="text-muted-foreground text-xs font-normal">
              （最终可核验的目标，共 {goals.length} 条；新增/修改会通知规划者并复活任务）
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-7 min-w-56 flex-1 text-sm"
              placeholder="新增目标，如『拿到管理员账号的越权访问』"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addGoal();
              }}
              disabled={goalBusy}
            />
            <Input
              className="h-7 w-32 text-sm"
              placeholder="漏洞类(可选)"
              value={goalVuln}
              onChange={(e) => setGoalVuln(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addGoal();
              }}
              disabled={goalBusy}
            />
            <Button size="sm" variant="outline" disabled={goalBusy || !goalText.trim()} onClick={() => void addGoal()}>
              <PlusIcon className="size-3.5" /> 添加
            </Button>
            {goalErr && <span className="text-xs text-red-500">{goalErr}</span>}
          </div>
          {goals.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {goals.map((g) =>
                editingGoalId === g.id ? (
                  <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5">
                    <Input
                      className="h-7 min-w-56 flex-1 text-sm"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveEditGoal(g);
                        if (e.key === "Escape") cancelEditGoal();
                      }}
                      disabled={goalBusy}
                      autoFocus
                    />
                    <Input
                      className="h-7 w-32 text-sm"
                      placeholder="漏洞类(可选)"
                      value={editVuln}
                      onChange={(e) => setEditVuln(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveEditGoal(g);
                        if (e.key === "Escape") cancelEditGoal();
                      }}
                      disabled={goalBusy}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={goalBusy || !editText.trim()}
                      onClick={() => void saveEditGoal(g)}
                    >
                      <CheckIcon className="size-3.5 text-emerald-500" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={goalBusy}
                      onClick={cancelEditGoal}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div key={g.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                    <StatusBadge domain="goal" value={g.state} />
                    <span className="min-w-0 flex-1 break-words">{g.text}</span>
                    {g.vulnclass && (
                      <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs">
                        {g.vulnclass}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={goalBusy}
                      onClick={() => startEditGoal(g)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={goalBusy}
                      onClick={() => void removeGoal(g)}
                    >
                      <Trash2Icon className="size-3.5 text-red-500" />
                    </Button>
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">暂无目标，添加后规划者会据此派发探索意图并判定达成。</p>
          )}
        </CardContent>
      </Card>

      {/* 操作约束：会在下一轮规划时注入 planner/worker 的系统提示以框定探索边界。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlertIcon className="size-4 text-amber-500" /> 操作约束
            <span className="text-muted-foreground text-xs font-normal">
              （框定 planner/worker 的探索边界，共 {constraints.length} 条；改动下一轮规划生效）
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              value={conKind}
              onChange={(e) => setConKind(e.target.value as TaskConstraint["kind"])}
            >
              <NativeSelectOption value="deny">禁止</NativeSelectOption>
              <NativeSelectOption value="allow">允许</NativeSelectOption>
            </NativeSelect>
            <Input
              className="h-7 min-w-56 flex-1 text-sm"
              placeholder="一条操作约束，如『仅测当前端口，不扫其他端口』"
              value={conText}
              onChange={(e) => setConText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addConstraint();
              }}
              disabled={conBusy}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={conBusy || !conText.trim()}
              onClick={() => void addConstraint()}
            >
              <PlusIcon className="size-3.5" /> 添加
            </Button>
            {conErr && <span className="text-xs text-red-500">{conErr}</span>}
          </div>
          {constraints.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {constraints.map((c) =>
                editingConId === c.id ? (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5">
                    <NativeSelect
                      size="sm"
                      value={editConKind}
                      onChange={(e) => setEditConKind(e.target.value as TaskConstraint["kind"])}
                    >
                      <NativeSelectOption value="deny">禁止</NativeSelectOption>
                      <NativeSelectOption value="allow">允许</NativeSelectOption>
                    </NativeSelect>
                    <Input
                      className="h-7 min-w-56 flex-1 text-sm"
                      value={editConText}
                      onChange={(e) => setEditConText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveEditConstraint(c);
                        if (e.key === "Escape") cancelEditConstraint();
                      }}
                      disabled={conBusy}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={conBusy || !editConText.trim()}
                      onClick={() => void saveEditConstraint(c)}
                    >
                      <CheckIcon className="size-3.5 text-emerald-500" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={conBusy}
                      onClick={cancelEditConstraint}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div key={c.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                        c.kind === "allow"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-red-500/15 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {c.kind === "allow" ? "允许" : "禁止"}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{c.text}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={conBusy}
                      onClick={() => startEditConstraint(c)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5"
                      disabled={conBusy}
                      onClick={() => void removeConstraint(c)}
                    >
                      <Trash2Icon className="size-3.5 text-red-500" />
                    </Button>
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              暂无操作约束。建任务时会自动从描述/目标抽取；也可在此手动增删改，用来框定「允许/禁止做哪些操作」。
            </p>
          )}
        </CardContent>
      </Card>

      <TaskInterceptRulesCard taskId={taskId} />

      {/* 测试范围：覆盖度分母 + 授权边界，可手动增删。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheckIcon className="size-4 text-emerald-500" /> 测试范围
            <span className="text-muted-foreground text-xs font-normal">
              （覆盖度分母 + 授权边界，共 {scope.length} 条）
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              value={scopeKind}
              onChange={(e) => setScopeKind(e.target.value as TaskScopeRow["kind"])}
            >
              <NativeSelectOption value="root_domain">根域名</NativeSelectOption>
              <NativeSelectOption value="subdomain">子域名</NativeSelectOption>
              <NativeSelectOption value="ip">IP</NativeSelectOption>
              <NativeSelectOption value="cidr">网段</NativeSelectOption>
              <NativeSelectOption value="icp">ICP</NativeSelectOption>
              <NativeSelectOption value="keyword">关键词</NativeSelectOption>
              <NativeSelectOption value="company">公司</NativeSelectOption>
            </NativeSelect>
            <Input
              className="h-7 w-56 text-sm"
              placeholder={
                scopeKind === "company"
                  ? "公司名或 id"
                  : scopeKind === "ip" || scopeKind === "cidr"
                    ? "如 10.0.0.1 或 10.0.0.0/24"
                    : scopeKind === "icp"
                      ? "如 京ICP备12345678号-1"
                      : scopeKind === "keyword"
                        ? "如 企业名称关键词"
                        : "如 example.com"
              }
              value={scopeValueInput}
              onChange={(e) => setScopeValueInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addScope();
              }}
              disabled={scopeBusy}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={scopeBusy || !scopeValueInput.trim()}
              onClick={() => void addScope()}
            >
              <PlusIcon className="size-3.5" /> 添加
            </Button>
            {scopeErr && <span className="text-xs text-red-500">{scopeErr}</span>}
          </div>
          {/* 范围列表（分页：默认 10 条/页，可选 10/50/100） */}
          {scope.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {(() => {
                // 删除末页数据后自动收敛到新的最后一页（渲染期推导，无需 effect）。
                const totalPages = Math.max(1, Math.ceil(scope.length / scopePageSize));
                const page = Math.min(scopePage, totalPages);
                const rows = scope.slice((page - 1) * scopePageSize, page * scopePageSize);
                return (
                  <>
                    {rows.map((row) => (
                      <div key={row.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs">
                          {SCOPE_KIND_LABELS[row.kind]}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{scopeValue(row)}</span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {SCOPE_SOURCE_LABELS[row.source]}
                        </span>
                        {row.task_id.toString() === taskId ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 shrink-0 px-1.5"
                            onClick={() => void removeScope(row)}
                          >
                            <Trash2Icon className="size-3.5 text-red-500" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground shrink-0 text-xs">继承</span>
                        )}
                      </div>
                    ))}
                    {scope.length > scopePageSize && (
                      <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                        <span>
                          第 {page} / {totalPages} 页 · 共 {scope.length} 条
                        </span>
                        <NativeSelect
                          size="sm"
                          value={String(scopePageSize)}
                          onChange={(e) => {
                            setScopePageSize(Number(e.target.value));
                            setScopePage(1);
                          }}
                        >
                          <NativeSelectOption value="10">10 条/页</NativeSelectOption>
                          <NativeSelectOption value="50">50 条/页</NativeSelectOption>
                          <NativeSelectOption value="100">100 条/页</NativeSelectOption>
                        </NativeSelect>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-1.5"
                          disabled={page <= 1}
                          onClick={() => setScopePage(page - 1)}
                        >
                          上一页
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-1.5"
                          disabled={page >= totalPages}
                          onClick={() => setScopePage(page + 1)}
                        >
                          下一页
                        </Button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">暂无测试范围，添加后可作为资产覆盖度的分母。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const TASK_RULE_KIND_OPTIONS: { value: AssetInterceptKind; label: string; placeholder: string }[] = [
  { value: "exact_domain", label: "域名(全等)", placeholder: "example.gov.cn" },
  { value: "exact_ip", label: "IP(全等)", placeholder: "203.0.113.10" },
  { value: "exact_url", label: "URL(全等)", placeholder: "https://example.com/login" },
  { value: "fuzzy_domain", label: "域名(模糊)", placeholder: ".gov.cn" },
  { value: "fuzzy_ip", label: "IP(模糊)", placeholder: "203.0.113." },
  { value: "fuzzy_url", label: "URL(模糊)", placeholder: "/admin" },
  { value: "cidr", label: "CIDR 网段", placeholder: "192.168.0.0/16" },
];

const TASK_RULE_KIND_LABEL: Record<AssetInterceptKind, string> = Object.fromEntries(
  TASK_RULE_KIND_OPTIONS.map((o) => [o.value, o.label]),
) as Record<AssetInterceptKind, string>;

// TaskInterceptRulesCard 管理「任务级资产拦截 / 允许规则」：
// 列表 + 新增 + 行内编辑 + 删除 + 启用开关。规则仅本任务生效，不进全局表。
function TaskInterceptRulesCard({ taskId }: { taskId: string }) {
  const [rules, setRules] = React.useState<AssetInterceptRule[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [newAction, setNewAction] = React.useState<"block" | "allow">("block");
  const [newKind, setNewKind] = React.useState<AssetInterceptKind>("fuzzy_domain");
  const [newPattern, setNewPattern] = React.useState("");
  const [newNote, setNewNote] = React.useState("");
  const [editId, setEditId] = React.useState<number | null>(null);
  const [editAction, setEditAction] = React.useState<"block" | "allow">("block");
  const [editKind, setEditKind] = React.useState<AssetInterceptKind>("fuzzy_domain");
  const [editPattern, setEditPattern] = React.useState("");
  const [editNote, setEditNote] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setRules(await api.taskInterceptRules(taskId));
    } catch {
      // 忽略瞬时错误
    }
  }, [taskId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!newPattern.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.createTaskInterceptRule(taskId, {
        action: newAction,
        kind: newKind,
        pattern: newPattern.trim(),
        note: newNote.trim(),
        enabled: true,
      });
      setNewPattern("");
      setNewNote("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: AssetInterceptRule) {
    setEditId(r.id);
    setEditAction(r.action ?? "block");
    setEditKind(r.kind);
    setEditPattern(r.pattern);
    setEditNote(r.note);
    setErr("");
  }

  async function saveEdit(r: AssetInterceptRule) {
    if (!editPattern.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.updateTaskInterceptRule(taskId, r.id, {
        action: editAction,
        kind: editKind,
        pattern: editPattern.trim(),
        note: editNote.trim(),
        enabled: r.enabled,
      });
      setEditId(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: AssetInterceptRule) {
    setRules((prev) => prev.filter((x) => x.id !== r.id));
    try {
      await api.deleteTaskInterceptRule(taskId, r.id);
    } catch {
      await load();
    }
  }

  async function toggle(r: AssetInterceptRule) {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)));
    try {
      await api.toggleTaskInterceptRule(taskId, r.id, !r.enabled);
    } catch {
      await load();
    }
  }

  const placeholder = TASK_RULE_KIND_OPTIONS.find((o) => o.value === newKind)?.placeholder ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheckIcon className="size-4 text-sky-500" /> 任务级资产拦截 / 允许
          <span className="text-muted-foreground text-xs font-normal">
            （仅本任务生效，不进全局；先拦截后允许，共 {rules.length} 条）
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* 新增表单 */}
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect size="sm" value={newAction} onChange={(e) => setNewAction(e.target.value as "block" | "allow")}>
            <NativeSelectOption value="block">拦截</NativeSelectOption>
            <NativeSelectOption value="allow">允许</NativeSelectOption>
          </NativeSelect>
          <NativeSelect size="sm" value={newKind} onChange={(e) => setNewKind(e.target.value as AssetInterceptKind)}>
            {TASK_RULE_KIND_OPTIONS.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            className="h-7 min-w-56 flex-1 text-sm"
            placeholder={placeholder}
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            disabled={busy}
          />
          <Input
            className="h-7 w-36 text-sm"
            placeholder="备注(可选)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            disabled={busy}
          />
          <Button size="sm" variant="outline" disabled={busy || !newPattern.trim()} onClick={() => void add()}>
            <PlusIcon className="size-3.5" /> 添加
          </Button>
          {err && <span className="text-xs text-red-500">{err}</span>}
        </div>
        {/* 规则列表 */}
        {rules.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {rules.map((r) =>
              editId === r.id ? (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5">
                  <NativeSelect
                    size="sm"
                    value={editAction}
                    onChange={(e) => setEditAction(e.target.value as "block" | "allow")}
                  >
                    <NativeSelectOption value="block">拦截</NativeSelectOption>
                    <NativeSelectOption value="allow">允许</NativeSelectOption>
                  </NativeSelect>
                  <NativeSelect
                    size="sm"
                    value={editKind}
                    onChange={(e) => setEditKind(e.target.value as AssetInterceptKind)}
                  >
                    {TASK_RULE_KIND_OPTIONS.map((o) => (
                      <NativeSelectOption key={o.value} value={o.value}>
                        {o.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    className="h-7 min-w-56 flex-1 text-sm"
                    value={editPattern}
                    onChange={(e) => setEditPattern(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveEdit(r);
                      if (e.key === "Escape") setEditId(null);
                    }}
                    disabled={busy}
                    autoFocus
                  />
                  <Input
                    className="h-7 w-36 text-sm"
                    placeholder="备注(可选)"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    disabled={busy}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5"
                    disabled={busy || !editPattern.trim()}
                    onClick={() => void saveEdit(r)}
                  >
                    <CheckIcon className="size-3.5 text-emerald-500" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5"
                    disabled={busy}
                    onClick={() => setEditId(null)}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <div key={r.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                      r.action === "allow"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/15 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {r.action === "allow" ? "允许" : "拦截"}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">{TASK_RULE_KIND_LABEL[r.kind]}</span>
                  <code className="bg-muted min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-xs">{r.pattern}</code>
                  {r.note && (
                    <span className="text-muted-foreground max-w-[120px] shrink-0 truncate text-xs">{r.note}</span>
                  )}
                  <Switch checked={r.enabled} onCheckedChange={() => void toggle(r)} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5"
                    disabled={busy}
                    onClick={() => startEdit(r)}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5"
                    disabled={busy}
                    onClick={() => void remove(r)}
                  >
                    <Trash2Icon className="size-3.5 text-red-500" />
                  </Button>
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            暂无任务级规则。「拦截」命中即禁止测试；「允许」为白名单——配置后本任务只允许命中允许规则的资产（未配置则不启用白名单）。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
