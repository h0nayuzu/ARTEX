// Shell 管理存储层:webshell 连接注册表 / 数据库档案 / 生成器产物 /
// VShell C2 站点 / 操作台账。移植自 dsh-webshell-mgr 的 SQLite store,
// 迁到 Postgres(凭据明文口径与 dsh 一致:一次性作战凭据不加密落盘)。
package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrInvalidInput 输入校验失败。
var ErrInvalidInput = errors.New("invalid input")

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// RandomHexID 对外暴露的随机 hex ID 生成。
func RandomHexID(n int) string { return randomHex(n) }

// ShellStore 聚合 shell 管理的各存储面。
type ShellStore struct{ db *DB }

// Shells 返回 shell 管理存储。
func (d *DB) Shells() *ShellStore { return &ShellStore{db: d} }

// WebshellConn 是一条 webshell 连接。
type WebshellConn struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	URL         string          `json:"url"`
	Protocol    string          `json:"protocol"`
	ShellLang   string          `json:"shell_lang"`
	ExecMode    string          `json:"exec_mode"`
	PassParam   string          `json:"pass_param"`
	CmdParam    string          `json:"cmd_param"`
	Password    string          `json:"-"`
	SecretKey   string          `json:"secret_key,omitempty"`
	Method      string          `json:"method"`
	Encoding    string          `json:"encoding"`
	DbEncoding  string          `json:"db_encoding"`
	OS          string          `json:"os"`
	Kind        string          `json:"kind"`
	Headers     map[string]string `json:"headers"`
	HeadersJSON string          `json:"-"`
	TimeoutMs   int             `json:"timeout_ms"`
	Remark      string          `json:"remark"`
	BasicInfo   json.RawMessage `json:"basic_info"`
	LastProbeAt sql.NullTime    `json:"-"`
	LastStatus  string          `json:"last_status"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// VshellServer 是一个已登记的 VShell C2 站点。
type VshellServer struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	BaseURL     string       `json:"base_url"`
	Username    string       `json:"username"`
	Password    string       `json:"-"`
	TimeoutMs   int          `json:"timeout_ms"`
	Remark      string       `json:"remark"`
	LastStatus  string       `json:"last_status"`
	LastCheckAt sql.NullTime `json:"-"`
	LastError   string       `json:"last_error"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// WebshellDBProfile 是一套数据库连接档案。
type WebshellDBProfile struct {
	ID       string `json:"id"`
	ConnID   string `json:"conn_id"`
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	Username string `json:"username"`
	Password string `json:"-"`
	Database string `json:"database"`
	Remark   string `json:"remark"`
}

// WebshellGeneration 是一次生成器产物。
type WebshellGeneration struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Lang      string          `json:"lang"`
	Kind      string          `json:"kind"`
	Ext       string          `json:"ext"`
	Meta      json.RawMessage `json:"meta"`
	CreatedAt time.Time       `json:"created_at"`
}

