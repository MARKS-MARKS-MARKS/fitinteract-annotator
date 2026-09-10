# FitInteract Quick Annotator

FitInteract Quick Annotator 是一个无需构建的静态网页应用，支持两种互不混淆的工作方式：

- Offline Mode：打开本机视频并在浏览器内完成标注，数据保存在当前浏览器的 `localStorage`，通过 Blob 下载 JSON。
- Online Mode：在 HTTPS 静态站点登录 Supabase，领取管理员分配的任务，通过私有 Storage 的短期签名 URL 播放视频，并把草稿/提交结果保存到数据库。

标注 payload 始终保持以下结构：

```json
{
  "video_path": "SPRINT/long_context_clips/uuid__video.mp4",
  "query": [
    {
      "start_time_sec": 0.00,
      "text": "标注问题"
    }
  ],
  "annotation": [
    {
      "time_window_sec": { "start": 4.5, "end": 6 },
      "action": "[feedback]",
      "text": "反馈文本"
    }
  ]
}
```

`query` 从 v2 起是数组，并可包含多条 Query instance；每条 Query 只有一个 `start_time_sec`，不含 `end_time_sec`。`annotation[].time_window_sec` 仍然是 Response 的 `{start, end}` 时间窗口，结构没有改变。时间值最多保留两位小数。Online Mode 中 `video_path` 固定为 `videos.storage_path`，不会写入签名 URL 或本机路径。

当前 v3 示例文件位于 [`../download/fitinteract_data_structure.v3.template.json`](../download/fitinteract_data_structure.v3.template.json)。旧的 `fitinteract_data_structure.template.json` 和 v2 示例均保留不变，便于追溯旧数据格式。

## Query Timestamp

Query 表示用户在视频或连续交互中的一次发言/请求。每条 Query instance 由 `text` 和单个 `start_time_sec` 组成，只标记发言出现的开始位置，不标结束时间；目前需要的是用户请求在连续视频中的出现位置。由于一个视频未来可能包含多次发言，`query` 从一开始就采用数组。

Response annotation 的含义不同：它仍使用 `time_window_sec.start/end` 描述反馈所对应的完整时间窗口。Query 单点时间不会复用或改变 Response Start/End。

## Annotation Action

每条 Response annotation 现在严格包含 `time_window_sec`、`action` 和 `text`：

- `time_window_sec`：允许产生该响应的时间窗口。
- `action`：字符串形式的一个或多个连续行为标签，例如 `[feedback]` 或 `[inform][encourage]`；不会转换为数组，也不限制标签名称白名单。
- `text`：实际输出的语言内容，类型始终为字符串；无语言输出时允许保存为空字符串 `""`。

内置 action 只有 `[feedback]`，新建标注和载入旧的无-action 标注时都会默认使用该值。Action selector 与 Text Template 相互独立；action 不会写入 Text presets。Offline Mode 可以新增、更新和删除用户 Action presets：输入 `feedback` 会规范化为 `[feedback]`，输入 `inform, encourage`、`inform encourage`、`[inform][encourage]` 或 `[[inform]][[encourage]]` 都会规范化为 `[inform][encourage]`。组合 Action 仍保存在 `fitinteract_action_presets_v1` 中。内置 `[feedback]` 不能修改或删除；删除用户 preset 不会改变已经创建的 annotation。

## Offline Mode

直接双击 `index.html`，或访问部署地址的 `./index.html?mode=offline`。Offline Mode 保留原有功能：

- 用文件选择器选择本机视频，并通过 `URL.createObjectURL(file)` 播放；视频不上传。
- Timeline、Start/End、快捷键及 0.01 秒精度保持不变。
- Query、Text、Video Root presets 与草稿保存在 `localStorage`。
- 每个 Query instance 可通过当前播放时间、手工输入或 Timeline 的 `Query Time` 模式设置单个起始时刻；支持新增、定位、编辑、删除和按时间自动排序。
- Annotation 可新增、编辑、删除；JSON Preview 与 Blob 下载正常工作。

