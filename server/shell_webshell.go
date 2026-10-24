// Shell 管理 · webshell HTTP API:连接 CRUD / 自动识别 / 探活 / 命令执行 /
// 文件管理 / 数据库控制台 / 生成器 / 操作台账。
// 全部走默认 JWT 鉴权;操作入台账(shell_op_log)。
package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/server/webshellproto"
)

const maxShellBodyBytes = 10 << 20

func decodeShellJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxShellBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(value); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, "请求正文过大")
		} else {
			writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		}
		return false
	}
	return true
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// webshellView 对外连接视图(密码不回传,只带尾 4 位)。
type webshellView struct {
	*db.WebshellConn
	PasswordSet  bool            `json:"password_set"`
	PasswordTail string          `json:"password_tail"`
	LastProbeAtS string          `json:"last_probe_at,omitempty"`
	BasicInfoM   json.RawMessage `json:"basic_info"`
}

func toWebshellView(c *db.WebshellConn) *webshellView {
	tail := ""
	if len(c.Password) > 4 {
		tail = "…" + c.Password[len(c.Password)-4:]
	} else if c.Password != "" {
		tail = "…"
	}
	view := &webshellView{WebshellConn: c, PasswordSet: c.Password != "", PasswordTail: tail, BasicInfoM: c.BasicInfo}
	if view.BasicInfoM == nil {
		view.BasicInfoM = json.RawMessage("{}")
	}
	if c.LastProbeAt.Valid {
		view.LastProbeAtS = c.LastProbeAt.Time.Format("2006-01-02 15:04:05")
	}
	return view
}

// connToProto 把存储行转成协议层连接。
func connToProto(c *db.WebshellConn) *webshellproto.Conn {
	return &webshellproto.Conn{
		ID:        c.ID,
		URL:       c.URL,
		Protocol:  c.Protocol,
		ShellLang: c.ShellLang,
		ExecMode:  c.ExecMode,
		PassParam: c.PassParam,
		CmdParam:  c.CmdParam,
		Password:  c.Password,
		SecretKey: c.SecretKey,
		Method:    c.Method,
		Encoding:  c.Encoding,
		OS:        c.OS,
		Kind:      c.Kind,
		Headers:   c.Headers,
		TimeoutMs: c.TimeoutMs,
	}
}

func (s *Server) getWebshellByID(w http.ResponseWriter, r *http.Request) (*db.WebshellConn, *db.ShellStore, bool) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return nil, nil, false
	}
	conn, err := st.GetWebshell(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "连接不存在")
		return nil, nil, false
	}
	return conn, st, true
}

