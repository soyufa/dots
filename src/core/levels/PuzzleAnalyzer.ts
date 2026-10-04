import { Point2D } from '../../types/geometry';
import { BoardConfig, DotPair, StageData } from '../../types/stage';
import { GameRules } from '../rules/GameRules';
import { Intersection } from '../physics/Intersection';
import { Vector2 } from '../math/Vector2';

/**
 * ============================================================================
 *  퍼즐 난이도 분석기 (위상 기반)
 * ============================================================================
 *  자유 곡선 게임에서 선은 얼마든지 휘어질 수 있으므로, "격자 경로의 꺾임 수" 같은
 *  지표는 실제 난이도와 무관하다. 실제로 플레이어를 막는 구조는 단 하나다.
 *
 *   - 벽-벽 쌍(Chord): 두 점이 모두 테두리에 밀착된 쌍. 이 선은 보드를 두 영역으로
 *     완전히 갈라놓는 "가림벽"이 된다 (점과 벽 사이로는 아무 선도 지나갈 수 없다).
 *   - 다른 쌍의 두 점이 이 Chord의 "직선" 기준으로 서로 반대편에 있다면, Chord는 절대
 *     직선으로 그을 수 없고 그 점을 감싸며 휘어야만 한다 → 강제 우회(Forced Bend).
 *
 *  내부 점이나 한쪽만 벽에 붙은 쌍은 선이 "끝이 열린 칼집" 모양이라 영역을 나누지 못하므로
 *  그 자체로는 다른 쌍을 막지 못한다. 따라서 난이도는 Chord가 강제로 휘어야 하는 횟수와,
 *  한 쌍을 잇기 위해 몇 개의 Chord가 동시에 휘감아야 하는지(Wrap Depth)로 측정한다.
 *
 *  판정은 정확(exact)하다: forcedBends === 0 이면 모든 Chord를 직선으로 그어도
 *  나머지 쌍이 항상 연결 가능하고, forcedBends > 0 이면 직선 Chord는 반드시 실패한다.
 * ============================================================================
 */

export interface PuzzleMetrics {
  pairs: number;
  wallDots: number;
  /** 두 점이 모두 벽에 붙은 쌍 (보드를 가르는 가림벽) */
  chords: number;
  /** 한 점만 벽에 붙은 쌍 */
  mixed: number;
  /** 두 점 모두 내부에 있는 쌍 */
  interior: number;
  /** Σ (Chord c, 쌍 p): p의 두 점이 c의 직선 기준 반대편에 있는 경우의 수 */
  forcedBends: number;
  /** 직선으로 그을 수 없는 Chord 수 */
  forcedChords: number;
  /** 한 쌍을 가로막는 Chord 수의 최댓값 (여러 벽이 겹겹이 휘감아야 하는 깊이) */
  maxWrap: number;
  /** 강제 우회가 필요한 쌍(가로막힌 쌍) 수 */
  blockedPairs: number;
  /** 서로 다른 쌍의 직선 연결선끼리 교차하는 횟수 (직관적 직선 연결이 충돌하는 정도) */
  straightCrossings: number;
  /** 모든 쌍을 직선으로 이어도 풀리는 "가치 없는" 문제인지 */
  trivial: boolean;
  /** 종합 난이도 점수 */
  score: number;
}

function side(a: Point2D, b: Point2D, p: Point2D): number {
  const c = Intersection.ccw(a, b, p);
  return c > 1e-12 ? 1 : c < -1e-12 ? -1 : 0;
}

export class PuzzleAnalyzer {
  static analyze(stage: StageData): PuzzleMetrics {
    const board = stage.board as BoardConfig;
    const dots = stage.dots;

    const isWall = (d: DotPair, p: Point2D) => GameRules.blocksWallPassage(board, p, d.radius);

    const chordIdx: number[] = [];
    let wallDots = 0;
    let mixed = 0;
    let interior = 0;
    dots.forEach((d, i) => {
      const wa = isWall(d, d.pointA);
      const wb = isWall(d, d.pointB);
      wallDots += (wa ? 1 : 0) + (wb ? 1 : 0);
      if (wa && wb) chordIdx.push(i);
      else if (wa || wb) mixed++;
      else interior++;
    });

    let forcedBends = 0;
    const forcedChordSet = new Set<number>();
    const wrapCount = new Array(dots.length).fill(0);

    for (const ci of chordIdx) {
      const c = dots[ci];
      for (let pi = 0; pi < dots.length; pi++) {
        if (pi === ci) continue;
        const p = dots[pi];
        const sa = side(c.pointA, c.pointB, p.pointA);
        const sb = side(c.pointA, c.pointB, p.pointB);
        if (sa * sb < 0) {
          forcedBends++;
          forcedChordSet.add(ci);
          wrapCount[pi]++;
        }
      }
    }

    let straightCrossings = 0;
    let dotOnStraight = false;
    for (let i = 0; i < dots.length; i++) {
      const a = dots[i];
      for (let j = i + 1; j < dots.length; j++) {
        const b = dots[j];
        if (Intersection.doSegmentsIntersect(a.pointA, a.pointB, b.pointA, b.pointB)) straightCrossings++;
      }
      for (const o of dots) {
        if (o.pairId === a.pairId) continue;
        const k = GameRules.dotKeepOut(o.radius);
        if (
          Vector2.distanceToSegment(o.pointA, a.pointA, a.pointB) < k ||
          Vector2.distanceToSegment(o.pointB, a.pointA, a.pointB) < k
        ) {
          dotOnStraight = true;
        }
      }
    }

    const maxWrap = wrapCount.reduce((m, v) => Math.max(m, v), 0);
    const blockedPairs = wrapCount.filter((v) => v > 0).length;
    const forcedChords = forcedChordSet.size;
    const trivial = forcedBends === 0 && straightCrossings === 0 && !dotOnStraight;

    const score =
      forcedBends * 2 +
      forcedChords * 2 +
      blockedPairs * 1.5 +
      Math.max(0, maxWrap - 1) * 3 +
      Math.min(straightCrossings, 6) * 0.5 +
      dots.length * 0.5;

    return {
      pairs: dots.length,
      wallDots,
      chords: chordIdx.length,
      mixed,
      interior,
      forcedBends,
      forcedChords,
      maxWrap,
      blockedPairs,
      straightCrossings,
      trivial,
      score: Math.round(score * 10) / 10
    };
  }
}