// ShellOpLog 是一条操作台账。
type ShellOpLog struct {
	ID        int64     `json:"id"`
	Scope     string    `json:"scope"`
	ConnID    string    `json:"conn_id"`
	Action    string    `json:"action"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *ShellStore) ctx() context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	_ = cancel // 依赖驱动超时;15s 兜底由 DB 侧控制
	return ctx
}

const webshellCols = `id, name, url, protocol, shell_lang, exec_mode, pass_param, cmd_param, password, secret_key,
	method, encoding, db_encoding, os, kind, headers_json, timeout_ms, remark, basic_info, last_probe_at, last_status, created_at, updated_at`

func scanWebshell(row interface{ Scan(...any) error }) (*WebshellConn, error) {
	var c WebshellConn
	var headers string
	if err := row.Scan(&c.ID, &c.Name, &c.URL, &c.Protocol, &c.ShellLang, &c.ExecMode, &c.PassParam, &c.CmdParam,
		&c.Password, &c.SecretKey, &c.Method, &c.Encoding, &c.DbEncoding, &c.OS, &c.Kind, &headers,
		&c.TimeoutMs, &c.Remark, &c.BasicInfo, &c.LastProbeAt, &c.LastStatus, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	c.Headers = map[string]string{}
	if headers != "" && headers != "{}" {
		_ = json.Unmarshal([]byte(headers), &c.Headers)
	}
	return &c, nil
}

// ListWebshells 全部连接(新在前)。
func (s *ShellStore) ListWebshells() ([]*WebshellConn, error) {
	rows, err := s.db.DB.Query(`SELECT ` + webshellCols + ` FROM shell_webshells ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*WebshellConn
	for rows.Next() {
		c, err := scanWebshell(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetWebshell 取单条连接。
func (s *ShellStore) GetWebshell(id string) (*WebshellConn, error) {
	row := s.db.DB.QueryRow(`SELECT `+webshellCols+` FROM shell_webshells WHERE id = $1`, id)
	return scanWebshell(row)
}

// SaveWebshell 新建/更新连接(nil 字段沿用现值;密码空串=保持原值)。
func (s *ShellStore) SaveWebshell(c *WebshellConn) (*WebshellConn, error) {
	if strings.TrimSpace(c.URL) == "" {
		return nil, fmt.Errorf("%w: url 不能为空", ErrInvalidInput)
	}
	if c.Headers == nil {
		c.Headers = map[string]string{}
	}
	headers, _ := json.Marshal(c.Headers)
	existing, err := s.GetWebshell(c.ID)
	present := err == nil && existing != nil
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if present {
		if c.Name == "" {
			c.Name = existing.Name
		}
		if c.Protocol == "" {
			c.Protocol = existing.Protocol
		}
		if c.ShellLang == "" {
			c.ShellLang = existing.ShellLang
		}
		if c.ExecMode == "" {
			c.ExecMode = existing.ExecMode
		}
		if c.PassParam == "" {
			c.PassParam = existing.PassParam
		}
		if c.CmdParam == "" {
			c.CmdParam = existing.CmdParam
		}
		if c.Password == "" {
			c.Password = existing.Password
		}
		if c.SecretKey == "" {
			c.SecretKey = existing.SecretKey
		}
		if c.Method == "" {
			c.Method = existing.Method
		}
		if c.Encoding == "" {
			c.Encoding = existing.Encoding
		}
		if c.DbEncoding == "" {
			c.DbEncoding = existing.DbEncoding
		}
		if c.OS == "" {
			c.OS = existing.OS
		}
		if c.Kind == "" {
			c.Kind = existing.Kind
		}
		if c.HeadersJSON == "" && len(c.Headers) == 0 {
			headers = []byte(existing.HeadersJSON)
		}
		if c.TimeoutMs == 0 {
			c.TimeoutMs = existing.TimeoutMs
		}
		_, err = s.db.DB.Exec(`UPDATE shell_webshells SET name=$2, url=$3, protocol=$4, shell_lang=$5, exec_mode=$6,
			pass_param=$7, cmd_param=$8, password=$9, secret_key=$10, method=$11, encoding=$12, db_encoding=$13,
			os=$14, kind=$15, headers_json=$16, timeout_ms=$17, remark=$18, updated_at=now() WHERE id=$1`,
			c.ID, c.Name, c.URL, c.Protocol, c.ShellLang, c.ExecMode, c.PassParam, c.CmdParam, c.Password, c.SecretKey,
			c.Method, c.Encoding, c.DbEncoding, c.OS, c.Kind, string(headers), clampTimeout(c.TimeoutMs, 3000, 120000, 20000), c.Remark)
	} else {
		_, err = s.db.DB.Exec(`INSERT INTO shell_webshells (id, name, url, protocol, shell_lang, exec_mode, pass_param,
			cmd_param, password, secret_key, method, encoding, db_encoding, os, kind, headers_json, timeout_ms, remark, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),now())`,
			c.ID, c.Name, c.URL, orDefault(c.Protocol, "cmd-system"), orDefault(c.ShellLang, "php"), orDefault(c.ExecMode, "system"),
			orDefault(c.PassParam, "pass"), orDefault(c.CmdParam, "cmd"), c.Password, c.SecretKey,
			orDefault(c.Method, "post"), orDefault(c.Encoding, "auto"), orDefault(c.DbEncoding, "auto"),
			orDefault(c.OS, "auto"), orDefault(c.Kind, "file"), string(headers), clampTimeout(c.TimeoutMs, 3000, 120000, 20000), c.Remark)
	}
	if err != nil {
		return nil, err
	}
	return s.GetWebshell(c.ID)
}

// DeleteWebshell 删除连接(联动档案)。
func (s *ShellStore) DeleteWebshell(id string) error {
	if _, err := s.db.DB.Exec(`DELETE FROM shell_webshell_db_profiles WHERE conn_id = $1`, id); err != nil {
		return err
	}
	_, err := s.db.DB.Exec(`DELETE FROM shell_webshells WHERE id = $1`, id)
	return err
}

// RecordWebshellProbe 探活回写。
func (s *ShellStore) RecordWebshellProbe(id, status, osName string, info json.RawMessage) error {
	if len(info) == 0 {
		info = json.RawMessage("{}")
	}
	if osName == "auto" {
		_, err := s.db.DB.Exec(`UPDATE shell_webshells SET basic_info=$2, last_probe_at=now(), last_status=$3, updated_at=now() WHERE id=$1`, id, string(info), status)
		return err
	}
	_, err := s.db.DB.Exec(`UPDATE shell_webshells SET basic_info=$2, last_probe_at=now(), last_status=$3, os=$4, updated_at=now() WHERE id=$1`, id, string(info), status, osName)
	return err
}

// ListDBProfiles 某连接的数据库档案。
func (s *ShellStore) ListDBProfiles(connID string) ([]*WebshellDBProfile, error) {
	rows, err := s.db.DB.Query(`SELECT id, conn_id, type, host, port, username, password, database, remark
		FROM shell_webshell_db_profiles WHERE conn_id = $1 ORDER BY created_at`, connID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*WebshellDBProfile
	for rows.Next() {
		var p WebshellDBProfile
		if err := rows.Scan(&p.ID, &p.ConnID, &p.Type, &p.Host, &p.Port, &p.Username, &p.Password, &p.Database, &p.Remark); err != nil {
			return nil, err
		}
		out = append(out, &p)
	}
	return out, rows.Err()
}

// GetDBProfile 取单条档案。
func (s *ShellStore) GetDBProfile(id string) (*WebshellDBProfile, error) {
	row := s.db.DB.QueryRow(`SELECT id, conn_id, type, host, port, username, password, database, remark
		FROM shell_webshell_db_profiles WHERE id = $1`, id)
	var p WebshellDBProfile
	if err := row.Scan(&p.ID, &p.ConnID, &p.Type, &p.Host, &p.Port, &p.Username, &p.Password, &p.Database, &p.Remark); err != nil {
		return nil, err
	}
	return &p, nil
}

// SaveDBProfile 新建/更新档案(密码空串=保持原值)。
func (s *ShellStore) SaveDBProfile(p *WebshellDBProfile) (*WebshellDBProfile, error) {
	existing, err := s.GetDBProfile(p.ID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if existing != nil {
		if p.Password == "" {
			p.Password = existing.Password
		}
		if p.Type == "" {
			p.Type = existing.Type
		}
		_, err = s.db.DB.Exec(`UPDATE shell_webshell_db_profiles SET type=$2, host=$3, port=$4, username=$5, password=$6, database=$7, remark=$8 WHERE id=$1`,
			p.ID, p.Type, p.Host, p.Port, p.Username, p.Password, p.Database, p.Remark)
	} else {
		if p.ID == "" {
			p.ID = "db_" + randomHex(6)
		}
		_, err = s.db.DB.Exec(`INSERT INTO shell_webshell_db_profiles (id, conn_id, type, host, port, username, password, database, remark, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
			p.ID, p.ConnID, orDefault(p.Type, "mysql"), p.Host, p.Port, p.Username, p.Password, p.Database, p.Remark)
	}
	if err != nil {
		return nil, err
	}
	return s.GetDBProfile(p.ID)
}

// DeleteDBProfile 删除档案。
func (s *ShellStore) DeleteDBProfile(id string) error {
	_, err := s.db.DB.Exec(`DELETE FROM shell_webshell_db_profiles WHERE id = $1`, id)
	return err
}

// InsertGeneration 登记生成产物。
func (s *ShellStore) InsertGeneration(name, lang, kind, ext, content string, meta any) (*WebshellGeneration, error) {
	id := "gen_" + randomHex(6)
	metaJSON, _ := json.Marshal(meta)
	if _, err := s.db.DB.Exec(`INSERT INTO shell_webshell_generations (id, name, lang, kind, ext, content, meta_json, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, id, name, lang, kind, ext, content, string(metaJSON)); err != nil {
		return nil, err
	}
	return &WebshellGeneration{ID: id, Name: name, Lang: lang, Kind: kind, Ext: ext, Meta: json.RawMessage(metaJSON)}, nil
}

// ListGenerations 产物清单(不含 content)。
func (s *ShellStore) ListGenerations() ([]*WebshellGeneration, error) {
	rows, err := s.db.DB.Query(`SELECT id, name, lang, kind, ext, meta_json, created_at FROM shell_webshell_generations ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*WebshellGeneration
	for rows.Next() {
		var g WebshellGeneration
		if err := rows.Scan(&g.ID, &g.Name, &g.Lang, &g.Kind, &g.Ext, &g.Meta, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &g)
	}
	return out, rows.Err()
}

// GetGeneration 取单条产物(含 content)。
func (s *ShellStore) GetGeneration(id string) (name, ext, content string, err error) {
	row := s.db.DB.QueryRow(`SELECT name, ext, content FROM shell_webshell_generations WHERE id = $1`, id)
	err = row.Scan(&name, &ext, &content)
	return
}

// DeleteGeneration 删除产物。
func (s *ShellStore) DeleteGeneration(id string) error {
	_, err := s.db.DB.Exec(`DELETE FROM shell_webshell_generations WHERE id = $1`, id)
	return err
}

const vshellCols = `id, name, base_url, username, password, timeout_ms, remark, last_status, last_check_at, last_error, created_at, updated_at`

func scanVshell(row interface{ Scan(...any) error }) (*VshellServer, error) {
	var v VshellServer
	if err := row.Scan(&v.ID, &v.Name, &v.BaseURL, &v.Username, &v.Password, &v.TimeoutMs, &v.Remark,
		&v.LastStatus, &v.LastCheckAt, &v.LastError, &v.CreatedAt, &v.UpdatedAt); err != nil {
		return nil, err
	}
	return &v, nil
}

// ListVshellServers 全部站点。
func (s *ShellStore) ListVshellServers() ([]*VshellServer, error) {
	rows, err := s.db.DB.Query(`SELECT ` + vshellCols + ` FROM shell_vshell_servers ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*VshellServer
	for rows.Next() {
		v, err := scanVshell(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetVshellServer 取单条站点。
func (s *ShellStore) GetVshellServer(id string) (*VshellServer, error) {
	row := s.db.DB.QueryRow(`SELECT `+vshellCols+` FROM shell_vshell_servers WHERE id = $1`, id)
	return scanVshell(row)
}

// SaveVshellServer 新建/更新站点(密码空串=保持原值)。
func (s *ShellStore) SaveVshellServer(v *VshellServer) (*VshellServer, error) {
	if strings.TrimSpace(v.BaseURL) == "" {
		return nil, fmt.Errorf("%w: base_url 不能为空", ErrInvalidInput)
	}
	existing, err := s.GetVshellServer(v.ID)
	present := err == nil && existing != nil
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if present {
		if v.Name == "" {
			v.Name = existing.Name
		}
		if v.Username == "" {
			v.Username = existing.Username
		}
		if v.Password == "" {
			v.Password = existing.Password
		}
		if v.TimeoutMs == 0 {
			v.TimeoutMs = existing.TimeoutMs
		}
		_, err = s.db.DB.Exec(`UPDATE shell_vshell_servers SET name=$2, base_url=$3, username=$4, password=$5,
			timeout_ms=$6, remark=$7, updated_at=now() WHERE id=$1`,
			v.ID, v.Name, v.BaseURL, v.Username, v.Password, clampTimeout(v.TimeoutMs, 5000, 300000, 30000), v.Remark)
	} else {
		if v.ID == "" {
			v.ID = "vs_" + randomHex(6)
		}
		_, err = s.db.DB.Exec(`INSERT INTO shell_vshell_servers (id, name, base_url, username, password, timeout_ms, remark, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())`,
			v.ID, v.Name, v.BaseURL, v.Username, v.Password, clampTimeout(v.TimeoutMs, 5000, 300000, 30000), v.Remark)
	}
	if err != nil {
		return nil, err
	}
	return s.GetVshellServer(v.ID)
}

// DeleteVshellServer 删除站点。
func (s *ShellStore) DeleteVshellServer(id string) error {
	_, err := s.db.DB.Exec(`DELETE FROM shell_vshell_servers WHERE id = $1`, id)
	return err
}

// MarkVshellServer 探活回写。
func (s *ShellStore) MarkVshellServer(id, status, errMsg string) error {
	_, err := s.db.DB.Exec(`UPDATE shell_vshell_servers SET last_status=$2, last_check_at=now(), last_error=$3, updated_at=now() WHERE id=$1`, id, status, errMsg)
	return err
}

// LogShellOp 记台账(失败不阻塞主流程)。
func (s *ShellStore) LogShellOp(scope, connID, action, detail string) {
	if len(detail) > 4000 {
		detail = detail[:4000]
	}
	_, _ = s.db.DB.Exec(`INSERT INTO shell_op_log (scope, conn_id, action, detail) VALUES ($1,$2,$3,$4)`, scope, connID, action, detail)
}

// ListShellOps 台账清单。
func (s *ShellStore) ListShellOps(connID string, limit int) ([]*ShellOpLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.db.DB.Query(`SELECT id, scope, conn_id, action, detail, created_at FROM shell_op_log
		WHERE conn_id = $1 ORDER BY id DESC LIMIT $2`, connID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ShellOpLog
	for rows.Next() {
		var l ShellOpLog
		if err := rows.Scan(&l.ID, &l.Scope, &l.ConnID, &l.Action, &l.Detail, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &l)
	}
	return out, rows.Err()
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func clampTimeout(v, lo, hi, def int) int {
	if v == 0 {
		v = def
	}
	if v < lo {
		v = lo
	}
	if v > hi {
		v = hi
	}
	return v
}
