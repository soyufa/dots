import { Point2D, LineSegment } from '../../types/geometry';
import { Vector2 } from './Vector2';

export class Spline {
  /**
   * 4개 제어점과 매개변수 t(0~1)를 통한 Catmull-Rom 스플라인 보간
   */
  static interpolateCatmullRom(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
    const t2 = t * t;
    const t3 = t2 * t;

    const x = 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );

    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    return { x, y };
  }

  /**
   * 제어점 목록으로부터 부드러운 스플라인 곡선 점들을 생성
   * @param rawPoints 입력된 터치 포인트 시퀀스
   * @param segmentsPerSpan 각 점 사이 구간 분할 개수 (기본 6)
   */
  static generateSplinePoints(rawPoints: Point2D[], segmentsPerSpan: number = 6): Point2D[] {
    if (rawPoints.length === 0) return [];
    if (rawPoints.length === 1) return [{ ...rawPoints[0] }];
    if (rawPoints.length === 2) {
      // 2개 점일 경우 단순 보간
      const result: Point2D[] = [];
      for (let i = 0; i <= segmentsPerSpan; i++) {
        const t = i / segmentsPerSpan;
        result.push(Vector2.lerp(rawPoints[0], rawPoints[1], t));
      }
      return result;
    }

    const result: Point2D[] = [];
    const n = rawPoints.length;

    for (let i = 0; i < n - 1; i++) {
      const p0 = i === 0 ? { x: 2 * rawPoints[0].x - rawPoints[1].x, y: 2 * rawPoints[0].y - rawPoints[1].y } : rawPoints[i - 1];
      const p1 = rawPoints[i];
      const p2 = rawPoints[i + 1];
      const p3 = i + 2 >= n ? { x: 2 * rawPoints[n - 1].x - rawPoints[n - 2].x, y: 2 * rawPoints[n - 1].y - rawPoints[n - 2].y } : rawPoints[i + 2];

      const steps = segmentsPerSpan;
      // 첫 구간이 아니면 시작점(t=0)은 이전 구간의 마지막 점과 중복되므로 건너뜀
      const startStep = i === 0 ? 0 : 1;

      for (let step = startStep; step <= steps; step++) {
        const t = step / steps;
        result.push(this.interpolateCatmullRom(p0, p1, p2, p3, t));
      }
    }

    return result;
  }

  /**
   * 점 배열을 연속된 선분(LineSegment) 목록으로 테셀레이션
   */
  static tessellatePath(points: Point2D[]): LineSegment[] {
    const segments: LineSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({
        p1: points[i],
        p2: points[i + 1]
      });
    }
    return segments;
  }

  /**
   * 경로의 총 길이 계산
   */
  static calculatePathLength(points: Point2D[]): number {
    let len = 0;
    for (let i = 0; i < points.length - 1; i++) {
      len += Vector2.distance(points[i], points[i + 1]);
    }
    return len;
  }
}
