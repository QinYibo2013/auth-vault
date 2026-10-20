# 私人验证码网站 · Cloudflare Pages 版

入口只有一个密码框和“确定”按钮。解锁后可添加账号、查看/复制动态验证码、导入/导出加密备份。所有设备使用同一个网站和解锁密码。此项目不需要 Google 登录密码，也不能自动读取 Google Authenticator 云端账号。

## 部署到 Cloudflare（推荐 GitHub 自动部署）

### 1. 创建数据库

在 Cloudflare 控制台创建一个 D1 数据库，例如 `auth-vault-db`。
打开该数据库的 SQL 控制台，执行本项目 `schema.sql` 中的全部内容。这只会创建本项目的表和空保险箱，不会导入任何账号。

### 2. 上传源码到 GitHub

新建一个自己的私有 GitHub 仓库，将解压后的项目内容上传到仓库根目录。
根目录应能直接看到 `functions`、`public`、`schema.sql` 和 `package.json`，不要只上传 ZIP，也不要只上传 `public`。
代码中没有预设密码、Google 账号或任何真实密钥。

### 3. 创建 Cloudflare Pages 项目

在 Workers & Pages 中创建 Pages 项目，连接上面的 GitHub 仓库。

- 框架预设：None
- 构建命令：`npm run build`
- 构建输出目录：`public`
- 根目录：留空（项目文件位于仓库根目录时）

### 4. 配置服务器密码和数据库绑定

在 Pages 项目的设置里：

- 添加 Secret（加密环境变量）：名称 `SITE_PASSWORD`，值填写你自己的专用解锁密码，至少 12 个字符。推荐使用长的随机密码或口令。不要填写 Google 登录密码，也不要把密码写进仓库。
- 添加 D1 数据库绑定：变量名必须为 `DB`，选择第一步创建的数据库。
- 以上配置添加到 Production / 生产环境。

保存后重新部署一次。在完成这些配置前，页面会提示网站尚未配置完成。
预览环境如果需要使用，应绑定独立的测试数据库和测试密码；不要把生产保险箱绑定到预览分支。

### 5. 打开网站

打开 Pages 返回的 HTTPS 网址，输入第四步设置的密码，点击“确定”。首次成功登录会自动创建加密空保险箱。

在任意设备添加账号后，保存成功即写入服务器。其他已打开的设备会约每 20 秒检查一次更新；重新解锁会立即读取最新数据。离开页面或闲置 5 分钟自动上锁；服务端会话最长 30 分钟。

### 6. 迁移之前的账号

在旧网站中导出加密备份，再到新网站解锁后选择“导入备份”。
如果旧备份密码与服务器密码不同，页面会让你输入旧密码在本机解密，再用新网站的密码重新加密保存。导入会替换新网站中的全部账号，请先备份。

## 重要的使用说明

- 这是 TOTP 身份验证器，支持 6/8 位、SHA-1/SHA-256/SHA-512 和 15–120 秒周期；不是短信或邮件验证码接收服务。
- 数据在浏览器中通过 PBKDF2-SHA256（600000 次）派生密钥，再以 AES-256-GCM 加密；D1 保险箱表保存密文，不保存账号明文密钥。网站密码由 Cloudflare Secret 保存，登录时通过 HTTPS 发送至服务器校验。
- 同一 IP 在 15 分钟窗口内最多进行 10 次登录尝试；成功登录清除该 IP 的计数。
- 不要直接更改 `SITE_PASSWORD` 来更换密码，否则旧密文无法被新密码解密。若要更换：先导出备份并保留旧密码；停用网站或在维护时段操作，把数据库 `vault` 表的 `payload` 设为 NULL、`revision` 加一并清空 `sessions` 表；更改 Secret、重新部署；使用新密码打开空保险箱，再导入旧备份并输入旧密码。建议先保留完整 D1 导出以便恢复。
- 忘记密码无法从密文找回验证码密钥；请保留加密备份、解锁密码，以及原账号提供的恢复码。
- 登录失败、断网或保存失败时，页面会显示错误，不会假装保存成功。多设备同时修改发生冲突时会拒绝覆盖，重新锁定并解锁后再操作。

## 命令行部署（可选）

此项目不需要安装生产依赖。需要 Node.js 和 Wrangler。

```bash
npx wrangler login
npx wrangler pages project create auth-vault
npx wrangler pages secret put SITE_PASSWORD --project-name auth-vault
npx wrangler pages deploy public --project-name auth-vault
```

在部署前按上文创建 D1、执行 `schema.sql`，并在 Pages 控制台为该项目添加 `DB` 绑定。如果使用其他项目名，请同步修改命令中的项目名。

不要把它作为普通静态 ZIP 拖到 Pages 控制台上传；本项目包含 `functions` 后端，应使用 GitHub 集成或 Wrangler 部署。

本地调试可将 Secret 放进不提交的 `.dev.vars`，并通过 Wrangler 配置本地 D1；不要将 `.dev.vars`、Cloudflare Token 或数据库备份放入 `public`。

## 已验证与限制

在 Node.js 24 + SQLite 模拟的 D1 接口中通过：登录验证、跨站写入拒绝、尝试限流、服务器密文存取、跨设备读取、并发版本冲突、退出登录、会话过期及密码变更失效；验证码算法通过 6 个 RFC 6238 测试向量；加解密及错误密码拒绝测试通过。

尚未在用户的真实 Cloudflare 账户部署，也未进行真实浏览器与真实 D1 集成实测。

## 官方文档

- Pages D1 绑定：https://developers.cloudflare.com/pages/functions/bindings/#d1-databases
- Pages Git 集成：https://developers.cloudflare.com/pages/get-started/git-integration/
- Functions 的直接上传限制：https://developers.cloudflare.com/pages/get-started/direct-upload/

