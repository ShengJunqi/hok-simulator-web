# X3

`data/research/ingest/templates/` 内四套CSV/JSON各有一行 `is_example=true`，示例不算采集；`schemas/` 定义字段约束及判重键。

1. A `annual_patch`：每英雄每项技能/属性调整一行，多条件/方向拆行。date为发布日期，effective_date为生效日；server=cn/hok；patch_env=live/test/preview/rumor。年度窗按生效日 `(2025-11-10,2026-11-10]`。
2. B `yueai_evidence`：每秒码、英雄、分路、指标一行；tier/metric拆两列，梯度行tier=value且unit=tier；率用%。frame为截图路径/ID，quote保留原话；核过原音画才填audio_verified=true。附版本、分段、统计适用日；TO.5不猜为T0.5。
3. C `susu_scope`：按人群/模式/分段/版本/统计窗分行。fetched_at带时区；sample_size是对应样本数，非英雄数。率0–100（50=50%），不自动换算；early/mid/late为对象或unknown，definition写阶段边界/分母；Ban数组、缺失原因放notes。
4. D `jason_supplement`：A字段加source=Jason、status=待核、raw_text原文。也收TXT，一文件一条；只提取 `hero:值` 等英文标签（支持中文冒号），其余unknown，原文完整保留。

复制模板到ingest/incoming，替换占位内容再改is_example=false。必填列不删，空/null无效；未查明填允许的unknown。CSV用UTF-8，逗号/换行/JSON须正确引用，复杂内容宜用JSON。交文件、来源URL/BV、秒码及截图/音画附件；脚本不核附件存在或事实真伪。

根目录PowerShell：
```powershell
$py='C:\Users\jason\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
& $py scripts/ingest_patch_data.py --kind A data/research/ingest/templates/annual_patch.json
```
默认dry-run不写文件：stdout候选JSONL、stderr报告。B/C/D换kind；多文件一起传可判重。暂存时追加 `--write --output-dir data/research/ingest/runs/jason_01`。仅允许新批次目录，输出normalized.jsonl、errors.json。任一错误整批阻止候选输出，退出码2；成功0。示例仅在报告预览，JSONL为空属预期；不覆盖旧批次。

合并hero_prior/hero_strength须人工核身份、来源、日期、版本/环境，关联重复转述、冲突和回调；正式/体验服及CN/HOK隔离。月爱核原音画、秒码、姓名归属及同版本分路分段；苏苏核统计窗、样本、分母和阶段边界。未知/低可信/驳回/示例不作数值依据。D独立复核后另建A行，保留草稿关联。批次另记审核人、日期、证据和采用理由；字段通过或“已核”均不授权入模，合并由库负责人另审执行。脚本无生产写入能力。
