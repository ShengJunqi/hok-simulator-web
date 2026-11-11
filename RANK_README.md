# 比赛 / 排位打法模拟

已按 Jason 的最终口径接入 N4 `mode-process-v2`。仅保留 `competitive`（比赛 / 对标荣耀）、`ranked`（排位 / 对标低星王者）；旧模式键明确拒绝。CN、HOK 参数独立，所有过程、战力、概率均为**合成 / 模型内 / 未校准**。

启动原有 `scripts/serve_simulator.py` 后访问 `http://127.0.0.1:8765/#rankPanel`。浏览器 Worker 本地计算，无应用后端。

## 使用

1. 选择比赛或排位，填写五路英雄，调整六类打法滑条；合计必须为 100%，不会自动归一化。切模式保留当前占比，点击“恢复模式先验”才覆盖。
2. 在“战力、破晓与风暴场景输入”填写双方各英雄的四阶段评分、经济 / 等级基准差、对手阵容、破晓观察和风暴条件。空白保持未知；姓名不赋予能力，阶段缺分不补中间档，团队账本不推断出装。
3. 可显式点击“破晓延迟 / 单边高地 / 带线补偿 / 假开 / 停手示例”填入合成参数。示例会使用双方阶段 2 档、经济 / 等级差 0、蓝方 600 秒破晓、红方 660 秒破晓，页面有明确说明。
4. 设置 1–1000 次与起始 seed，运行或取消。切服清空英雄、战斗输入与结果；本面板的服务区选择独立于旧面板。

## N4 接口与语义

- 权威来源为 Python `rank_profiles.py`、`process.py`、`winprob2.py`、`comeback.py`；采用 `MODES/get_mode_profile/mode_profiles`，不另建过程 schema。
- `build_rank_data.py` 导出两服 `data/rank-*.json`，含两模式 profile、参数、系数、阶段、标签和源码 SHA256。版本为 `mode-process-v2 / synthetic-mode-v2 / mode-demo-v2`。
- `rank-core.mjs` 的 `simulateProcess(bundle, request)` / `simulateBatch(bundle, request)` 沿用 N4 参数名。UI 百分数除以 100 后传入 `fight/farm/macro/group/split/roam_gank`。
- `rank-combat.mjs` 对齐 `team_fight_power`、`adc_dawn_state`、`storm_fight_state`。600 秒启用破晓节点，1200 秒启用风暴；带线补偿按移速与清线能力较小值，带线和回防不重复扣人，正面战力按人数 / 5 缩放。
- 假开 / 停手是无龙奖励、无龙账本结算的分支；不编造反开战斗收益。胜率映射包含经济、战力差、高地、偷家压力四项。
- 随机过程对齐 CPython 整数 seed、MT19937、53 位随机数和缓存 gauss；资源竞争对齐 Fraction 限分母；账本用十进制累计。
- 测试逐字段比较事件、账本、时间轴、战力、概率分布和缺参集合。非浮点字段精确匹配，浮点容差 `1e-9 × max(1, |期望值|)`。
- 不读取冻结四库。执行器支持显式传入、限定 scope/version 的评分数据；网页默认仅使用显式阶段评分。破晓价格、出装阈值仍为待标定，不能从示例倍率推断实际装备效果。

## 输出

经济图为每分钟批次均值与 P10–P90，按 0–4 / 4–10 / 10–20 / 20+ 展示；未知时点留空，不补零。首 seed 的塔龙时间轴可展开事件、参数与账本，另有完整首 seed 过程（包括基础发育）。

战力区展示原始 / 有效战力、10 分钟与 11 分钟破晓状态、20 分钟风暴节点、高地优势、带线补偿、偷家压力、正面人数及诱饵动作；依据面板提供映射各项。概率汇总每次过程的 128 个合成扰动样本，显示均值与 P5/P50/P95；运行次数不是实测样本量。缺参则显示待标定，翻盘候选卡片继续占位。

