import { Point2D } from '../../types/geometry';

export class Vector2 {
  static create(x: number = 0, y: number = 0): Point2D {
    return { x, y };
  }

  static clone(p: Point2D): Point2D {
    return { x: p.x, y: p.y };
  }

  static add(a: Point2D, b: Point2D): Point2D {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  static subtract(a: Point2D, b: Point2D): Point2D {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  static multiply(a: Point2D, scalar: number): Point2D {
    return { x: a.x * scalar, y: a.y * scalar };
  }

  static dot(a: Point2D, b: Point2D): number {
    return a.x * b.x + a.y * b.y;
  }

  static cross(a: Point2D, b: Point2D): number {
    return a.x * b.y - a.y * b.x;
  }

  static lengthSq(a: Point2D): number {
    return a.x * a.x + a.y * a.y;
  }

  static length(a: Point2D): number {
    return Math.sqrt(this.lengthSq(a));
  }

  static distanceSq(a: Point2D, b: Point2D): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  static distance(a: Point2D, b: Point2D): number {
    return Math.sqrt(this.distanceSq(a, b));
  }

  static normalize(a: Point2D): Point2D {
    const len = this.length(a);
    if (len === 0) return { x: 0, y: 0 };
    return { x: a.x / len, y: a.y / len };
  }

  static lerp(a: Point2D, b: Point2D, t: number): Point2D {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  }

  /**
   * 점 P에서 선분 AB까지의 최단 거리 반환
   */
  static distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
    const l2 = this.distanceSq(a, b);
    if (l2 === 0) return this.distance(p, a);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y)
    };
    return this.distance(p, proj);
  }
}
