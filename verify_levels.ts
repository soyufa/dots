import { LevelRepository } from './src/core/levels/LevelData';
import { PuzzleValidator } from './src/core/levels/PuzzleValidator';
import { PuzzleAnalyzer, PuzzleMetrics } from './src/core/levels/PuzzleAnalyzer';
import { GameRules } from './src/core/rules/GameRules';
import { BoardConfig, DifficultyLevel, StageData } from './src/types/stage';
import { LineSegment, Point2D } from './src/types/geometry';

/**
 * 150개 스테이지 전수 정합성 + 난이도 감사
 *  1) 정합성: 정답 경로가 실제 게임 규칙(선 두께 간격, 점 금지 영역, 테두리)을 모두 만족 → 풀이 가능 증명
 *  2) 가치: 모든 쌍을 직선으로 이어도 풀리는 "무가치" 스테이지 0개
 *  3) 난이도: 스테이지별 최소 요구치(강제 우회 수, 감싸기 깊이) 충족, 난이도 간 단조 증가
 *  4) 중복: 동일한 점 배치의 스테이지 없음
 */

const difficulties: DifficultyLevel[] = ['easy', 'normal', 'hard'];
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`  [실패] ${msg}`);
};

const signature = (s: StageData) =>
  s.dots
    .flatMap((d) => [d.pointA, d.pointB])
    .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
    .sort()
    .join('|');

/** 벽 점 p 의 바로 뒤(테두리 쪽)를 테두리 허용선(선 두께 절반 안쪽)을 따라 지나가는 선분 */
function sneakBehind(board: BoardConfig, p: Point2D): LineSegment {
  const span = 0.06;
  if (board.type === 'circle') {
    const ang = Math.atan2(p.y - board.centerY, p.x - board.centerX);
    const r = board.radius - GameRules.WALL_INSET;
    const da = span / board.radius;
    const at = (a: number) => ({ x: board.centerX + r * Math.cos(a), y: board.centerY + r * Math.sin(a) });
    return { p1: at(ang - da), p2: at(ang + da) };
  }
  const b = board.bounds;
  const inset = GameRules.WALL_INSET;
  const gaps = [p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y];
  const side = gaps.indexOf(Math.min(...gaps));
  if (side === 0) return { p1: { x: b.minX + inset, y: p.y - span }, p2: { x: b.minX + inset, y: p.y + span } };
  if (side === 1) return { p1: { x: b.maxX - inset, y: p.y - span }, p2: { x: b.maxX - inset, y: p.y + span } };
  if (side === 2) return { p1: { x: p.x - span, y: b.minY + inset }, p2: { x: p.x + span, y: b.minY + inset } };
  return { p1: { x: p.x - span, y: b.maxY - inset }, p2: { x: p.x + span, y: b.maxY - inset } };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const summary: Record<string, { score: number; forced: number; wrap: number; pairs: number; chords: number }> = {};
const seen = new Map<string, string>();
const t0 = Date.now();

for (const diff of difficulties) {
  console.log(`\n[${diff.toUpperCase()}]`);
  const metrics: PuzzleMetrics[] = [];

  for (let i = 1; i <= LevelRepository.STAGES_PER_DIFFICULTY; i++) {
    const stage = LevelRepository.getStage(diff, i)!;
    const plan = LevelRepository.planStage(diff, i);
    const m = PuzzleAnalyzer.analyze(stage);
    metrics.push(m);

    const errors = PuzzleValidator.validate(stage);
    errors.forEach((e) => fail(`${stage.stageId} 정합성: ${e}`));

    if (plan.minForced > 0 && m.trivial) fail(`${stage.stageId}: 직선 연결만으로 풀리는 무가치 스테이지`);
    if (m.forcedBends < plan.minForced) fail(`${stage.stageId}: 강제 우회 ${m.forcedBends} < 요구 ${plan.minForced}`);
    if (m.maxWrap < plan.minWrap) fail(`${stage.stageId}: 감싸기 깊이 ${m.maxWrap} < 요구 ${plan.minWrap}`);

    // 가림벽 검사: 벽에 붙은 점마다, 테두리를 따라 그 점 뒤로 지나가는 선이 실제 입력 규칙에 의해 차단되는지
    const board = stage.board!;
    for (const d of stage.dots) {
      for (const p of [d.pointA, d.pointB]) {
        if (!GameRules.blocksWallPassage(board, p, d.radius)) continue;
        const behind = sneakBehind(board, p);
        if (!GameRules.segmentHitsForeignDot(behind.p1, behind.p2, stage.dots, '__other__')) {
          fail(`${stage.stageId} ${d.pairId}: 벽 점 뒤로 선이 빠져나갈 수 있음`);
        }
      }
    }

    const sig = signature(stage);
    if (seen.has(sig)) fail(`${stage.stageId}: ${seen.get(sig)} 와 동일한 배치`);
    seen.set(sig, stage.stageId);

    if (i === 1 || i % 10 === 0) {
      console.log(
        `  ${stage.stageId} ${stage.board!.type.padEnd(6)} 쌍=${m.pairs} 가림벽=${m.chords} ` +
          `강제우회=${m.forcedBends} 감싸기=${m.maxWrap} 막힌쌍=${m.blockedPairs} 점수=${m.score}`
      );
    }
  }

  const firstHalf = metrics.slice(0, 25).map((m) => m.score);
  const secondHalf = metrics.slice(25).map((m) => m.score);
  if (avg(secondHalf) <= avg(firstHalf)) fail(`${diff}: 후반부 난이도가 전반부보다 높지 않음`);

  summary[diff] = {
    score: avg(metrics.map((m) => m.score)),
    forced: avg(metrics.map((m) => m.forcedBends)),
    wrap: avg(metrics.map((m) => m.maxWrap)),
    pairs: avg(metrics.map((m) => m.pairs)),
    chords: avg(metrics.map((m) => m.chords))
  };
}

console.log('\n================ 난이도 요약 (평균) ================');
for (const d of difficulties) {
  const s = summary[d];
  console.log(
    `${d.padEnd(7)} 쌍 ${s.pairs.toFixed(1)} | 가림벽 ${s.chords.toFixed(1)} | 강제우회 ${s.forced.toFixed(1)} | ` +
      `감싸기 ${s.wrap.toFixed(1)} | 점수 ${s.score.toFixed(1)}`
  );
}
if (!(summary.easy.score < summary.normal.score && summary.normal.score < summary.hard.score)) {
  fail('난이도 평균 점수가 easy < normal < hard 순서가 아님');
}

console.log(`\n생성 시간: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(failures === 0 ? '>>> 150개 스테이지 정합성/난이도 검증 통과 <<<' : `>>> 검증 실패 ${failures}건 <<<`);
if (failures > 0) process.exit(1);
