import { LineSegment } from '../../types/geometry';
import { BoardConfig, StageData } from '../../types/stage';
import { GameRules } from '../rules/GameRules';
import { Intersection } from '../physics/Intersection';
import { Vector2 } from '../math/Vector2';

/**
 * 스테이지 정합성 검증기.
 * 정답 경로(solutionHints)가 실제 게임 규칙(GameRules)을 안전 여유까지 포함해 모두 만족하는지
 * 확인한다. 통과하면 해당 스테이지는 "실제 게임에서 풀 수 있음"이 구성적으로 증명된다.
 */
export class PuzzleValidator {
  static validate(stage: StageData, margin: number = GameRules.SOLUTION_MARGIN): string[] {
    const errors: string[] = [];
    const board = stage.board as BoardConfig | undefined;
    if (!board) return ['보드 설정 없음'];

    const dots = stage.dots;
    const hints = stage.solutionHints ?? [];

    // 1) 색상 고유성
    const colors = new Set(dots.map((d) => d.color));
    if (colors.size !== dots.length) errors.push('색상 중복');

    // 2) 점은 테두리 안쪽, 서로 겹치지 않음
    const allDots = dots.flatMap((d) => [
      { pair: d.pairId, p: d.pointA, r: d.radius },
      { pair: d.pairId, p: d.pointB, r: d.radius }
    ]);
    for (const d of allDots) {
      if (!GameRules.isDotInside(board, d.p, d.r)) errors.push(`${d.pair}: 점이 테두리 밖으로 나감`);
      // 벽 점은 테두리에 완전히 밀착, 내부 점은 선이 지나갈 만큼 떨어져 있어야 한다 (애매한 틈 금지)
      const gap = GameRules.distanceToWall(board, d.p) - d.r;
      const touching = gap <= GameRules.WALL_TOUCH_EPS;
      const passable = gap >= GameRules.LINE_WIDTH + margin;
      if (!touching && !passable) errors.push(`${d.pair}: 점과 테두리 사이 틈이 애매함 (${gap.toFixed(4)})`);
    }
    for (let i = 0; i < allDots.length; i++) {
      for (let j = i + 1; j < allDots.length; j++) {
        const a = allDots[i];
        const b = allDots[j];
        if (Vector2.distance(a.p, b.p) < a.r + b.r + 0.004) errors.push(`${a.pair}/${b.pair}: 점끼리 겹침`);
      }
    }

    // 3) 정답 경로 존재 및 끝점 일치
    const segsByPair = new Map<string, LineSegment[]>();
    for (const d of dots) {
      const h = hints.find((x) => x.pairId === d.pairId);
      if (!h || h.path.length < 2) {
        errors.push(`${d.pairId}: 정답 경로 없음`);
        continue;
      }
      const first = h.path[0];
      const last = h.path[h.path.length - 1];
      if (Vector2.distance(first, d.pointA) > 1e-6 || Vector2.distance(last, d.pointB) > 1e-6) {
        errors.push(`${d.pairId}: 정답 경로 끝점이 점과 불일치`);
      }
      const segs: LineSegment[] = [];
      for (let i = 0; i < h.path.length - 1; i++) segs.push({ p1: h.path[i], p2: h.path[i + 1] });
      segsByPair.set(d.pairId, segs);

      // 4) 테두리 안쪽 (선 두께 포함)
      for (const p of h.path) {
        if (!GameRules.isLinePointInside(board, p, margin)) {
          errors.push(`${d.pairId}: 정답 경로가 테두리에 닿거나 밖으로 나감`);
          break;
        }
      }

      // 5) 다른 색 점 침범 금지
      for (const s of segs) {
        if (GameRules.segmentHitsForeignDot(s.p1, s.p2, dots, d.pairId, -margin)) {
          errors.push(`${d.pairId}: 정답 경로가 다른 색 점을 침범`);
          break;
        }
      }

      // 6) 자기 교차 금지
      outer: for (let i = 0; i < segs.length; i++) {
        for (let j = i + 2; j < segs.length; j++) {
          if (Intersection.checkSegmentIntersection(segs[i], segs[j])) {
            errors.push(`${d.pairId}: 정답 경로 자기 교차`);
            break outer;
          }
        }
      }
    }

    // 7) 서로 다른 선 간 교차/근접 금지
    const lines = Array.from(segsByPair.entries()).map(([pairId, segments]) => ({ pairId, segments }));
    for (let i = 0; i < lines.length; i++) {
      for (const s of lines[i].segments) {
        const hit = GameRules.segmentHitsForeignLine(
          s,
          lines.slice(i + 1),
          lines[i].pairId,
          GameRules.LINE_CLEARANCE + margin
        );
        if (hit) {
          errors.push(`${lines[i].pairId}/${hit}: 정답 경로끼리 교차 또는 간격 부족`);
          break;
        }
      }
    }

    return errors;
  }
}
