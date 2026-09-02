# FitInteract Supabase 部署指南

本目录提供 FitInteract Online Mode 所需的数据库、RLS、Storage policy 与初始模板。网页仍部署在 GitHub Pages；Supabase 是唯一云端服务。以下操作需项目所有者在自己的 Supabase Dashboard 完成，本仓库不会自动创建项目、账号或上传视频。

## 从零操作顺序（12 Steps）

### Step 1：创建 Supabase Project

新建项目并等待 Database、Auth、Storage 就绪。

### Step 2：执行 `schema.sql`

在 SQL Editor 完整执行 `schema.sql`，创建表、约束、索引、trigger、view 与 private bucket。

### Step 3：执行 `rls.sql`

完整执行 `rls.sql`，启用 RLS，设置显式 GRANT/REVOKE、Storage policy 与受控 RPC。

### Step 4：执行 `seed.sql`

完整执行 `seed.sql`，只导入代码中原有的默认 Query/Text 共享模板。

### Step 5：确认 private bucket

在 Storage 确认 `fitinteract-videos` 存在且 Public bucket 已关闭。

### Step 6：在 Dashboard 创建用户

在 Authentication → Users 创建管理员和约 10 个标注员的 Email/Password 账号；网页不开放注册。

### Step 7：把管理员 profile 改为 admin

用本文后面的 SQL 按管理员邮箱把对应 `profiles.role` 改为 `admin`，其余用户保持 `annotator`。

### Step 8：取得 Project URL 与 Publishable Key

只取得可以公开给浏览器的 Project URL + publishable key（旧项目可用 anon key），不要取得或复制 service-role/secret key 到网页。

### Step 9：填写 `js/supabase-config.js`

替换两个 placeholder，bucket 名保留 `fitinteract-videos`。

### Step 10：先用 3～5 个视频测试

用管理员上传 3～5 个小规模测试视频，完成上传、分配、标注、草稿恢复、提交和导出闭环。不要批量扫描或上传原始大数据集。

### Step 11：部署 GitHub Pages

将 `web/` 内全部静态文件部署到仓库发布根目录，不需要服务器或构建步骤。

### Step 12：用真实 GitHub Pages URL 多人测试

分别使用 admin、标注员 A、标注员 B 登录真实 HTTPS 地址，按本文的 RLS 验收表和端到端清单验证跨账号隔离。

## 1. 创建 Supabase 项目

在 Supabase 新建项目并记录 Project URL。等待数据库与 Storage 初始化完成。生产使用前建议启用组织 MFA、保存数据库备份策略，并限定项目管理员数量。

## 2. 执行 SQL（顺序不可调换）

在 SQL Editor 依次完整执行：

1. `schema.sql`：表、约束、索引、触发器、视图、私有 bucket。
2. `rls.sql`：最小 GRANT、RLS、Storage policies 和受控 RPC。
3. `seed.sql`：初始共享 Query/Text 模板。

三个文件设计为可重复执行。修改结构后应先在测试项目验证再应用到正式项目。

## 3. 检查私有 Storage

打开 Storage，确认 bucket `fitinteract-videos` 存在且 `Public bucket` 为关闭状态。不要手工改成公开。对象路径由上传页生成：

```text
<dataset>/<category>/<uuid>__<sanitized_filename>
```

Dataset、Category 和文件名会拒绝 `..`、斜杠、反斜杠与控制字符。数据库还有第二层约束。

## 4. 配置 Authentication

在 Authentication 设置中：

- 使用 Email/Password provider。
- 关闭面向公众的 user sign-up；应用本身也没有注册页。
- 将 GitHub Pages 地址配置为 Site URL，例如 `https://username.github.io/fitinteract-annotator/`。
- 账号密码通过安全渠道单独发给标注员，要求首次登录后按团队策略更换。

本应用不需要 OAuth callback、邮件魔法链接或自定义后端。

## 5. 创建管理员与标注员账号

在 Authentication → Users 中创建 1 个管理员与所需标注员（例如 10 个）。`schema.sql` 的 `on_auth_user_created` trigger 会为每个 Auth user 自动创建 `profiles` 行，默认角色为 `annotator`。

创建完管理员账号后，在 SQL Editor 用其邮箱提升角色：

```sql
update public.profiles p
set role = 'admin',
    annotator_code = 'ADMIN-01',
    display_name = 'FitInteract Admin'
from auth.users u
where p.id = u.id
  and u.email = 'replace-admin@example.com';
```

为标注员设置稳定编号和显示名：

```sql
update public.profiles p
set annotator_code = 'A-001', display_name = 'Annotator 001'
from auth.users u
where p.id = u.id
  and u.email = 'replace-annotator@example.com';
```

不要让标注员成为 Supabase Dashboard 项目成员；他们只需要应用账号。

## 6. 获取浏览器可公开的 API 配置

在 Project Settings → API Keys 获取 Project URL 与 publishable key。旧项目若暂未显示 publishable key，可用 legacy anon key。编辑 `web/js/supabase-config.js`：

```js
window.FITINTERACT_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  videoBucket: "fitinteract-videos",
  signedUrlExpiresIn: 3600
};
```

禁止把下列内容写进仓库或浏览器：

- `service_role` key
- secret key
- 数据库密码/连接串
- Dashboard access token
- 用户密码

Publishable/anon key 本来就会出现在浏览器网络请求中，它只负责标识项目；真正的数据授权由 RLS 和用户 JWT 完成。

## 7. 本地静态检查

