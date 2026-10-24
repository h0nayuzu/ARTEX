// Package webshellproto 移植自 dsh-redteam-model 的 webshell 协议层(PHP 系通道)。
// HTTP 直连(自签放行/精确超时/多字符集解码)+ 按连接 Cookie 罐 + 各通道 codec。
package webshellproto

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

// Conn 是一次 webshell 连接的全部运行时参数(对应注册表里的连接行)。
type Conn struct {
	ID        string
	URL       string
	Protocol  string
	ShellLang string
	ExecMode  string
	PassParam string
	CmdParam  string
	Password  string
	SecretKey string
	Method    string // post|get
	Encoding  string // auto|utf-8|gbk|gb18030|big5|shift_jis|euc-jp
	OS        string // auto|linux|windows
	Kind      string // file|mem
	Headers   map[string]string
	TimeoutMs int
	// Scope 隔离 Cookie/会话态(探测时每协议独立 scope,避免串扰)
	Scope string
}

// scopeKey 返回 Cookie 罐与探测缓存的隔离键。
func (c *Conn) scopeKey() string {
	s := c.Scope
	if s == "" {
		s = c.ID
	}
	if s == "" {
		s = c.URL
	}
	return s + "@" + c.URL
}

// timeout 归一超时(1s..600s)。
func (c *Conn) timeout() time.Duration {
	ms := c.TimeoutMs
	if ms <= 0 {
		ms = 20000
	}
	if ms < 1000 {
		ms = 1000
	}
	if ms > 600000 {
		ms = 600000
	}
	return time.Duration(ms) * time.Millisecond
}

// =====================================================================
// HTTP 通道
// =====================================================================

// transport 一次性连接(Connection: close):规避 keep-alive 复用与部分目标容器
// (如 php -S 单线程)的响应边界错乱;自签/过期证书放行。
var transport = &http.Transport{
	DisableKeepAlives: true,
	TLSClientConfig:   &tls.Config{InsecureSkipVerify: true},
}

// HTTPResult 是一次原始请求的回应。
type HTTPResult struct {
	Status  int
	Headers http.Header
	Body    []byte
}

// HTTPDo 发送一次 HTTP 请求并读回全部字节。
func HTTPDo(method, rawURL string, headers map[string]string, body []byte, timeout time.Duration) (*HTTPResult, error) {
	if _, err := url.ParseRequestURI(rawURL); err != nil || !strings.HasPrefix(rawURL, "http") {
		return nil, fmt.Errorf("URL 无效:%s", rawURL)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rdr)
	if err != nil {
		return nil, err
	}
	req.Close = true
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if body != nil && req.Header.Get("Content-Length") == "" {
		req.ContentLength = int64(len(body))
	}
	resp, err := transport.RoundTrip(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("请求超时(%s)", timeout)
		}
		return nil, err
	}
	defer resp.Body.Close()
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return &HTTPResult{Status: resp.StatusCode, Headers: resp.Header, Body: buf}, nil
}

// charsetAliases 归一字符集名。
var charsetAliases = map[string]string{
	"utf-8": "utf-8", "utf8": "utf-8",
	"gbk": "gbk", "gb2312": "gbk", "gb18030": "gb18030",
	"big5": "big5", "shift_jis": "shift_jis", "sjis": "shift_jis", "euc-jp": "euc-jp",
}

// DecodeBody 把响应字节解成字符串。encoding=auto 时按 Content-Type charset。
func DecodeBody(buf []byte, encoding, contentType string) string {
	enc := strings.ToLower(strings.TrimSpace(encoding))
	if enc == "" || enc == "auto" {
		if m := findCharset(contentType); m != "" {
			enc = m
		} else {
			enc = "utf-8"
		}
	}
	enc = charsetAliases[enc]
	switch enc {
	case "", "utf-8":
		return string(buf)
	case "gbk":
		out, err := simplifiedchinese.GBK.NewDecoder().Bytes(buf)
		if err != nil {
			return string(buf)
		}
		return string(out)
	case "gb18030":
		out, err := simplifiedchinese.GB18030.NewDecoder().Bytes(buf)
		if err != nil {
			return string(buf)
		}
		return string(out)
	case "big5":
		out, err := traditionalchinese.Big5.NewDecoder().Bytes(buf)
		if err != nil {
			return string(buf)
		}
		return string(out)
	case "shift_jis":
		out, err := japanese.ShiftJIS.NewDecoder().Bytes(buf)
		if err != nil {
			return string(buf)
		}
		return string(out)
	case "euc-jp":
		out, err := japanese.EUCJP.NewDecoder().Bytes(buf)
		if err != nil {
			return string(buf)
		}
		return string(out)
	}
	return string(buf)
}

func findCharset(contentType string) string {
	lower := strings.ToLower(contentType)
	i := strings.Index(lower, "charset=")
	if i < 0 {
		return ""
	}
	rest := lower[i+len("charset="):]
	for j := 0; j < len(rest); j++ {
		c := rest[j]
		if !(c == '-' || c == '_' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z')) {
			return charsetAliases[rest[:j]]
		}
	}
	return charsetAliases[rest]
}

// =====================================================================
// Cookie 罐(会话通行证协议如 godzilla 需要跨请求保持)
// =====================================================================

type cookieJar struct {
	mu    sync.Mutex
	creds map[string]string
}

var cookieJars sync.Map // scope → *cookieJar

func jarOf(scope string) *cookieJar {
	v, _ := cookieJars.LoadOrStore(scope, &cookieJar{creds: map[string]string{}})
	return v.(*cookieJar)
}

// CookieHeaderFor 返回该 scope 当前 Cookie 头(无则空串)。
func CookieHeaderFor(scope string) string {
	j := jarOf(scope)
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.creds) == 0 {
		return ""
	}
	parts := make([]string, 0, len(j.creds))
	for k, v := range j.creds {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}

// AbsorbCookies 从 Set-Cookie 吸收 Cookie。
func AbsorbCookies(scope string, header http.Header) {
	for _, line := range header.Values("Set-Cookie") {
		pair := strings.SplitN(line, ";", 2)[0]
		eq := strings.Index(pair, "=")
		if eq <= 0 {
			continue
		}
		j := jarOf(scope)
		j.mu.Lock()
		j.creds[strings.TrimSpace(pair[:eq])] = strings.TrimSpace(pair[eq+1:])
		j.mu.Unlock()
	}
}

// ClearCookies 清掉某 scope 的会话态(连接删除/编辑后)。
func ClearCookies(scope string) { cookieJars.Delete(scope) }

// =====================================================================
// 编码/密码学助手
// =====================================================================

// B64 标准base64编码。
func B64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

// Unb64 标准base64解码。
func Unb64(s string) ([]byte, error) { return base64.StdEncoding.DecodeString(strings.TrimSpace(s)) }

// MD5Hex 返回 md5 十六进制(32位小写)。
func MD5Hex(s string) string {
	h := md5.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}

// MD5Raw 返回 md5 原始 16 字节。
func MD5Raw(s string) []byte {
	h := md5.Sum([]byte(s))
	return h[:]
}

// RandHex 生成 n 字节随机数的 hex。
func RandHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		for i := range b {
			b[i] = byte(i)
		}
	}
	return hex.EncodeToString(b)
}

// ProbeToken 生成探测回显 token。
func ProbeToken(prefix string) string {
	return prefix + strings.ToUpper(RandHex(4))
}

// ErrOutputTooBig 大输出保护(读文件/命令回显上限)。
var ErrOutputTooBig = errors.New("输出超过 8MB 上限——请改用分块或命令侧处理")
