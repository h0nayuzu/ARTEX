package server

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/Autumn-27/artex/db"
)

const (
	maxTaskNameRunes           = 200
	maxTaskMetadataRequestSize = 16 << 10
	// maxTaskWorkersOverride 上限与 worker_llm_plan 的 slots 上限一致:防误触
	// 一次性 spawn 海量 goroutine(每个都走 LLM 解析/心跳)。
	maxTaskWorkersOverride = 100
)

// updateTaskMetadata changes list-only task metadata. It intentionally does not
// touch lifecycle state, scheduling, or the task's immutable description/goal.
func (s *Server) updateTaskMetadata(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if _, ok := s.m.Task(taskID); !ok {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTaskMetadataRequestSize)
	var request struct {
		Name   *string `json:"name"`
		Pinned *bool   `json:"pinned"`
		// 任务级 worker 调度(可选):workers=-1 表示清除覆盖回到跟随全局,
		// >=1 为本任务固定的并发数;worker_llm_plan 未给(nil)不变,空数组=清除。
		Workers       *int              `json:"workers"`
		WorkerLLMPlan []db.WorkerLLMSlot `json:"worker_llm_plan"`
	}
	if err := decode(r, &request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, "请求正文过大")
		} else {
			writeErr(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	if request.Name == nil && request.Pinned == nil && request.Workers == nil && request.WorkerLLMPlan == nil {
		writeErr(w, http.StatusBadRequest, "至少需要提供 name / pinned / workers / worker_llm_plan 之一")
		return
	}
	if request.Name != nil {
		name := strings.TrimSpace(*request.Name)
		if name == "" {
			writeErr(w, http.StatusBadRequest, "任务名称不能为空")
			return
		}
		if utf8.RuneCountInString(name) > maxTaskNameRunes {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("任务名称最多 %d 个字符", maxTaskNameRunes))
			return
		}
		request.Name = &name
	}
	// 调度字段的校验全部前置:任何 400 都不留下"半提交"(name 已改而 workers 被拒)。
	var schedPatch *db.TaskSchedulingPatch
	if request.Workers != nil || request.WorkerLLMPlan != nil {
		patch := db.TaskSchedulingPatch{}
		if request.Workers != nil {
			n := *request.Workers
			if n == 0 || n < -1 {
				writeErr(w, http.StatusBadRequest, "workers 需为 >=1 的并发数,或 -1 表示跟随全局")
				return
			}
			if n > maxTaskWorkersOverride {
				writeErr(w, http.StatusBadRequest, fmt.Sprintf("workers 最大 %d", maxTaskWorkersOverride))
				return
			}
			patch.WorkersOverrideSet = true
			if n > 0 {
				v := n
				patch.WorkersOverride = &v
			}
		}
		if request.WorkerLLMPlan != nil {
			if len(request.WorkerLLMPlan) > 32 {
				writeErr(w, http.StatusBadRequest, "worker_llm_plan 最多 32 条")
				return
			}
			for _, e := range request.WorkerLLMPlan {
				if e.ProfileID <= 0 || e.Slots < 1 || e.Slots > 100 {
					writeErr(w, http.StatusBadRequest, "worker_llm_plan 每条需 profile_id>0 且 slots 在 1..100")
					return
				}
			}
			patch.WorkerLLMPlanSet = true
			patch.WorkerLLMPlan = request.WorkerLLMPlan
		}
		schedPatch = &patch
	}
	// 只写有值的段:name/pinned 均缺省时跳过元数据 UPDATE,避免 no-op 写推进
	// updated_at(tasks 表有 set_updated_at 触发器)。
	var task *Task
	if request.Name != nil || request.Pinned != nil {
		var err error
		task, err = s.m.UpdateTaskMetadata(taskID, db.TaskPatch{Name: request.Name, Pinned: request.Pinned})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if task == nil {
			writeErr(w, http.StatusNotFound, "task not found")
			return
		}
	}
	// 任务级 worker 调度:与 name/pinned 同一个 PATCH,字段可选。
	if schedPatch != nil {
		updated, err := s.m.UpdateTaskScheduling(taskID, *schedPatch)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if updated == nil {
			writeErr(w, http.StatusNotFound, "task not found")
			return
		}
		if schedPatch.WorkersOverrideSet {
			s.engine.RescaleTask(taskID) // 立即按新并发数伸缩(热生效)
		}
		if schedPatch.WorkerLLMPlanSet {
			s.engine.ReassignTaskWorkers(taskID) // 槽位按位次动态解析,换血让存量意图跑完退出、新分配上线
		}
		if t, ok := s.m.Task(taskID); ok {
			task = t
		}
	}
	if task == nil {
		if t, ok := s.m.Task(taskID); ok {
			task = t
		}
	}
	writeJSON(w, http.StatusOK, taskDTO(task, s.resolvedTaskStatus(task)))
}