浏览器不会向网页暴露所选文件的真实 Windows 绝对路径。刷新页面后必须重新选择视频。`file://` 与 HTTPS 站点属于不同来源，两边的 `localStorage` 不会自动互通。

## Online Mode

Online Mode 面向多人协作，使用 Supabase Auth、Postgres、Row Level Security 与私有 Storage：

- 登录页没有注册入口；账号由管理员在 Supabase Dashboard 创建。
- 标注员只能看到自己的任务、自己的 annotation、已启用共享模板以及分配给自己的视频。
- 打开任务时，视频经短期签名 URL 播放；URL 不保存进 payload。
- 修改后约 2.2 秒防抖自动保存，也可手动保存；一个 task 对应一条 annotation 记录。
- Submit 会执行完整校验并把 task 更新为 `completed`。已提交任务再次编辑时页面会给出提示。
- 管理员可上传视频、批量分配任务、管理模板、查看进度、重置提交并导出 JSON/CSV。

Online Mode 需要先执行 [Supabase 部署指南](./supabase/README_SUPABASE.md)，再填写 `js/supabase-config.js`：

```js
window.FITINTERACT_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  videoBucket: "fitinteract-videos",
  signedUrlExpiresIn: 3600
};
```

这里只允许放 Supabase publishable key（或旧项目的 anon key）。绝不能放 `service_role`、secret key、数据库密码或任何管理员密钥。

## 在线部署（GitHub Pages）

本项目仍是纯静态网站：HTML + CSS + Vanilla JavaScript，不需要 Node.js server、Python、FastAPI、Flask 或自建后端。Online Mode 的云端能力由浏览器直接调用配置好的 Supabase 项目，并由 RLS 执行授权。

所有页面、脚本和样式均使用 `./` 相对路径，可部署在仓库子路径，例如：

```text
https://username.github.io/fitinteract-annotator/
```

若仓库专用于本工具，把 `web` 目录中的全部内容放到发布根目录：

```text
fitinteract-annotator/
├── index.html
├── login.html
├── admin.html
├── admin-upload.html
├── README.md
├── css/
├── js/
├── vendor/
└── supabase/
```

其中 `supabase/` 不是浏览器运行依赖，但建议随仓库保存以便审计和复现。GitHub Pages 选择默认分支的仓库根目录发布即可。若保留外层 `web/` 目录，则公开 URL 会相应多一层 `/web/`。

部署后：

- Offline Mode 选择的本地视频只存在于浏览器当前页面，不会上传。
- Offline presets/草稿仅保存在每个用户自己的浏览器；不同标注人员不会自动同步。
- Online 草稿、任务和统一模板会同步到配置的 Supabase 项目，但仍受账号与 RLS 隔离。
- Offline JSON 由每个人自行下载保存；Online 提交可由管理员统一导出，标注员仍可使用本地 JSON 下载作为备份。

## 隐私与网络依赖

Offline Mode 的所有视频与标注均在浏览器本地处理，不会上传服务器。

Online Mode 是显式的协作模式：管理员选择上传的视频会发送到配置的 Supabase 私有 Storage；标注草稿和提交结果会发送到该 Supabase 数据库。视频不会发送到 GitHub Pages、CDN、analytics、字体服务或其他第三方接口。

项目没有 CDN、在线字体或 analytics。Supabase JS `2.112.4` 与 tus-js-client `4.3.1` 已固定版本并保存在 `vendor/`，许可证与版本说明也在该目录。Online Mode 唯一的运行时外部服务是项目所有者自行配置的 Supabase；Offline Mode 不依赖网络。

## 标注操作

1. Offline Mode 选择本地视频；Online Mode 从自己的任务列表打开任务。
2. 选择或填写 Query，设置 `Query Start` 后点击“添加 Query”；同一视频可添加多条，列表会按时间排序。
3. Timeline 的三种模式互不混淆：`定位` 只跳转视频；`Response Window` 第一次点击设置 Response Start、第二次设置 Response End；`Query Time` 单击只设置当前 Query Start。橙色 `Q` 标记可拖动。
4. 选择或填写 Response/Text，新增或更新 annotation。Query 的单点时间和 Response 的起止窗口是两个独立概念。
5. 检查 JSON Preview。Offline 可下载 JSON；Online 可保存草稿或 Submit。

