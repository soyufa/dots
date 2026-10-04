import { Point2D, LineSegment } from '../../types/geometry';
import { Obstacle } from '../../types/stage';
import { Vector2 } from '../math/Vector2';

export class Intersection {
  /**
   * 세 점의 방향 판정 (CCW: Counter-Clockwise)
   * > 0: 반시계 방향
   * < 0: 시계 방향
   * = 0: 일직선
   */
  static ccw(a: Point2D, b: Point2D, c: Point2D): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  /**
   * 점 C가 선분 AB 위에 있는지 검사
   */
  static isPointOnSegment(c: Point2D, a: Point2D, b: Point2D, epsilon: number = 1e-6): boolean {
    const cross = Math.abs(this.ccw(a, b, c));
    if (cross > epsilon) return false;

    const minX = Math.min(a.x, b.x) - epsilon;
    const maxX = Math.max(a.x, b.x) + epsilon;
    const minY = Math.min(a.y, b.y) - epsilon;
    const maxY = Math.max(a.y, b.y) + epsilon;

    return c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY;
  }

  /**
   * 두 선분 AB, CD가 교차하는지 CCW 알고리즘으로 검사
   */
  static doSegmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
    const cp1 = this.ccw(p1, p2, p3);
    const cp2 = this.ccw(p1, p2, p4);
    const cp3 = this.ccw(p3, p4, p1);
    const cp4 = this.ccw(p3, p4, p2);

    // 두 선분이 서로를 교차하는 일반적인 경우
    if (((cp1 > 0 && cp2 < 0) || (cp1 < 0 && cp2 > 0)) &&
        ((cp3 > 0 && cp4 < 0) || (cp3 < 0 && cp4 > 0))) {
      return true;
    }

    // 끝점이 상대 선분 위에 위치하는 특수 경우
    if (this.isPointOnSegment(p3, p1, p2)) return true;
    if (this.isPointOnSegment(p4, p1, p2)) return true;
    if (this.isPointOnSegment(p1, p3, p4)) return true;
    if (this.isPointOnSegment(p2, p3, p4)) return true;

