import { Point2D, LineSegment } from '../../types/geometry';
import { BoardConfig, DotPair } from '../../types/stage';
import { Vector2 } from '../math/Vector2';
import { Intersection } from '../physics/Intersection';

/**
 * ============================================================================
 *  게임 규칙 단일 소스 (Single Source of Truth)
 * ============================================================================
 *  입력 판정(InputManager), 클리어 판정(GameEngine), 렌더링(CanvasRenderer),
 *  스테이지 생성기/검증기(PuzzleGenerator, verify_levels)가 모두 이 상수를 공유한다.
 *  규칙이 한 곳이라도 어긋나면 "생성기는 풀린다고 판단했지만 실제로는 못 푸는"
 *  혹은 "벽에 붙은 점 뒤로 선이 빠져나가는" 정합성 문제가 생긴다.
 * ============================================================================
 */
export const GameRules = {
  /** 선의 시각적 두께 (정규화 좌표, 보드 짧은 변 대비) */
  LINE_WIDTH: 0.016,
  /** 서로 다른 색 선의 중심선 간 최소 거리. 선 두께와 같아 시각적으로 겹치지 않는다. */
  LINE_CLEARANCE: 0.015,
  /** 생성기가 정답 경로를 만들 때 추가로 확보하는 안전 여유 */
  SOLUTION_MARGIN: 0.003,
  /** 스플라인 보간된 최종 선을 검사할 때 허용하는 오차 (보간이 입력점 사이를 살짝 부풀림) */
  SMOOTH_SLACK: 0.004,
  /** 점이 벽에 "붙어 있다"고 판단하는 허용 오차 */
  WALL_TOUCH_EPS: 0.002,

  /** 선 중심선이 테두리로부터 떨어져야 하는 거리 (선 가장자리가 테두리를 넘지 않음) */
  get WALL_INSET(): number {
    return this.LINE_WIDTH * 0.5;
  },

  /** 다른 색 점에 대해 선 중심선이 침범할 수 없는 반경 (선 가장자리가 점에 닿지 않음) */
  dotKeepOut(dotRadius: number): number {
    return dotRadius + this.LINE_WIDTH * 0.5;
  },

  /** 점 중심에서 가장 가까운 테두리까지의 거리 (보드 내부면 양수) */
  distanceToWall(board: BoardConfig, p: Point2D): number {
    if (board.type === 'circle') {
      return board.radius - Math.hypot(p.x - board.centerX, p.y - board.centerY);
    }
    const b = board.bounds;
    return Math.min(p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y);
  },

  /** 선 중심선 좌표가 허용 영역(테두리 안쪽 WALL_INSET) 안에 있는지 */
  isLinePointInside(board: BoardConfig, p: Point2D, extraMargin: number = 0): boolean {
    return this.distanceToWall(board, p) >= this.WALL_INSET + extraMargin - 1e-9;
  },

  /** 보드 밖으로 나간 좌표를 허용 영역 경계로 투영 (드로잉 시 좌표 클램핑) */
  clampLinePoint(board: BoardConfig, p: Point2D): Point2D {
    const inset = this.WALL_INSET;
    if (board.type === 'circle') {
      const dx = p.x - board.centerX;
      const dy = p.y - board.centerY;
      const d = Math.hypot(dx, dy);
      const maxD = board.radius - inset;
      if (d <= maxD || d < 1e-9) return { x: p.x, y: p.y };
      return { x: board.centerX + (dx / d) * maxD, y: board.centerY + (dy / d) * maxD };
    }
    const b = board.bounds;
    return {
      x: Math.min(b.maxX - inset, Math.max(b.minX + inset, p.x)),
      y: Math.min(b.maxY - inset, Math.max(b.minY + inset, p.y))
    };
  },

  /** 점이 테두리에 밀착되어 차단벽 역할을 하는지 */
  isWallDot(board: BoardConfig, center: Point2D, radius: number): boolean {
    return this.distanceToWall(board, center) <= radius + this.WALL_TOUCH_EPS;
  },

  /**
   * 점과 테두리 사이로 선이 지나갈 수 없는지 (= 점이 테두리와 함께 벽을 이루는지).
   * 선이 지나가려면 점 금지 영역(r + w/2)과 테두리 여백(w/2)을 동시에 만족해야 하므로
   * 점 중심이 테두리에서 r + w 이상 떨어져 있어야 한다.
   */
  blocksWallPassage(board: BoardConfig, center: Point2D, radius: number): boolean {
    return this.distanceToWall(board, center) < radius + this.LINE_WIDTH;
  },

  /** 점 전체가 테두리 안쪽에 있는지 */
  isDotInside(board: BoardConfig, center: Point2D, radius: number): boolean {
    return this.distanceToWall(board, center) >= radius - this.WALL_TOUCH_EPS;
  },

  /**
   * 선분이 다른 색 점의 금지 영역을 침범하는지.
   * 벽에 붙은 점은 금지 영역이 테두리 바깥까지 이어지므로, 점과 벽 사이로는 어떤 선도 지나갈 수 없다.
   */
  segmentHitsForeignDot(
    p1: Point2D,
    p2: Point2D,
    dots: DotPair[],
    ownPairId: string,
    shrink: number = 0
  ): boolean {
    for (const d of dots) {
      if (d.pairId === ownPairId) continue;
      const keepOut = this.dotKeepOut(d.radius) - shrink;
      if (Vector2.distanceToSegment(d.pointA, p1, p2) < keepOut) return true;
      if (Vector2.distanceToSegment(d.pointB, p1, p2) < keepOut) return true;
    }
    return false;
  },

  /** 선분이 다른 색 선과 교차하거나 최소 간격 미만으로 근접하는지 */
  segmentHitsForeignLine(
    seg: LineSegment,
    lines: { pairId: string; segments: LineSegment[] }[],
    ownPairId: string,
    clearance?: number
  ): string | null {
    const minDist = clearance ?? this.LINE_CLEARANCE;
    for (const line of lines) {
      if (line.pairId === ownPairId) continue;
      for (const other of line.segments) {
        if (Intersection.distanceBetweenSegments(seg, other) < minDist) return line.pairId;
      }
    }
    return null;
  }
};