结果区开头的“结果解读”用一句话串起末段经济差均值、蓝方模型内胜率均值及 P5–P95 区间，并指向首 seed 塔龙事件账本和经济 / 战力 / 高地 / 偷家压力映射依据；只展示现有计算结果，缺参仍显示待标定。

## 视觉与窄屏使用（N6）

模式名称完整显示；输入、结果卡片按 rank 面板自身宽度换行，适配页面侧栏仍在的 768px 视口。五路英雄、六滑条、100% 校验及运行次数 / seed 保留。经济折线随面板宽度重绘，刻度保持约 11px；阶段明细、战力节点与战斗参数表可局部横向滚动，支持键盘聚焦后用方向键，不撑宽页面。

headless Edge 已在 **1440×1000 / 768×1000 / 390×1000** 下检查比赛与排位两种模式，并保存面板长图和输入 / 过程 / 胜率 / 翻盘卡视口图。另检查 390px 展开战斗输入、缺参和切至 HOK 的状态。所有检查保留合成、模型内、未校准与翻盘占位标识；禁用文案扫描通过。截图位于 `handoff/N6_visual_after/`，结构化检查见该目录 `review.json`，修改前对照见 `handoff/N6_visual_before/`。

## 复现与验证

在项目根目录执行；`python` 需指向可用解释器，对照测试亦可用 `RANK_PYTHON` 指定路径：

```powershell
python web/simulator/build_rank_data.py
$nodeTests = Get-ChildItem -Path tools/simulator_web_tests,web/simulator/tests,tests -Filter '*.test.mjs' -File | Sort-Object FullName | Select-Object -ExpandProperty FullName
node --test @nodeTests
node web/simulator/rank-example.mjs
```

当前三目录完整集为 **77项**：`tools/simulator_web_tests` 40 + `web/simulator/tests` 31（rank 17＋新增研究面板14）+ `tests` 独立micro 6。研究面板14项覆盖分页、搜索、缺失、冲突、来源、重试/超时/过期响应与文本安全；[AUDIT收尾](../../handoff/AUDIT_node_final_20261110.log)及[FIX报告](../../handoff/FIX_REPORT_20261110.md)记录复验。

N6 视觉修改后历史两目录 Node / DOM **57/57** 通过（rank 17、旧面板40），漏列独立micro 6，当时完整集应为63；新增研究面板后两目录为71。N6的 Python **431/431** 是该批快照，后续X2新增31项成为462。原日志和断言保留。DOM 使用已有 jsdom 和实际 Worker 线程，含 Python ↔ JS 逐字段对照，覆盖原 app/minimap/micro 共存、取消、切服、缺参、恶意结果和 N4 节点变化。N4 正式例子的完整字段对照通过。N6 headless Edge 视觉检查 **68/68** 为独立浏览器检查数，不计入上述Node集。

视觉检查复现（需原静态服务运行，Windows 已安装 Edge，Node 支持内置 WebSocket）：

```powershell
node handoff/N6_visual_qa.mjs after
$env:PYTHONPATH='src'
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -X utf8 -m unittest discover -s tests -v
```

本轮证据：`handoff/N6_node_tests_20261110.log`、`handoff/N6_python_tests_20261110.log`、`handoff/N6_RANK_VISUAL_REPORT_20261110.md`。N2 原报告保持原样，视觉验收作为 N6 补充交接。

`rank-example.mjs` 写入 `handoff/N2_rank_example_20261110.json`：CN / 比赛 / seed42 / 1260 秒，63 个事件、51 笔账目、末段经济差 +1138，与 N4 正式过程一致。交接、日志和 SHA 核验见 `handoff/N2_RANK_SIM_REPORT_20261110.md`、`handoff/N2_mode_verification_20261110.json`。核心变动后须重新导出并重跑对照；源码 SHA 检查防止旧参数包冒充当前版本。
