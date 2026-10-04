import { Point2D } from './geometry';

export type DifficultyLevel = 'easy' | 'normal' | 'hard';
export type ObstacleType = 'circle' | 'rect' | 'room_arc' | 'room_rect' | 'wall';
export type BoardType = 'circle' | 'rect';

export interface BoardConfig {
  type: BoardType;
  centerX: number; // default: 0.5
  centerY: number; // default: 0.5
  radius: number;  // for circle: default: 0.40 ~ 0.42
  bounds: {        // for rect: default 0.12 ~ 0.88
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

export interface DotPair {
  pairId: string;
  color: string;
  colorName: string;
  radius: number; // 0.0 ~ 1.0 정규화 기준 반경 (기본: 0.04)
  pointA: Point2D;
  pointB: Point2D;
}

export interface Obstacle {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  radius?: number; // for circle, room_arc
  width?: number;  // for rect, room_rect
  height?: number; // for rect, room_rect
  wallThickness?: number; // 벽 두께 (기본: 0.02)
  gateAngle?: number;     // for room_arc: 게이트 열린 방향 각도 (라디안)
  gateSpan?: number;      // for room_arc: 게이트 개구부 각도 크기 (라디안, 예: Math.PI / 3)
  gateSide?: 'top' | 'bottom' | 'left' | 'right'; // for room_rect
  gateOffset?: number;    // for room_rect: 게이트 위치 (0.0 ~ 1.0)
  gateSize?: number;      // for room_rect: 게이트 통로 폭
  segments?: { p1: Point2D; p2: Point2D }[]; // 충돌 및 렌더링용 벽체 선분들
  label?: string;
}

export interface StageData {
  stageId: string;
  difficulty: DifficultyLevel;
  stageIndex: number;
  board?: BoardConfig; // 원형 또는 사각 보드 설정
  canvas: {
    aspectRatio: string;
    theme: string;
    parLength: number; // 별 3개 기준 총 선 길이 (정규화 단위)
  };
  dots: DotPair[];
  obstacles: Obstacle[];
  solutionHints?: {
    pairId: string;
    path: Point2D[];
  }[];
}

export interface StageProgress {
  stars: number; // 0 (미클리어), 1, 2, 3
  cleared: boolean;
  bestLength?: number;
}
