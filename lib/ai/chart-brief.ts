/**
 * 把命盘对象压成一段紧凑文本，供 LLM 阅读（服务端专用）
 *
 * 目标是「结构化 + 省 token」：十二宫按地支顺序、每宫单行，
 * 星曜分组带亮度与四化，另附大限四化、流年四化、格局判定。
 */
import 'server-only';

import { BRANCHES, STEMS } from '../ziwei/constants';
import { getDaXianSiHua, getLiuNianSiHua } from '../ziwei/sihua';
import { detectPatterns } from '../ziwei/patterns';
import type { Palace, Star, ZiweiChart } from '../ziwei/types';

const LEVEL_LABEL: Record<string, string> = {
  excellent: '大吉',
  good: '吉',
  neutral: '平',
  caution: '需留意',
};

function shichenRange(hourIndex: number): string {
  const start = (hourIndex * 2 + 23) % 24;
  const end = (start + 2) % 24;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(start)}:00-${pad(end)}:00`;
}

function starLabel(star: Star): string {
  const bits: string[] = [star.name];
  if (star.brightnessRaw) bits.push(`(${star.brightnessRaw})`);
  if (star.siHua) bits.push(`化${star.siHua}`);
  return bits.join('');
}

function groupStars(stars: Star[]): string {
  const pick = (type: Star['type']) => stars.filter(s => s.type === type).map(starLabel);
  const major = pick('major');
  const lucky = pick('lucky');
  const sha = pick('sha');
  const minor = pick('minor');

  const parts: string[] = [];
  parts.push(major.length ? `主星 ${major.join(' ')}` : '主星 无（空宫）');
  if (lucky.length) parts.push(`吉星 ${lucky.join(' ')}`);
  if (sha.length) parts.push(`煞星 ${sha.join(' ')}`);
  if (minor.length) parts.push(`杂曜 ${minor.join(' ')}`);
  return parts.join('｜');
}

function palaceLine(chart: ZiweiChart, palace: Palace): string {
  const parts: string[] = [];
  parts.push(`${BRANCHES[palace.branch]}·${palace.name}`);
  parts.push(groupStars(palace.stars));

  if (palace.isEmpty) {
    const borrowed = palace.borrowedFromName
      ? `借对宫 ${BRANCHES[(palace.branch + 6) % 12]}·${palace.borrowedFromName}`
      : '借对宫';
    const stars = palace.borrowedStars?.length ? `（${palace.borrowedStars.join(' ')}）` : '';
    parts.push(`空宫${borrowed}${stars}`);
  }

  if (palace.selfSihua?.length) {
    parts.push(`自化 ${palace.selfSihua.map(s => `${s.starName}化${s.siHua}`).join(' ')}`);
  }

  if (palace.daXianAge) {
    parts.push(`大限 ${palace.daXianAge[0]}-${palace.daXianAge[1]}`);
  }

  const flags: string[] = [];
  if (palace.isMingGong) flags.push('命宫');
  if (palace.isShenGong) flags.push('身宫');
  if (palace.isCurrentDaXian) flags.push('当前大限');
  if (flags.length) parts.push(`【${flags.join('/')}】`);

  return parts.join('｜');
}

function palaceByBranch(chart: ZiweiChart, branch: number): Palace | undefined {
  return chart.palaces.find(p => p.branch === ((branch % 12) + 12) % 12);
}

/** 命宫三方四正：命、财帛(三合)、官禄(三合)、迁移(对宫) */
function sanFangSiZheng(chart: ZiweiChart): string {
  const ming = chart.palaces.find(p => p.isMingGong) ?? palaceByBranch(chart, chart.mingGongBranch);
  if (!ming) return '';
  const branches = [
    ming.branch,
    (ming.branch + 4) % 12,
    (ming.branch + 8) % 12,
    (ming.branch + 6) % 12,
  ];
  return branches
    .map(b => {
      const p = palaceByBranch(chart, b);
      if (!p) return '';
      const majors = p.stars.filter(s => s.type === 'major').map(starLabel);
      return `${BRANCHES[b]}·${p.name}（${majors.join(' ') || '空宫'}）`;
    })
    .filter(Boolean)
    .join('、');
}

export function buildChartBrief(chart: ZiweiChart): string {
  const { birthInfo, lunarInfo } = chart;
  const lines: string[] = [];

  // ── 基本信息 ──
  const date = `${birthInfo.year}-${String(birthInfo.month).padStart(2, '0')}-${String(birthInfo.day).padStart(2, '0')}`;
  lines.push('【盘主】');
  lines.push(
    `公历 ${date} ${BRANCHES[birthInfo.hour]}时（${shichenRange(birthInfo.hour)}）· ${birthInfo.gender === 'male' ? '男' : '女'} · ${chart.yinYangGender ?? ''}`,
  );
  if (birthInfo.city || birthInfo.province) {
    lines.push(`出生地 ${[birthInfo.province, birthInfo.city].filter(Boolean).join(' ')}`);
  }
  const leap = lunarInfo.isLeapMonth ? '闰' : '';
  lines.push(`农历 ${STEMS[lunarInfo.yearStem]}${BRANCHES[lunarInfo.yearBranch]}年 ${leap}${lunarInfo.lunarMonth}月${lunarInfo.lunarDay}日`);
  if (lunarInfo.fourPillars?.length) {
    lines.push(`四柱（节气） ${lunarInfo.fourPillars.join(' ')}`);
  }
  if (lunarInfo.fourPillarsLunar?.length) {
    lines.push(`四柱（农历口径） ${lunarInfo.fourPillarsLunar.join(' ')}`);
  }
  lines.push(
    `五行局 ${chart.wuxingJuName} · 命主 ${chart.mingZhu ?? '—'} · 身主 ${chart.shenZhu ?? '—'} · 紫微在${BRANCHES[chart.ziweiPos]}`,
  );
  lines.push(
    `命宫在${BRANCHES[chart.mingGongBranch]} · 身宫在${BRANCHES[chart.shenGongBranch]} · 当前虚岁 ${chart.currentAge}`,
  );
  lines.push('');

  // ── 十二宫 ──
  lines.push('【十二宫】（地支·宫名｜星曜）');
  for (const p of chart.palaces) lines.push(palaceLine(chart, p));
  lines.push('');

  // ── 命宫三方四正 ──
  const sf = sanFangSiZheng(chart);
  if (sf) {
    lines.push('【命宫三方四正】');
    lines.push(sf);
    lines.push('');
  }

  // ── 大限 ──
  const dxLines: string[] = [];
  chart.daXians.forEach((dx, i) => {
    const sihua = getDaXianSiHua(chart, i);
    const marks: string[] = [];
    if (i === chart.currentDaXianIndex) marks.push('★当前大限');
    if (chart.currentAge >= dx.startAge && chart.currentAge <= dx.endAge) marks.push('（年龄落在本限）');
    const stem = sihua?.stemName ? `${sihua.stemName}干` : '';
    const tr = sihua
      ? `禄${sihua.transforms['禄']} 权${sihua.transforms['权']} 科${sihua.transforms['科']} 忌${sihua.transforms['忌']}`
      : '';
    dxLines.push(
      `${dx.startAge}-${dx.endAge} ${dx.palaceName}（${BRANCHES[dx.palaceBranch]}${stem ? `·${stem}` : ''}）${tr ? ` 四化 ${tr}` : ''} ${marks.join('')}`.trim(),
    );
  });
  lines.push('【大限】');
  lines.push(...dxLines);
  lines.push('');

  // ── 流年四化 ──
  const year = new Date().getFullYear();
  const liuNian = getLiuNianSiHua(year);
  lines.push('【流年】');
  lines.push(
    `${year}年（${liuNian.stemName}干）流年四化：禄${liuNian.transforms['禄']} 权${liuNian.transforms['权']} 科${liuNian.transforms['科']} 忌${liuNian.transforms['忌']}`,
  );
  lines.push('');

  // ── 格局 ──
  let patterns: ReturnType<typeof detectPatterns> = [];
  try {
    patterns = detectPatterns(chart);
  } catch {
    patterns = [];
  }
  if (patterns.length) {
    lines.push('【已识别格局】');
    for (const p of patterns.slice(0, 12)) {
      const level = LEVEL_LABEL[p.level] ?? p.level;
      const desc = p.description ? `：${p.description}` : '';
      const src = p.source ? `（${p.source}）` : '';
      lines.push(`- ${p.name}【${level}】${desc}${src}`);
    }
  }

  return lines.join('\n');
}

/** 合盘：两张盘 + 重点宫位（命/夫妻/福德） */
export function buildHemingBrief(chartA: ZiweiChart, chartB: ZiweiChart): string {
  const focus = (chart: ZiweiChart, label: string) => {
    const picked = ['命宫', '夫妻', '福德']
      .map(name => chart.palaces.find(p => p.name === name))
      .filter((p): p is Palace => Boolean(p))
      .map(p => `${BRANCHES[p.branch]}·${p.name}｜${groupStars(p.stars)}`);
    return `${label} 重点宫位：\n${picked.join('\n')}`;
  };

  return [
    '=== 甲方 ===',
    buildChartBrief(chartA),
    focus(chartA, '甲方'),
    '',
    '=== 乙方 ===',
    buildChartBrief(chartB),
    focus(chartB, '乙方'),
  ].join('\n');
}
