import { Point2D, LineSegment } from './geometry';

export interface SplinePath {
  pairId: string;
  color: string;
  rawPoints: Point2D[];
  tessellatedSegments: LineSegment[];
  totalLength: number;
  isComplete: boolean;
}

export interface StageEvaluation {
  isCleared: boolean;
  stars: number; // 1, 2, 3
  userTotalLength: number;
  parLength: number;
  efficiencyRatio: number;
}

export type GameState = 'LOADING' | 'STAGE_SELECT' | 'PLAYING' | 'PAUSED' | 'STAGE_CLEAR';

export interface DrawCommand {
  type: 'CONNECT' | 'ERASE';
  pairId: string;
  previousPath?: SplinePath;
  newPath?: SplinePath;
}
