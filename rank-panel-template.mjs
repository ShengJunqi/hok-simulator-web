// Presentation for N4's two-mode contract; no alternative model schema.
export const rankPanelTemplate = `
  <div class="panel-heading">
    <div class="section-heading"><span class="section-number">06</span><h2 id="rankTitle">比赛 / 排位打法模拟</h2></div>
    <span class="tag warning">合成 / 未校准</span>
  </div>
  <p class="rank-intro">调整五路英雄与打法占比，观察四个阶段的经济与资源变化。所有过程与概率均为模型内合成演示，参数待标定。</p>
  <div class="rank-layout">
    <form id="rankForm" class="rank-form" novalidate>
      <div class="field-pair rank-mode-fields">
        <label for="rankServer">独立参数库<select id="rankServer"><option value="cn">国服 CN</option><option value="hok">国际服 HOK</option></select></label>
        <label for="rankMode">模式<select id="rankMode" disabled></select></label>
      </div>
      <fieldset><legend>五路英雄 <span class="muted">· 文本输入</span></legend><div id="rankHeroes" class="rank-heroes"></div></fieldset>
      <p class="tiny muted">姓名本身不赋予能力加成。阶段评分、逐英雄经济 / 等级差与对手缺参时，战力保持待标定。</p>
      <details id="rankCombatInputs" class="rank-combat-inputs"><summary>战力、破晓与风暴场景输入</summary>
        <p class="tiny muted">以下均为显式场景假设，合成 / 未校准。空白表示未知，不按姓名猜分、不补中间档、不按团队经济推断买装。</p>
        <div id="rankScenarioButtons" class="rank-scenario-buttons"></div>
        <div id="rankCombatFields"></div>
        <button id="rankClearCombat" type="button">清空战斗参数</button>
      </details>
      <fieldset><legend>六类打法占比 <span class="muted">· 合成先验</span></legend><div id="rankStyles"></div></fieldset>
      <div class="rank-total-row"><output id="rankTotal" aria-live="polite">合计待标定</output><button id="rankReset" type="button" disabled>恢复模式先验</button></div>
      <p id="rankValidation" class="rank-validation" role="status" aria-live="polite"></p>
      <div class="field-pair"><label for="rankRuns">运行次数<input id="rankRuns" type="number" min="1" max="1000" step="1" value="100" required></label><label for="rankSeed">起始 seed<input id="rankSeed" type="number" min="0" max="2147483647" step="1" value="7" required></label></div>
      <button id="rankRun" class="primary" type="submit" disabled>运行打法过程模拟 →</button>
      <div class="rank-buttons"><button id="rankCancel" type="button" disabled>取消</button><button id="rankReload" type="button">重新加载参数</button></div>
      <progress id="rankProgress" value="0" max="100" aria-label="模式模拟进度" hidden></progress>
      <p id="rankStatus" class="status" role="status" aria-live="polite">正在读取合成参数…</p>
      <p id="rankError" class="error" role="alert" hidden></p>
      <p class="tiny muted">浏览器本地运行 · 无应用后端。红方使用同模式的打法先验；对手战力需要显式阵容与参数。</p>
    </form>
    <div class="rank-output">
      <p id="rankEmpty" class="empty">选择比赛 / 排位与打法，运行后查看过程。</p>
      <div id="rankResults" hidden>
        <p id="rankMeta" class="result-meta"></p>
        <p id="rankInterpretation" class="rank-interpretation" aria-live="polite"></p>
        <div class="rank-chart-heading"><h3>经济差过程</h3><span class="tiny muted">蓝方 − 红方 · 均值 / P10–P90</span></div>
        <svg id="rankChart" viewBox="0 0 680 245" role="img" aria-label="四阶段合成经济差过程折线"></svg>
        <div class="rank-table-wrap" tabindex="0" role="region" aria-label="阶段末快照，可横向滚动"><table class="rank-table"><caption>阶段末快照 · 模型内 / 未校准<span class="rank-scroll-hint">窄屏可左右滑动明细，键盘聚焦后用方向键。</span></caption><thead><tr><th>阶段</th><th>经济差均值</th><th>P10–P90</th><th>首 seed 塔差 / 龙差</th></tr></thead><tbody id="rankPhases"></tbody></table></div>
        <h3>战力与关键节点 <span class="tag warning">合成 / 待标定</span></h3>
        <div id="rankCombatSummary" class="rank-combat-summary"></div>
        <div class="rank-table-wrap" tabindex="0" role="region" aria-label="战力与关键节点，可横向滚动"><table class="rank-table"><caption>首 seed · 10分钟破晓 / 后续成型 / 20分钟风暴<span class="rank-scroll-hint">窄屏可左右滑动查看正面人数等列。</span></caption><thead><tr><th>时刻</th><th>蓝 / 红原始战力</th><th>蓝 / 红有效战力</th><th>战力差</th><th>蓝 / 红破晓</th><th>正面人数</th></tr></thead><tbody id="rankCombatTimeline"></tbody></table></div>
        <details class="rank-calibration rank-evidence"><summary>战力、装备、高地 / 带线 / 诱饵与映射依据</summary><pre id="rankCombatEvidence"></pre></details>
        <div class="rank-probability">
          <div><h3>胜率分布 <span class="tag warning">模型内 / 未校准</span></h3><strong id="rankProbability">待标定</strong><p id="rankProbabilityRange" class="small muted"></p><p class="tiny muted">汇总每次过程末段的 128 个概率扰动样本；区间描述合成采样波动，不包含全部参数不确定性。运行次数不是实测样本量。</p></div>
          <svg id="rankHistogram" viewBox="0 0 320 155" role="img" aria-label="模型内未校准概率分布"></svg>
        </div>
        <div class="rank-chart-heading"><h3>塔 / 龙 / 关键事件时间轴</h3><span class="tiny muted">首个 seed 的完整过程</span></div>
        <div class="rank-events-grid"><div id="rankTimeline" class="rank-timeline"></div><div id="rankEvidence" class="rank-evidence" aria-live="polite"></div></div>
        <details class="rank-calibration rank-evidence"><summary>完整首 seed 过程与账本（含双方基础发育事件）</summary><pre id="rankFullEvidence"></pre></details>
        <h3 class="rank-comeback-title">翻盘路径候选 <span class="tag">接口占位 / 待标定</span></h3>
        <div id="rankComebacks" class="rank-comebacks"></div>
        <details class="rank-calibration"><summary>合成参数来源与待标定项</summary><p id="rankSource" class="tiny muted"></p><ul id="rankPending"></ul></details>
      </div>
    </div>
  </div>`;