func (s *Server) listWebshells(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	conns, err := st.ListWebshells()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]*webshellView, 0, len(conns))
	for _, c := range conns {
		items = append(items, toWebshellView(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) getWebshell(w http.ResponseWriter, r *http.Request) {
	conn, _, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toWebshellView(conn))
}

type webshellMutationRequest struct {
	Name       *string           `json:"name"`
	URL        *string           `json:"url"`
	Protocol   *string           `json:"protocol"`
	ShellLang  *string           `json:"shell_lang"`
	ExecMode   *string           `json:"exec_mode"`
	PassParam  *string           `json:"pass_param"`
	CmdParam   *string           `json:"cmd_param"`
	Password   *string           `json:"password"`
	SecretKey  *string           `json:"secret_key"`
	Method     *string           `json:"method"`
	Encoding   *string           `json:"encoding"`
	DbEncoding *string           `json:"db_encoding"`
	OS         *string           `json:"os"`
	Kind       *string           `json:"kind"`
	Headers    map[string]string `json:"headers"`
	TimeoutMs  *int              `json:"timeout_ms"`
	Remark     *string           `json:"remark"`
}

func applyWebshellMutation(c *db.WebshellConn, req *webshellMutationRequest) {
	if req.Name != nil {
		c.Name = strings.TrimSpace(*req.Name)
	}
	if req.URL != nil {
		c.URL = strings.TrimSpace(*req.URL)
	}
	if req.Protocol != nil {
		c.Protocol = *req.Protocol
	}
	if req.ShellLang != nil {
		c.ShellLang = *req.ShellLang
	}
	if req.ExecMode != nil {
		c.ExecMode = *req.ExecMode
	}
	if req.PassParam != nil {
		c.PassParam = *req.PassParam
	}
	if req.CmdParam != nil {
		c.CmdParam = *req.CmdParam
	}
	if req.Password != nil {
		c.Password = *req.Password
	}
	if req.SecretKey != nil {
		c.SecretKey = *req.SecretKey
	}
	if req.Method != nil {
		c.Method = *req.Method
	}
	if req.Encoding != nil {
		c.Encoding = *req.Encoding
	}
	if req.DbEncoding != nil {
		c.DbEncoding = *req.DbEncoding
	}
	if req.OS != nil {
		c.OS = *req.OS
	}
	if req.Kind != nil {
		c.Kind = *req.Kind
	}
	if req.Headers != nil {
		c.Headers = req.Headers
	}
	if req.TimeoutMs != nil {
		c.TimeoutMs = *req.TimeoutMs
	}
	if req.Remark != nil {
		c.Remark = *req.Remark
	}
}

func (s *Server) createWebshell(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	var req webshellMutationRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	conn := &db.WebshellConn{ID: "ws_" + db.RandomHexID(6)}
	applyWebshellMutation(conn, &req)
	// 协议白名单校验
	if !protocolAllowed(conn.Protocol) {
		writeErr(w, http.StatusBadRequest, "未知协议 "+conn.Protocol)
		return
	}
	if strings.TrimSpace(conn.URL) == "" {
		writeErr(w, http.StatusBadRequest, "url 不能为空")
		return
	}
	saved, err := st.SaveWebshell(conn)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st.LogShellOp("webshell", saved.ID, "conn.add", saved.URL)
	writeJSON(w, http.StatusOK, toWebshellView(saved))
}

func protocolAllowed(p string) bool {
	for _, meta := range webshellproto.Registry {
		if meta.ID == p {
			return true
		}
	}
	return false
}

func (s *Server) updateWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	var req webshellMutationRequest
	if !decodeShellJSON(w, r, &req) {
		return
	}
	applyWebshellMutation(conn, &req)
	if !protocolAllowed(conn.Protocol) {
		writeErr(w, http.StatusBadRequest, "未知协议 "+conn.Protocol)
		return
	}
	saved, err := st.SaveWebshell(conn)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// 编辑后清探测缓存(凭据可能已变)
	webshellproto.InvalidateConn(saved.ID)
	st.LogShellOp("webshell", saved.ID, "conn.edit", saved.URL)
	writeJSON(w, http.StatusOK, toWebshellView(saved))
}

func (s *Server) deleteWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	if err := st.DeleteWebshell(conn.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	webshellproto.InvalidateConn(conn.ID)
	st.LogShellOp("webshell", conn.ID, "conn.del", conn.URL)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// detectWebshell 协议自动识别(不落库)。
func (s *Server) detectWebshell(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL       string `json:"url"`
		Password  string `json:"password"`
		SecretKey string `json:"secret_key"`
		PassParam string `json:"pass_param"`
		CmdParam  string `json:"cmd_param"`
		Method    string `json:"method"`
		TimeoutMs int    `json:"timeout_ms"`
	}
	if !decodeShellJSON(w, r, &req) {
		return
	}
	spec := &webshellproto.Conn{
		URL:       strings.TrimSpace(req.URL),
		Password:  req.Password,
		SecretKey: req.SecretKey,
		PassParam: orDefault(req.PassParam, "pass"),
		CmdParam:  orDefault(req.CmdParam, "cmd"),
		Method:    req.Method,
		TimeoutMs: req.TimeoutMs,
	}
	result := webshellproto.DetectProtocol(spec)
	writeJSON(w, http.StatusOK, result)
}

// probeWebshell 连接探活。
func (s *Server) probeWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	webshellproto.InvalidateConn(conn.ID)
	osName, info, err := webshellproto.ProbeConnection(connToProto(conn))
	if err != nil {
		_ = st.RecordWebshellProbe(conn.ID, "error", "auto", nil)
		writeErr(w, http.StatusBadGateway, "探活失败:"+err.Error())
		return
	}
	var raw json.RawMessage
	if info != nil {
		b, _ := json.Marshal(info)
		raw = b
	}
	_ = st.RecordWebshellProbe(conn.ID, "ok", osName, raw)
	updated, _ := st.GetWebshell(conn.ID)
	st.LogShellOp("webshell", conn.ID, "conn.probe", "os="+osName)
	resp := map[string]any{"status": "ok", "os": osName, "basic_info": info}
	if updated != nil {
		resp["conn"] = toWebshellView(updated)
	}
	writeJSON(w, http.StatusOK, resp)
}

// webshellProtocols 协议元信息。
func (s *Server) webshellProtocols(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": webshellproto.Registry})
}

