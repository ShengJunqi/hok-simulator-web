// Run from any directory: node web/simulator/sync-info-panels.mjs
// Only writes this feature's static snapshots; never edits the source banks.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = new URL('../../', import.meta.url);
const digest = text => createHash('sha256').update(text).digest('hex');
async function source(path, json = false) {
  try {
    const text = await readFile(new URL(path, root), 'utf8');
    return {source:path, availability:'available', sha256:digest(text), data:json ? JSON.parse(text.replace(/^\uFEFF/, '')) : text};
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return {source:path, availability:error.code === 'ENOENT' ? 'missing' : 'invalid', sha256:null, data:null};
  }
}

export async function buildInfoBundle(server) {
  if (!['cn', 'hok'].includes(server)) throw new Error('Unknown server');
  const [scoring, economy, command, dragon] = await Promise.all([
    source(`data/simulator/parameters/${server}/scoring_v1.json`, true),
    source(`data/simulator/parameters/${server}/economy_v1.json`, true),
    source('handoff/CMD_W1_20261110.md'),
    source('handoff/CODEX_DRAGON_WOLVES_TTG_20261110.md'),
  ]);
  const categories = ['集合', '开团', '撤退', '换线/转线', '资源', '视野', '保人'];
  const commandCards = (command.data || '').split(/\r?\n/).filter(line => line.startsWith('|')).flatMap(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    return categories.includes(cells[0]) ? [{category:cells[0], condition:cells[1], template:cells[2], source:command.source}] : [];
  });
  const paragraphs = (dragon.data || '').split(/\r?\n\r?\n/).map(s => s.trim());
  const excerpt = prefix => paragraphs.find(s => s.startsWith(prefix)) || null;
  const dragonCards = [
    ['start', '开龙', '先核对到场、兵线、技能、惩击、入口与退路；无争夺窗口不足时另评争夺。', '开龙前：'],
    ['turn', '转开', '确认目标脱节与增援时间；击杀并撤离不能晚于敌方回包。', '候选变量按'],
    ['trade', '换龙 / 换资源', '确认另一目标存在，路径安全，完成与撤退早于敌方转场。', '换龙：'],
    ['concede', '放龙', '正面条件不足时保清线和基地，记录实际换得的资源，再评接团。', '放龙：'],
    ['steal', '抢龙', '确认龙状态可观察、入坑路径、惩击或爆发，以及失败代价。', '放龙：'],
    ['reset', '撤退 / 重评', '人数、技能、视野或线压力变化时重新判断；未知输入保持待标定。', 'dragon：'],
  ].filter(([, , , prefix]) => excerpt(prefix)).map(([id, title, description, prefix]) => ({id, title, description, evidence:excerpt(prefix), source:dragon.source}));
  return {
    protocol:'hok-info-panels-v1', server, label:'静态资料 / 合成演示', scoring, economy,
    command:{source:command.source, sha256:command.sha256, availability:command.availability, cards:commandCards},
    dragon:{source:dragon.source, sha256:dragon.sha256, availability:dragon.availability,
      ordinary:excerpt('开龙前：'), storm:excerpt('风暴龙更具决定性'), cards:dragonCards},
  };
}

if (import.meta.main) {
  for (const server of ['cn', 'hok']) {
    const bundle = await buildInfoBundle(server);
    const destination = new URL(`data/info-${server}.json`, import.meta.url);
    await writeFile(destination, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
    console.log(`${fileURLToPath(destination)}: scoring=${bundle.scoring.availability}, economy=${bundle.economy.availability}, commands=${bundle.command.cards.length}, dragon=${bundle.dragon.cards.length}`);
  }
}