    return false;
  }

  /**
   * 두 선분 객체 교차 검사
   */
  static checkSegmentIntersection(s1: LineSegment, s2: LineSegment): boolean {
    return this.doSegmentsIntersect(s1.p1, s1.p2, s2.p1, s2.p2);
  }

  /**
   * 두 선분 사이의 최단 거리 계산
   */
  static distanceBetweenSegments(s1: LineSegment, s2: LineSegment): number {
    if (this.checkSegmentIntersection(s1, s2)) return 0;
    const d1 = Vector2.distanceToSegment(s1.p1, s2.p1, s2.p2);
    const d2 = Vector2.distanceToSegment(s1.p2, s2.p1, s2.p2);
    const d3 = Vector2.distanceToSegment(s2.p1, s1.p1, s1.p2);
    const d4 = Vector2.distanceToSegment(s2.p2, s1.p1, s1.p2);
    return Math.min(d1, d2, d3, d4);
  }

  /**
   * 선분과 원의 충돌 검사
   */
  static doesSegmentIntersectCircle(p1: Point2D, p2: Point2D, center: Point2D, radius: number): boolean {
    const dist = Vector2.distanceToSegment(center, p1, p2);
    return dist <= radius;
  }

  /**
   * 선분과 직사각형(AABB) 충돌 검사
   */
  static doesSegmentIntersectRect(p1: Point2D, p2: Point2D, x: number, y: number, width: number, height: number): boolean {
    // 점이 직사각형 내부에 위치하는지 검사
    const minX = x;
    const maxX = x + width;
    const minY = y;
    const maxY = y + height;

    if ((p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY) ||
        (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)) {
      return true;
    }

    // 직사각형의 4개 변
    const tl = { x: minX, y: minY };
    const tr = { x: maxX, y: minY };
    const br = { x: maxX, y: maxY };
    const bl = { x: minX, y: maxY };

    if (this.doSegmentsIntersect(p1, p2, tl, tr)) return true;
    if (this.doSegmentsIntersect(p1, p2, tr, br)) return true;
    if (this.doSegmentsIntersect(p1, p2, br, bl)) return true;
    if (this.doSegmentsIntersect(p1, p2, bl, tl)) return true;

    return false;
  }

  /**
   * 선분이 장애물과 충돌하는지 검사
   */
  static doesSegmentIntersectObstacle(p1: Point2D, p2: Point2D, obstacle: Obstacle): boolean {
    // 1. 벽체 선분(segments)이 정의된 경우 (room_arc, room_rect, wall 등)
    if (obstacle.segments && obstacle.segments.length > 0) {
      const halfThick = (obstacle.wallThickness ?? 0.02) * 0.5;
      for (const seg of obstacle.segments) {
        if (this.doSegmentsIntersect(p1, p2, seg.p1, seg.p2)) {
          return true;
        }
        if (halfThick > 0.002) {
          const d1 = Vector2.distanceToSegment(p1, seg.p1, seg.p2);
          const d2 = Vector2.distanceToSegment(p2, seg.p1, seg.p2);
          const d3 = Vector2.distanceToSegment(seg.p1, p1, p2);
          const d4 = Vector2.distanceToSegment(seg.p2, p1, p2);
          if (Math.min(d1, d2, d3, d4) <= halfThick) {
            return true;
          }
        }
      }
      return false;
    }

    if (obstacle.type === 'circle') {
      const radius = obstacle.radius ?? 0.05;
      return this.doesSegmentIntersectCircle(p1, p2, { x: obstacle.x, y: obstacle.y }, radius);
    } else if (obstacle.type === 'rect') {
      const width = obstacle.width ?? 0.1;
      const height = obstacle.height ?? 0.1;
      return this.doesSegmentIntersectRect(p1, p2, obstacle.x, obstacle.y, width, height);
    }
    return false;
  }

  /**
   * C자형 룸(원형 방)의 충돌 선분 생성
   */
  static createRoomArcSegments(
    center: Point2D,
    radius: number,
    gateAngle: number,
    gateSpan: number,
    steps: number = 14
  ): LineSegment[] {
    const segments: LineSegment[] = [];
    const startAngle = gateAngle + gateSpan / 2;
    const totalArc = Math.PI * 2 - gateSpan;
    const angleStep = totalArc / steps;

    let prevPoint: Point2D = {
      x: center.x + Math.cos(startAngle) * radius,
      y: center.y + Math.sin(startAngle) * radius
    };

    for (let i = 1; i <= steps; i++) {
      const curAngle = startAngle + i * angleStep;
      const curPoint: Point2D = {
        x: center.x + Math.cos(curAngle) * radius,
        y: center.y + Math.sin(curAngle) * radius
      };
      segments.push({ p1: prevPoint, p2: curPoint });
      prevPoint = curPoint;
    }

    return segments;
  }

  /**
   * 포위형 사각 룸(Room Rect)의 충돌 선분 생성
   */
  static createRoomRectSegments(
    x: number,
    y: number,
    width: number,
    height: number,
    gateSide: 'top' | 'bottom' | 'left' | 'right' = 'top',
    gateOffset: number = 0.5,
    gateSize: number = 0.08
  ): LineSegment[] {
    const segments: LineSegment[] = [];
    const tl = { x, y };
    const tr = { x: x + width, y };
    const br = { x: x + width, y: y + height };
    const bl = { x, y: y + height };

    // 4개 변 생성 (게이트가 있는 변은 둘로 쪼갬)
    if (gateSide === 'top') {
      const gCenter = x + width * gateOffset;
      const gLeft = Math.max(x, gCenter - gateSize / 2);
      const gRight = Math.min(x + width, gCenter + gateSize / 2);
      if (gLeft > x) segments.push({ p1: tl, p2: { x: gLeft, y } });
      if (gRight < x + width) segments.push({ p1: { x: gRight, y }, p2: tr });
    } else {
      segments.push({ p1: tl, p2: tr });
    }

    if (gateSide === 'right') {
      const gCenter = y + height * gateOffset;
      const gTop = Math.max(y, gCenter - gateSize / 2);
      const gBottom = Math.min(y + height, gCenter + gateSize / 2);
      if (gTop > y) segments.push({ p1: tr, p2: { x: x + width, y: gTop } });
      if (gBottom < y + height) segments.push({ p1: { x: x + width, y: gBottom }, p2: br });
    } else {
      segments.push({ p1: tr, p2: br });
    }

    if (gateSide === 'bottom') {
      const gCenter = x + width * gateOffset;
      const gLeft = Math.max(x, gCenter - gateSize / 2);
      const gRight = Math.min(x + width, gCenter + gateSize / 2);
      if (gRight < x + width) segments.push({ p1: br, p2: { x: gRight, y: y + height } });
      if (gLeft > x) segments.push({ p1: { x: gLeft, y: y + height }, p2: bl });
    } else {
      segments.push({ p1: br, p2: bl });
    }

    if (gateSide === 'left') {
      const gCenter = y + height * gateOffset;
      const gTop = Math.max(y, gCenter - gateSize / 2);
      const gBottom = Math.min(y + height, gCenter + gateSize / 2);
      if (gBottom < y + height) segments.push({ p1: bl, p2: { x, y: gBottom } });
      if (gTop > y) segments.push({ p1: { x, y: gTop }, p2: tl });
    } else {
      segments.push({ p1: bl, p2: tl });
    }

    return segments;
  }

  /**
   * 단일 선분과 기존 완료된 선분 목록 간의 교차 및 근접 검사
   */
  static doesSegmentIntersectExistingLines(
    segment: LineSegment,
    existingLines: { pairId: string; segments: LineSegment[] }[],
    excludePairId?: string,
    minClearance: number = 0.006
  ): { hit: boolean; hitPairId?: string } {
    for (const line of existingLines) {
      if (excludePairId && line.pairId === excludePairId) continue;
      for (const existingSeg of line.segments) {
        if (this.checkSegmentIntersection(segment, existingSeg)) {
          return { hit: true, hitPairId: line.pairId };
        }
        if (minClearance > 0 && this.distanceBetweenSegments(segment, existingSeg) < minClearance) {
          return { hit: true, hitPairId: line.pairId };
        }
      }
    }
    return { hit: false };
  }

  /**
   * 자기 교차 검사 (Self-intersection)
   * 현재 그려진 세그먼트 중 최근 세그먼트가 이전 비인접 세그먼트와 교차하는지 판별
   */
  static doesPathSelfIntersect(segments: LineSegment[]): boolean {
    const len = segments.length;
    if (len < 3) return false;

    const latest = segments[len - 1];
    // 바로 앞 세그먼트(len - 2)는 연결 지점이 닿아 있으므로 건너뛰고 len - 3부터 검사
    for (let i = 0; i < len - 2; i++) {
      if (this.checkSegmentIntersection(latest, segments[i])) {
        return true;
      }
    }
    return false;
  }
}