// execWebshell 命令执行。
func (s *Server) execWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Command string `json:"command"`
	}
	if !decodeShellJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Command) == "" {
		writeErr(w, http.StatusBadRequest, "命令为空")
		return
	}
	out, err := webshellproto.RunCommand(connToProto(conn), req.Command)
	if err != nil {
		st.LogShellOp("webshell", conn.ID, "exec.fail", req.Command+" → "+err.Error())
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("webshell", conn.ID, "exec", req.Command)
	writeJSON(w, http.StatusOK, map[string]any{"output": out})
}

// fileWebshell 统一文件操作。
func (s *Server) fileWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Op    string `json:"op"`
		Path  string `json:"path"`
		To    string `json:"to"`
		B64   string `json:"b64"`
		Mode  string `json:"mode"`
		Epoch int64  `json:"epoch"`
		URL   string `json:"url"`
	}
	if !decodeShellJSON(w, r, &req) {
		return
	}
	proto := connToProto(conn)
	switch req.Op {
	case "ls":
		entries, err := webshellproto.ListDir(proto, req.Path)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		if entries == nil {
			entries = []webshellproto.FileEntry{}
		}
		st.LogShellOp("webshell", conn.ID, "file.ls", req.Path)
		writeJSON(w, http.StatusOK, map[string]any{"items": entries})
	case "read":
		buf, err := webshellproto.ReadFile(proto, req.Path)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("webshell", conn.ID, "file.read", req.Path)
		writeJSON(w, http.StatusOK, map[string]any{"b64": webshellproto.B64(buf), "size": len(buf)})
	case "write":
		data, err := webshellproto.Unb64(req.B64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "b64 内容非法")
			return
		}
		if err := webshellproto.WriteFile(proto, req.Path, data); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("webshell", conn.ID, "file.write", fmt.Sprintf("%s (%dB)", req.Path, len(data)))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "size": len(data)})
	case "delete", "delete-dir", "mkdir", "mv", "copy", "chmod", "touch", "stat", "wget", "hash", "roots":
		args := webshellproto.FileArgs{Path: req.Path, To: req.To, Mode: req.Mode, Epoch: req.Epoch, URL: req.URL}
		if req.Op == "mv" || req.Op == "copy" {
			parts := strings.SplitN(req.Path, "→", 2)
			if len(parts) == 2 {
				args.From = strings.TrimSpace(parts[0])
				args.To = strings.TrimSpace(parts[1])
			} else {
				args.From = req.Path
			}
		}
		if req.Op == "wget" && args.To == "" {
			args.To = req.Path
		}
		res, err := webshellproto.FileAction(proto, req.Op, args)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("webshell", conn.ID, "file."+req.Op, req.Path+orEmptySuffix(req.To))
		writeJSON(w, http.StatusOK, res)
	default:
		writeErr(w, http.StatusBadRequest, "未知文件操作 "+req.Op)
	}
}

func orEmptySuffix(s string) string {
	if s == "" {
		return ""
	}
	return " → " + s
}

// uploadWebshell 文件上传( multipart: path + file)。
func (s *Server) uploadWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "multipart 解析失败:"+err.Error())
		return
	}
	path := r.FormValue("path")
	file, _, err := r.FormFile("file")
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
	if err := webshellproto.WriteFile(connToProto(conn), path, content); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("webshell", conn.ID, "file.upload", fmt.Sprintf("%s (%dB)", path, len(content)))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "size": len(content)})
}

// downloadWebshell 文件下载(读回并流给浏览器)。
func (s *Server) downloadWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		writeErr(w, http.StatusBadRequest, "path 缺失")
		return
	}
	buf, err := webshellproto.ReadFile(connToProto(conn), path)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st.LogShellOp("webshell", conn.ID, "file.download", path)
	name := path
	if i := strings.LastIndexAny(name, "/\\"); i >= 0 {
		name = name[i+1:]
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(name, "\"", "")+"\"")
	w.WriteHeader(http.StatusOK)
	w.Write(buf)
}