未配置 Supabase 时仍可双击 `index.html` 使用 Offline Mode。Online Mode 推荐通过 HTTPS 测试；可先部署到临时 GitHub Pages 分支，或使用任意只提供静态文件的本地开发服务器。项目不需要也不包含应用后端。

检查这些入口：

- `login.html`：无注册入口，错误密码有明确提示。
- `index.html?mode=online`：登录后只显示本人任务。
- `index.html?mode=offline`：本地视频、presets、JSON 下载仍正常。
- `admin.html` 与 `admin-upload.html`：非 admin 会被拒绝/跳转。

## 8. RLS 验证

SQL Editor 默认以高权限执行，会绕过 RLS。验证时应优先分别登录 admin、标注员 A、标注员 B，在浏览器 Network 与页面中检查实际结果。最低验收项：

| 身份 | 应允许 | 应拒绝/不可见 |
| --- | --- | --- |
| 未登录 | 登录页和静态资源 | 所有业务表、Storage 对象 |
| 标注员 A | 自己的 profile/tasks/annotations、enabled templates、分配视频签名 URL | B 的任务和结果、未分配视频、admin 页面、直接改 role/任务/annotation |
| 标注员 B | 与 A 对称 | A 的数据 |
| Admin | 全部管理数据、上传、分配、模板、导出、reset | 删除已有任务的视频 |

也可在 SQL Editor 用真实用户 UUID 做事务内模拟（结束必须 `rollback`）：

```sql
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"REPLACE_ANNOTATOR_UUID","role":"authenticated"}',
  true
);

select auth.uid();
select id, status from public.annotation_tasks order by created_at desc;
select task_id, status from public.annotations order by updated_at desc;
select id, storage_path from public.videos order by created_at desc;
select name from storage.objects where bucket_id = 'fitinteract-videos';

-- 以下语句应报权限/RLS错误；一次只测试一条，并用 savepoint 隔离错误：
-- update public.profiles set role = 'admin' where id = auth.uid();
-- update public.annotation_tasks set annotator_id = auth.uid();
-- update public.annotations set status = 'reviewed';
rollback;
```

注意：SQL 事务在某条语句报错后会进入 aborted 状态，所以拒绝测试应分别执行，或在每条前后使用 `savepoint` / `rollback to savepoint`。

## 9. 上传视频

以管理员登录 `admin-upload.html`，填写 Dataset 与 Category，多选本机视频后启动队列。上传实现使用固定版本 tus-js-client：

- 直接连接 Storage resumable endpoint。
- 6 MB 固定 chunk。
- 自动 retry delays：0、3、5、10、20 秒。
- `findPreviousUploads()` 恢复相同文件的未完成上传。
- Storage 上传成功后写入 `videos(status='ready')`。若数据库登记失败，队列保留对象路径并允许仅重试登记，不会重复上传文件。

浏览器只把当前登录用户的短期 access token 放在 TUS 请求头中。大文件不会整体读入 JavaScript 内存。

## 10. 分配与端到端验收

1. Admin 在 Dashboard 勾选视频，并分配给标注员。
2. 同一视频可分配给多个标注员；`unique(video_id, annotator_id)` 防止重复分配。
3. 标注员登录，只应看到自己的 task；打开后 `assigned` 自动变为 `in_progress` 并记录 `started_at`。
4. 修改 Query/annotation，等待自动保存，刷新页面确认草稿恢复。
5. Submit 后确认 task 为 `completed`、annotation 为 `submitted`，并记录时间。
6. Admin 查看详情、重置 task、导出全部 submitted JSON 与 CSV manifest。

Payload 必须精确包含 `video_path`、`query`、`annotation` 三个顶层键。服务器校验 `video_path = videos.storage_path`、时间非负且 `start < end`、最多两位小数；提交时 Query 与 annotation 不得为空。

## 11. 删除与归档策略

- 有任何 annotation task 的视频不能物理删除，数据库 trigger 与 RPC 会同时拒绝；使用 `archived` 保留审计链。
- 未分配视频可永久删除。Dashboard 先在一个带行锁的 RPC 中安全删除数据库记录，再清理 Storage 对象，避免并发分配造成“数据库仍引用但文件已删除”。
- 若数据库删除成功而 Storage 清理失败，页面会明确显示对象路径；管理员需在 Storage 中手工清理该孤立对象。
- 删除用户前先确认任务与审计保留需求。Auth user 删除会级联 profile；已有 task 对 annotator 的外键默认会阻止破坏性删除。

## 12. GitHub Pages 发布

把 `web/` 内全部文件放到 GitHub Pages 发布根目录，确保 `vendor/` 也提交。所有运行时路径均为 `./` 相对路径，仓库子路径部署可用。发布后逐项测试登录、任务、签名视频、保存、提交、上传和导出。

建议上线前：

- 在浏览器 DevTools 确认没有访问意外域名。
- 再次确认 Storage bucket 非公开。
- 用两个标注员账号交叉验证不可见性。
- 检查 Git 历史不存在 secret/service-role key。
- 固定 SDK 版本升级前先看 changelog，并在测试项目回归。

## 数据职责概览

| 数据 | Offline Mode | Online Mode |
| --- | --- | --- |
| 视频 | 当前页面的本地 File/Object URL | Supabase 私有 Storage + 短期签名 URL |
| presets | 当前浏览器 localStorage | 统一模板表（管理员维护） |
| 草稿 | 当前浏览器 localStorage | `annotations.payload`，防抖/手动 upsert |
| 最终结果 | 用户自行下载 JSON | submitted annotation；管理员统一导出 |
| 权限 | 本机页面边界 | Auth + GRANT + RLS + Storage policy + RPC |
