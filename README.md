# SkyRoute · 无人机航线规划与禁飞区可视化工具

项目 5：一个使用 **React + Vite + TypeScript** 构建的二维无人机航线规划工作台，配套 **Node.js + Express + TypeScript** 内存 REST API。

## 已实现功能

- 二维坐标画布：100 × 70 km 的坐标网格、主/次网格线、坐标刻度和北向指示。
- 航线节点编辑：设置起点、终点，点击添加航点，侧栏可删除航点。
- 禁飞区绘制：点击放置矩形禁飞区，逐点绘制并完成多边形禁飞区。
- 基础路径生成：按「起点 → 航点列表 → 终点」顺序生成折线路径。
- 路径校验：检查节点是否越界、航段是否与禁飞多边形/矩形区域相交；风险航段使用红色虚线高亮。
- 时间有效的空域规则：每个禁飞区可配置生效时间、失效时间、时区和来源说明；规划员选择计划起飞时间后，校验结果会逐项说明区域当前有效、尚未生效、已过期或无法确认，画布上同步淡化未生效/已过期区域、以点线警示时效未确认区域。
- 距离计算：实时计算航线总距离，并展示航段数量。
- 方案管理：通过 REST API 保存、读取和删除方案；当前使用进程内存存储，服务重启后数据清空。
- 纯 TypeScript：前端与后端均没有使用纯 JavaScript 源文件。

## 目录结构

```text
.
├── backend/
│   ├── src/
│   │   ├── geometry.ts
│   │   ├── server.ts
│   │   ├── store.ts
│   │   ├── timeRules.ts
│   │   └── types.ts
│   ├── tests/
│   │   └── timeRules.test.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   ├── geometry.ts
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   ├── timeRules.ts
│   │   └── types.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── .gitignore
└── package.json
```

## 运行方式

当前仅完整落盘，**未安装依赖**。准备运行时，在项目根目录执行：

```bash
npm install
npm run dev
```

- 前端：<http://localhost:5173>
- 后端：<http://localhost:4000>
- 健康检查：<http://localhost:4000/api/health>

生产构建：

```bash
npm run build
npm start
```

## REST API

### `GET /api/plans`

返回当前进程内保存的所有方案。

### `GET /api/plans/:id`

返回指定方案。

### `POST /api/plans`

创建或更新方案。更新时带上 `id`，最小请求结构如下：

```json
{
  "name": "厂区巡检",
  "canvas": { "width": 100, "height": 70 },
  "departureTime": "2026-09-26T08:00",
  "departureTimeZone": "Asia/Shanghai",
  "start": { "x": 10, "y": 55 },
  "end": { "x": 90, "y": 15 },
  "waypoints": [{ "x": 32, "y": 40 }],
  "noFlyZones": [
    {
      "id": "zone-1",
      "name": "施工区",
      "kind": "rectangle",
      "points": [
        { "x": 40, "y": 20 },
        { "x": 60, "y": 20 },
        { "x": 60, "y": 35 },
        { "x": 40, "y": 35 }
      ],
      "color": "#fb7185",
      "schedule": {
        "effectiveFrom": "2026-09-25T22:00",
        "effectiveTo": "2026-09-26T10:00",
        "timeZone": "Asia/Shanghai",
        "source": "NOTAM A0234/26"
      }
    }
  ]
}
```

响应中会附带 `validation`，包含 `valid`、`distance`、`issues`、`evaluatedAt`（起飞时刻换算后的 UTC 时间）和 `zoneTimeReports`（每个区域的时效判定）。

### `POST /api/validate`

只校验不保存。请求体与 `POST /api/plans` 相同（`canvas`、`start`、`end` 必填），返回 `{ "validation": … }`，便于值班人员在保存前核对某个起飞窗口下的路线可用性。

### `DELETE /api/plans/:id`

删除指定方案。

## 时效空域规则

每个禁飞区可携带可选的 `schedule`：

| 字段 | 含义 |
| --- | --- |
| `effectiveFrom` | 生效时间，`YYYY-MM-DDTHH:mm` 墙上时间，按 `timeZone` 解释；缺省表示不设下限 |
| `effectiveTo` | 失效时间，格式同上；缺省表示不设上限 |
| `timeZone` | IANA 时区名，如 `Asia/Shanghai` |
| `source` | 来源说明，如 NOTAM 编号、管制通告名称 |

方案级字段 `departureTime` / `departureTimeZone` 表示计划起飞时间。校验时每个区域会被判定为：

- **当前有效（active）**：起飞时刻处于生效窗口内，参与拦截；
- **尚未生效（not-yet-active）**：起飞时刻早于生效时间，本次不拦截；
- **已过期（expired）**：起飞时刻不早于失效时间，本次不拦截；
- **时间无效（invalid）**：时间范围无效（失效不晚于生效）或无法解析，保守按有效处理；
- **无法确认（unknown）**：未配置时间、缺少时区或未设置起飞时间，保守按有效处理。

关键语义（前后端 `timeRules.ts` 同构实现，判定只依赖输入数据，不读取系统时间，离线编辑与后端结果一致）：

- 生效窗口为 `[effectiveFrom, effectiveTo)`：生效含边界、失效不含边界；
- 跨午夜窗口用完整日期时间表达（如 `22:00` → 次日 `02:00`），按绝对时间轴判定；
- 夏令时拨快产生的不存在时间顺延到之后第一个真实时刻；回拨产生的重复时间固定取第一次出现；
- **「未配置时间」不会被静默当成「永不过期」**：缺少时间信息的旧方案、旧数据一律标记为「无法确认」并继续拦截，直到规划员补全时间或确认移除；
- 多个来源的区域在同一空域重叠时各自独立判定，按方案中的顺序逐项报告，不做合并。

运行时效规则测试：

```bash
npm test
```

## 说明

当前的路径生成器是基础折线规划器，不会自动绕过障碍物；当路径穿越禁飞区时，会在画布和右侧校验卡片中明确标出风险。后续可以在此基础上接入 A*、可见图或 RRT 等避障算法。