// webshellDBProfiles 档案 CRUD。
func (s *Server) listWebshellDBProfiles(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	profiles, err := st.ListDBProfiles(conn.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if profiles == nil {
		profiles = []*db.WebshellDBProfile{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": profiles})
}

func (s *Server) saveWebshellDBProfile(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	var req db.WebshellDBProfile
	if !decodeShellJSON(w, r, &req) {
		return
	}
	req.ConnID = conn.ID
	saved, err := st.SaveDBProfile(&req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st.LogShellOp("webshell", conn.ID, "db.profile.save", saved.Type+" "+saved.Host)
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteWebshellDBProfile(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	if err := st.DeleteDBProfile(r.PathValue("pid")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	st.LogShellOp("webshell", conn.ID, "db.profile.del", r.PathValue("pid"))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// dbWebshell 数据库操作(dbs/tables/tableinfo/exec)。
func (s *Server) dbWebshell(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Op       string `json:"op"`
		ProfileID string `json:"profile_id"`
		Database string `json:"database"`
		Table    string `json:"table"`
		SQL      string `json:"sql"`
	}
	if !decodeShellJSON(w, r, &req) {
		return
	}
	profile, err := st.GetDBProfile(req.ProfileID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "档案不存在")
		return
	}
	dbProfile := webshellproto.DBProfile{
		Type: profile.Type, Host: profile.Host, Port: profile.Port,
		Username: profile.Username, Password: profile.Password, Database: profile.Database,
	}
	if conn.DbEncoding != "" && conn.DbEncoding != "auto" {
		// dbEncoding 独立于 shell 编码(预留:PDO 侧 charset 跟类型走)
	}
	proto := connToProto(conn)
	switch req.Op {
	case "dbs":
		items, err := webshellproto.DbDatabases(proto, dbProfile)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"databases": items})
	case "tables":
		items, err := webshellproto.DbTables(proto, dbProfile, req.Database)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tables": items})
	case "tableinfo":
		res, err := webshellproto.DbTableInfo(proto, dbProfile, req.Database, req.Table)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, res)
	case "exec":
		if strings.TrimSpace(req.SQL) == "" {
			writeErr(w, http.StatusBadRequest, "SQL 为空")
			return
		}
		res, err := webshellproto.DbQuery(proto, dbProfile, req.SQL)
		if err != nil {
			st.LogShellOp("webshell", conn.ID, "db.exec.fail", req.SQL)
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		st.LogShellOp("webshell", conn.ID, "db.exec", req.SQL)
		writeJSON(w, http.StatusOK, res)
	default:
		writeErr(w, http.StatusBadRequest, "未知数据库操作 "+req.Op)
	}
}

// webshellGenerators 生成器种类。
func (s *Server) webshellGenerators(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": webshellproto.GenKinds})
}

// generateWebshell 生成一个马。
func (s *Server) generateWebshell(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	var req struct {
		Kind      string `json:"kind"`
		Name      string `json:"name"`
		PassParam string `json:"pass_param"`
		CmdParam  string `json:"cmd_param"`
		Password  string `json:"password"`
		SecretKey string `json:"secret_key"`
	}
	if !decodeShellJSON(w, r, &req) {
		return
	}
	product, err := webshellproto.Generate(req.Kind, webshellproto.GenOptions{
		Name: req.Name, PassParam: req.PassParam, CmdParam: req.CmdParam,
		Password: req.Password, SecretKey: req.SecretKey,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	meta := map[string]any{
		"password": product.Password, "pass_param": product.PassParam,
		"cmd_param": product.CmdParam, "conn_hint": product.ConnHint,
	}
	gen, err := st.InsertGeneration(product.Name, product.Lang, product.Kind, product.Ext, product.Content, meta)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	st.LogShellOp("webshell", "", "gen", product.Kind+" "+product.Name)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": gen.ID, "name": product.Name, "kind": product.Kind, "lang": product.Lang,
		"ext": product.Ext, "content": product.Content, "meta": meta,
	})
}

// listWebshellGenerations 产物清单。
func (s *Server) listWebshellGenerations(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	items, err := st.ListGenerations()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []*db.WebshellGeneration{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// downloadWebshellGeneration 产物下载。
func (s *Server) downloadWebshellGeneration(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	name, ext, content, err := st.GetGeneration(r.PathValue("gid"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "产物不存在")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(name+"."+ext, "\"", "")+"\"")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(content))
}

// deleteWebshellGeneration 删除产物。
func (s *Server) deleteWebshellGeneration(w http.ResponseWriter, r *http.Request) {
	st := s.shellStore()
	if st == nil {
		writeErr(w, http.StatusServiceUnavailable, "数据库未就绪")
		return
	}
	if err := st.DeleteGeneration(r.PathValue("gid")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// webshellOps 操作台账。
func (s *Server) webshellOps(w http.ResponseWriter, r *http.Request) {
	conn, st, ok := s.getWebshellByID(w, r)
	if !ok {
		return
	}
	limit := int(toInt(r.URL.Query().Get("limit")))
	items, err := st.ListShellOps(conn.ID, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []*db.ShellOpLog{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
