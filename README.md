# SkyRoute · 无人机航线规划与禁飞区可视化工具

项目 5：一个使用 **React + Vite + TypeScript** 构建的二维无人机航线规划工作台，配套 **Node.js + Express + TypeScript** 内存 REST API。

## 已实现功能

- 二维坐标画布：100 × 70 km 的坐标网格、主/次网格线、坐标刻度和北向指示。
- 航线节点编辑：设置起点、终点，点击添加航点，侧栏可删除航点。
- 禁飞区绘制：点击放置矩形禁飞区，逐点绘制并完成多边形禁飞区。
- 基础路径生成：按「起点 → 航点列表 → 终点」顺序生成折线路径。
- 路径校验：检查节点是否越界、航段是否与禁飞多边形/矩形区域相交；风险航段使用红色虚线高亮。
- 时间有效的空域规则：每个禁飞区可配置多个生效时间窗口（生效/失效时间、IANA 时区、来源说明）；选择计划起飞时间后，校验结果按「当前有效 / 已过期或未生效 / 无法确认」三档分桶，画布与侧栏同步呈现。
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
│   │   ├── time.ts
│   │   ├── time.test.ts
│   │   └── types.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   ├── geometry.ts
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   ├── time.ts
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

时间规则的边界场景（跨午夜、夏令时、边界时刻、无效范围、多来源重叠）由后端测试覆盖：

```bash
npm test          # node --test，运行 backend/src/time.test.ts
npm run typecheck # 前后端 TypeScript 检查
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

创建或更新方案。更新时带上 `id`，请求结构如下（时间相关字段均可选）：

```json
{
  "name": "厂区巡检",
  "canvas": { "width": 100, "height": 70 },
  "start": { "x": 10, "y": 55 },
  "end": { "x": 90, "y": 15 },
  "waypoints": [{ "x": 32, "y": 40 }],
  "departureTime": "2026-09-26T23:30:00+08:00",
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
      "timeWindows": [
        {
          "effectiveFrom": "2026-09-26T22:00",
          "effectiveUntil": "2026-09-27T02:00",
          "timezone": "Asia/Shanghai",
          "source": "NOTAM A0124 夜间施工"
        }
      ]
    }
  ]
}
```

响应中会附带 `validation`，包含：

- `valid` / `distance` / `issues`：整体结论、总距离与风险项；`issues[].type` 新增 `no-fly-zone-unconfirmed`（穿越时间未确认的区域，按有效保守处理）。
- `departureTime`：本次校验使用的计划起飞时间（原样回显）。
- `zones`：按起飞时刻对禁飞区的三档分桶——`active`（当前有效）、`inactive`（已过期或尚未生效）、`unknown`（时间缺失或无效，无法确认）；每项含 `reasons`（逐窗口判定说明）与 `activeSources`（多个来源重叠时全部列出）。

### `POST /api/plans/validate`

不落盘校验。请求体与 `POST /api/plans` 相同（无需 `name`），`departureTime` 可随请求覆盖，便于值班人员直接查询某个起飞窗口下路线是否可用。响应为 `{ "validation": … }`，结构同上。

### `DELETE /api/plans/:id`

删除指定方案。

## 时间有效的空域规则

前后端各有一份逻辑完全一致的实现（`backend/src/time.ts` 与 `frontend/src/time.ts`，修改需同步），离线编辑与后端校验结论相同。语义约定：

- **窗口结构**：每个禁飞区可配置多个时间窗口（`timeWindows`），各窗口可注明不同来源（`source`），判定取并集——任一窗口在起飞时刻生效，区域即生效，且所有生效来源都会列出。
- **半开区间**：窗口为 `[effectiveFrom, effectiveUntil)`。起飞时刻等于生效时间视为有效，等于失效时间视为已失效，边界时刻没有歧义。只写一端表示该方向不限；两端都缺的窗口按无效处理。
- **时区**：带显式偏移（`Z` 或 `±08:00`）的时间直接按偏移解析；不带偏移的本地时间必须提供 IANA 时区（如 `Asia/Shanghai`），否则该窗口无效。计划起飞时间一律要求带偏移。
- **夏令时**：本地时间落在夏令时“空档”（不存在）时顺延到下一个有效时刻；落在回拨重复时段时取第一次出现（较早的 UTC 瞬间）。两种情况都会写入判定说明，不会静默处理。
- **无效即不可确认**：失效时间早于或等于生效时间、无法识别的时区、不存在的日期等，都使对应窗口无效；区域存在无效窗口且没有任何生效窗口时，状态为「无法确认」，而**不是**已过期。
- **不静默兜底**：未配置时间窗口的旧方案、未设置计划起飞时间、窗口无效，一律进入「无法确认」分桶；航线穿越这类区域时按有效保守处理并明确标注，绝不会把“未配置时间”悄悄当成“永不过期”。旧格式方案（无 `departureTime` / `timeWindows` 字段）无需迁移即可正常读取。

## 说明

当前的路径生成器是基础折线规划器，不会自动绕过障碍物；当路径穿越禁飞区时，会在画布和右侧校验卡片中明确标出风险。后续可以在此基础上接入 A*、可见图或 RRT 等避障算法。
