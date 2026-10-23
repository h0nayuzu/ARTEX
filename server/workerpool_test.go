package server

import (
	"context"
	"testing"
	"time"

	"github.com/Autumn-27/artex/db"
)

// 伸缩 worker 池的语义测试:改 workers 设置后,运行中的任务要能优雅增减——
// 缩容给超额句柄打 retire 标志(跑完当前意图退出),扩容补足差额,退出句柄
// 从池中移除。不启动真实 workerLoop(spawn 路径依赖完整 Engine),只验证
// 标记/移除/退出判定这些可独立验证的部分。

func newPoolTestEngine() (*Engine, *Task) {
	e := &Engine{
		m:        &Manager{},
		runtimes: map[string]*taskRuntime{},
		pools:    map[string]*workerPool{},
	}
	t := &Task{ID: "pool-test"}
	e.pools[t.ID] = &workerPool{desired: 5}
	return e, t
}

func liveCount(p *workerPool) int {
	n := 0
	for _, h := range p.workers {
		if !h.retire.Load() {
			n++
		}
	}
	return n
}

// 缩容:5 → 2,恰好 3 个句柄被标记、2 个保持存活;重复 rescale 幂等。
func TestWorkerPoolScaleDownMarks(t *testing.T) {
	e, task := newPoolTestEngine()
	pool := e.pools[task.ID]
	for i := 0; i < 5; i++ {
		pool.workers = append(pool.workers, &workerHandle{name: "work#x"})
	}
	e.rescalePool(task, 2)
	if got := liveCount(pool); got != 2 {
		t.Fatalf("after scale-down live=%d, want 2", got)
	}
	if len(pool.workers) != 5 {
		t.Fatalf("retired handles must stay until exit: len=%d", len(pool.workers))
	}
	e.rescalePool(task, 2) // 幂等:不会重复标记或误杀
	if got := liveCount(pool); got != 2 {
		t.Fatalf("after repeat live=%d, want 2", got)
	}
	// 再缩到 0:全部标记
	e.rescalePool(task, 0)
	if got := liveCount(pool); got != 0 {
		t.Fatalf("after scale-to-0 live=%d, want 0", got)
	}
}

// 扩容目标大于存活数时 desired 跟随(spawn 依赖完整 Engine,这里只验证
// desired 更新且不 panic、不误标)。
func TestWorkerPoolScaleUpNoopMarks(t *testing.T) {
	e, task := newPoolTestEngine()
	pool := e.pools[task.ID]
	pool.workers = append(pool.workers, &workerHandle{name: "work#1"})
	e.rescalePool(task, 4)
	if pool.desired != 4 {
		t.Fatalf("desired=%d, want 4", pool.desired)
	}
	if got := liveCount(pool); got != 1 {
		t.Fatalf("existing worker must stay live, got %d", got)
	}
}

// 退出的 worker 从池中移除;池已注销时移除是 no-op。
func TestWorkerRetireRemovesFromPool(t *testing.T) {
	e, task := newPoolTestEngine()
	pool := e.pools[task.ID]
	h1 := &workerHandle{name: "work#1"}
	h2 := &workerHandle{name: "work#2"}
	pool.workers = []*workerHandle{h1, h2}
	e.retireWorkerFromPool(task.ID, h1)
	if len(pool.workers) != 1 || pool.workers[0] != h2 {
		t.Fatalf("h1 not removed: %+v", pool.workers)
	}
	e.runtimeMu.Lock()
	delete(e.pools, task.ID)
	e.runtimeMu.Unlock()
	e.retireWorkerFromPool(task.ID, h2) // 不 panic
}

// workerLoop 在 retire 已置位时立即退出,不会领取任何意图(优雅缩容的退出路径)。
func TestWorkerLoopExitsWhenRetired(t *testing.T) {
	e, task := newPoolTestEngine()
	h := &workerHandle{name: "work#1"}
	h.retire.Store(true)
	done := make(chan struct{})
	go func() {
		e.workerLoop(context.Background(), task, h)
		close(done)
	}()
	select {
	case <-done:
		// 预期:立即返回
	case <-time.After(2 * time.Second):
		t.Fatal("retired worker did not exit")
	}
}

// profileForSlot:分配计划的槽位映射——配额内命中对应配置,超出总量回落(0)。
func TestProfileForSlot(t *testing.T) {
	plan := []db.WorkerLLMSlot{
		{ProfileID: 11, Slots: 2},
		{ProfileID: 22, Slots: 3},
	}
	for _, c := range []struct {
		slot int
		want int64
	}{
		{1, 11}, {2, 11}, // 前两个槽位 → 配置 11
		{3, 22}, {4, 22}, {5, 22}, // 接下来三个 → 配置 22
		{6, 0}, {100, 0}, // 超出配额总量 → 走默认链
		{0, 0}, {-5, 0}, // 非法槽位
	} {
		if got := profileForSlot(plan, c.slot); got != c.want {
			t.Fatalf("slot %d: got %d want %d", c.slot, got, c.want)
		}
	}
	// 零配额条目被跳过
	if got := profileForSlot([]db.WorkerLLMSlot{{ProfileID: 9, Slots: 0}, {ProfileID: 8, Slots: 1}}, 1); got != 8 {
		t.Fatalf("zero-slot entry should be skipped, got %d", got)
	}
}
