# md2docx HTTP API 参考

Base URL：`http://<host>:<port>`（默认 `http://127.0.0.1:8080`）

- 上传用 `multipart/form-data`，其余端点返回 JSON
- 所有错误响应统一格式：`{ "error": { "code": "...", "message": "..." } }`
- 跨域：v1 默认同源（Web 页面与 API 同一服务）；跨域调用需自行加 `cors` 中间件

## 1. 健康检查

### `GET /api/health`

服务状态 + 运行时依赖（结果缓存 60 秒）。

**响应 200**

```json
{
  "status": "ok",
  "uptimeSec": 123,
  "deps": {
    "node":       { "ok": true, "version": "v24.15.0" },
    "chrome":     { "ok": true, "version": "chrome-headless-shell" },
    "java":       { "ok": true, "version": "openjdk version ..." },
    "graphviz":   { "ok": true, "version": "dot - graphviz version ..." },
    "python":     { "ok": true, "version": "Python 3.12.3" },
    "pythonDocx": { "ok": true, "version": "installed" }
  }
}
```

任一依赖缺失时 `status` 为 `degraded`，对应依赖 `ok: false`（图表仍会降级为代码块，不致命）。

## 2. 提交转换作业

### `POST /api/convert`

`multipart/form-data`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | 文件 | 是 | 扩展名须为 `.md`，大小 ≤ 20 MB，图表块数 ≤ 30 |
| `title` | 字符串 | 否 | 覆盖文档标题（**优先于 YAML**，见 §6） |
| `company` | 字符串 | 否 | 覆盖公司/部门 |
| `date` | 字符串 | 否 | 覆盖日期 |

**响应 202**

```json
{ "jobId": "8f2c1a4b9d3e5f60", "status": "queued" }
```

**错误**

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `NO_FILE` | 未上传文件 |
| 400 | `INVALID_EXTENSION` | 非 `.md` |
| 413 | `FILE_TOO_LARGE` | 超过 20 MB |
| 400 | `TOO_MANY_DIAGRAMS` | 图表块数超过 30 |
| 429 | `RATE_LIMITED` | IP 超过每分钟提交上限 |
| 429 | `QUEUE_FULL` | 队列已满 |

## 3. 查询作业

### `GET /api/jobs/:id`

**响应 200**

```json
{
  "id": "8f2c1a4b9d3e5f60",
  "status": "done",
  "progress": 100,
  "originalName": "手册.md",
  "overrides": { "title": "新标题", "company": "新公司" },
  "createdAt": 1725000000000,
  "startedAt": 1725000001000,
  "finishedAt": 1725000060000,
  "warnings": [],
  "error": null,
  "hasArtifact": true,
  "artifact": { "fileName": "手册.docx", "sizeBytes": 27383 },
  "logs": ["[预处理] 修正 YAML front matter", "..."]
}
```

**状态码**

| 状态码 | 场景 |
|---|---|
| 200 | 作业存在 |
| 404 | 作业不存在或已过期（TTL 默认 60 分钟） |

`status` 取值：`queued` / `running` / `done` / `failed`。`logs` 已脱敏（不含作业目录绝对路径）。`status=done` 且 `warnings` 非空表示有图表渲染降级（文档仍产出）。

### `GET /api/jobs?limit=20&offset=0`

作业列表（不含 logs），按创建时间倒序。`limit` 上限 100。

**响应 200**

```json
{ "jobs": [ { "id": "...", "status": "done", "progress": 100, ... } ], "limit": 20, "offset": 0, "total": 5 }
```

## 4. 下载产物

### `GET /api/jobs/:id/download`

下载生成的 `.docx`。作业须 `status=done`。

- 成功：`200`，`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `Content-Disposition: attachment; filename="<原名>.docx"`

**错误**

| 状态码 | code | 场景 |
|---|---|---|
| 404 | `NOT_FOUND` | 作业不存在 |
| 409 | `JOB_NOT_DONE` | 作业未完成（当前状态可见于 error.message） |
| 404 | `ARTIFACT_MISSING` | 产物文件丢失 |

### `GET /api/jobs/:id/clean`

下载预处理后的中间产物 `*.clean.md`（调试用）。状态约束与错误码同 `download`。

- 成功：`200`，`Content-Type: text/markdown; charset=utf-8`

## 5. 删除作业

### `DELETE /api/jobs/:id`

删除作业及工作目录（**幂等**）。若作业正在排队/运行，会先终止对应 worker 再清理，不留孤儿目录。

- 成功：`204 No Content`

## 6. 覆盖字段语义（`title` / `company` / `date`）

**表单参数优先于 YAML front matter（真覆盖）。**

**示例 1：上传文档已有 YAML，且传了 title 参数**

```text
# 上传的 document.md 顶部
---
title: 原标题
company: 原公司
date: 2026年1月
---
```

`POST /api/convert` 传 `title=新标题` → 生成的 docx 封面标题为 **新标题**。

**示例 2：无 YAML，传 title 参数**

文档无 YAML front matter → 传 `title` 即设为文档标题（否则取第一个 `#` 标题）。

## 7. 完整调用示例（curl）

```bash
# 1. 健康检查
curl http://127.0.0.1:8080/api/health

# 2. 上传转换
JOB=$(curl -s -X POST http://127.0.0.1:8080/api/convert \
  -F "file=@md/手册.md" -F "title=新标题" -F "company=新公司")
JOB_ID=$(echo "$JOB" | python3 -c "import sys,json;print(json.load(sys.stdin)['jobId'])")

# 3. 轮询（生产脚本请加退避）
until [ "$(curl -s http://127.0.0.1:8080/api/jobs/$JOB_ID | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")" = "done" ]; do sleep 2; done

# 4. 下载
curl -OJ http://127.0.0.1:8080/api/jobs/$JOB_ID/download

# 5. 清理
curl -X DELETE http://127.0.0.1:8080/api/jobs/$JOB_ID
```