主要快捷键：

| 快捷键 | 操作 |
| --- | --- |
| Space | 播放/暂停 |
| S / E | 当前时间设为 Start / End |
| Q | 当前播放时间设为 Query Start |
| A | 新增或更新 annotation |
| R | 播放当前区间 |
| Ctrl + S | 校验并下载 JSON |
| Delete | 删除明确选中的 annotation（需确认） |
| ← / → | 后退/前进 0.01 秒 |
| Shift + ← / → | 后退/前进 0.10 秒 |

## 本地存储

Offline Mode 使用这些版本化键：

- `fitinteract_query_presets_v1`
- `fitinteract_text_presets_v1`
- `fitinteract_action_presets_v1`
- `fitinteract_video_roots_v1`
- `fitinteract_video_path_history_v1`
- `fitinteract_settings_v1`
- `fitinteract_draft_v1`
- `fitinteract_presets_schema_version`（当前为 `2`）
- `fitinteract_presets_migration_backup_v1`（首次升级前的自动保护快照）
- `fitinteract_draft_query_migration_backup_v1`（发现旧 `query:string` 草稿时的原始备份）

原有 Query/Text/Video Root/settings 键名保持不变。页面首次执行 schema v2 保护时，会先把旧键和原始字符串写入迁移快照；若快照无法成功写入，则停止迁移且不覆盖旧模板键。加载旧草稿中的 `query:string` 时，会兼容转换为 `[{"start_time_sec": 0, "text": "..."}]` 并显示提醒，供标注员确认时间。

“模板备份”区可将当前浏览器实际可见的 Query presets、Text presets、Action presets、Video Roots 和 settings 导出为 `FitInteractPresetBackup` v2 文件 `fitinteract_presets_backup.json`。其中 `action_presets` 是规范化后的字符串数组。导入固定使用 **MERGE**：现有数据优先，相同 ID 或“同名且同内容”跳过，同名但内容不同的 Query/Text 条目保留为两条；导入不会使用 replace，也不会调用 `localStorage.clear()`。旧的 v1 backup 没有 `action_presets` 时仍可正常导入，其余模板照常合并，当前 Action presets 保持不变。

`file://` 与 GitHub Pages/HTTPS 是不同来源，其 LocalStorage 不互通；从本地切换到线上前，请在原页面先导出模板备份，再到新站点导入。LocalStorage 不包含视频文件本身。清除浏览器站点数据会清除这些 presets、草稿与迁移快照。

## 项目结构

```text
web/
├── index.html                    # 双模式标注器
├── login.html                    # Email/password 登录
├── admin.html                    # 管理 Dashboard
├── admin-upload.html             # TUS 分片上传
├── css/
│   ├── style.css
│   └── admin.css
├── js/
│   ├── app.js                    # 原标注器与模式桥接
│   ├── video.js / timeline.js / annotation.js / query.js
│   ├── presets.js / json-export.js
│   ├── supabase-config.js / supabase-client.js / auth.js
│   ├── online-tasks.js / online-templates.js / online-annotations.js
│   ├── admin.js / admin-upload.js / export.js
│   └── login.js
├── vendor/                       # 固定版本浏览器 SDK（无 CDN）
└── supabase/
    ├── schema.sql
    ├── rls.sql
    ├── seed.sql
    └── README_SUPABASE.md
```

## 安全边界与限制

- 前端代码和 publishable key 都是公开的；安全性必须由数据库 RLS、GRANT、Storage policy 和受控 RPC 保证。
- 私有视频的签名 URL 在有效期内属于临时访问凭证，不应分享；默认有效期 1 小时。
- 上传页面必须保持打开直到队列完成。上传失败项可利用 TUS 指纹续传；若仅数据库登记失败，重试不会重复上传文件。
- 浏览器支持 MP4 容器不代表支持其内部编解码；推荐 H.264/AAC。
- 数据库对已存在任务的视频拒绝物理删除；管理员应优先使用“归档”。
