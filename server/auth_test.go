package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// GetSetting 对"键不存在"和"读取出错"的返回值只差一个 error：两种情况 value 都是
// 空串。密码相关的 handler 一旦把 error 当成"还没设置密码"，就会在数据库抖动期间
// 敞开初始化入口——authInit 会放行一个未认证请求去覆盖已有的管理员密码，
// authStatus 则会把前端直接送到 /setup 去照着做这件事。
//
// 这两个测试把 handler 的连接池关掉来制造读取失败，断言两处都 fail closed。
func TestAuthStatusFailsClosedWhenDataSourceUnavailable(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	// 关掉池子，让后续 GetSetting 返回 error 而不是 sql.ErrNoRows。
	if err := m.pg.Close(); err != nil {
		t.Fatal(err)
	}

	s := &Server{m: m}
	w := httptest.NewRecorder()
	s.authStatus(w, httptest.NewRequest("GET", "/api/auth/status", nil))

	if w.Code != 503 {
		t.Fatalf("status=%d want 503 (读失败被当成未初始化会把用户送去 /setup 覆盖密码); body=%s", w.Code, w.Body.String())
	}
	var payload struct {
		Initialized *bool `json:"initialized"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err == nil && payload.Initialized != nil {
		t.Fatalf("读失败时不应回答 initialized，得到 %v", *payload.Initialized)
	}
}

func TestAuthInitFailsClosedWhenDataSourceUnavailable(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	if err := m.pg.Close(); err != nil {
		t.Fatal(err)
	}

	s := &Server{m: m}
	w := httptest.NewRecorder()
	body := strings.NewReader(`{"password":"correct horse battery"}`)
	s.authInit(w, httptest.NewRequest("POST", "/api/auth/init", body))

	if w.Code != 503 {
		t.Fatalf("status=%d want 503 (读失败时放行会让未认证请求覆盖已有密码); body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "token") {
		t.Fatalf("读失败时不应签发 token: %s", w.Body.String())
	}
}

func TestValidatePassword(t *testing.T) {
	for _, tc := range []struct {
		name, pw string
		wantErr  bool
	}{
		{"空", "", true},
		{"七位", "1234567", true},
		{"八位", "12345678", false},
		{"八个汉字按字符数而非字节数计", "密码密码密码密码", false},
		{"三个汉字够 9 字节但只有 3 个字符", "密码强", true},
		{"72 字节", strings.Repeat("a", 72), false},
		{"73 字节超出 bcrypt 上限", strings.Repeat("a", 73), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validatePassword(tc.pw); (got != "") != tc.wantErr {
				t.Fatalf("validatePassword(%q)=%q, wantErr=%v", tc.pw, got, tc.wantErr)
			}
		})
	}
}

// TestJWTKeyFileEnvOverride：ARTEX_JWT_KEY_FILE 必须把密钥定位到指定路径（容器
// 部署把它指进挂载卷，容器重建不再轮换密钥踢掉全部会话）；不设时维持原行为。
func TestJWTKeyFileEnvOverride(t *testing.T) {
	dir := t.TempDir()
	keyPath := dir + "/keys/jwt.key"

	t.Setenv("ARTEX_JWT_KEY_FILE", keyPath)
	k1, err := loadOrCreateJWTKey("/nonexistent/basedir", dir)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if len(k1) < 32 {
		t.Fatalf("key too short: %d", len(k1))
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("key not written to env path: %v", err)
	}
	k2, err := loadOrCreateJWTKey("/nonexistent/basedir", dir)
	if err != nil || string(k1) != string(k2) {
		t.Fatalf("second call must reuse the same key: %v", err)
	}

	t.Setenv("ARTEX_JWT_KEY_FILE", "")
	k3, err := loadOrCreateJWTKey(dir, dir) // 未设 env → keyDir/jwt.key
	if err != nil {
		t.Fatalf("default path: %v", err)
	}
	if _, err := os.Stat(dir + "/jwt.key"); err != nil {
		t.Fatalf("default-path key not written: %v", err)
	}
	if string(k3) == string(k1) {
		t.Fatal("default path key should be independent of the env-path key")
	}
}
