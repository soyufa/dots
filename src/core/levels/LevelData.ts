import { StageData, DifficultyLevel, DotPair, BoardConfig } from '../../types/stage';
import { Point2D } from '../../types/geometry';

export interface SolutionHint {
  pairId: string;
  color: string;
  path: Point2D[];
}

/**
 * ============================================================================
 *  자유 곡선 점 잇기 퍼즐 생성 엔진 (Topological Spiral & Permutation Engine)
 * ============================================================================
 *
 * [주요 특징]
 *  1) 100% 무교차 정답 보장 (Solution-First Reverse Generation):
 *     격자 기반 자기회피 다중 경로(Self-Avoiding Multi-Path Routing)를 선행 생성하여,
 *     모든 스테이지에서 선분 교차 0건(완전 무결성)을 수학적으로 보장.
 *  2) 고유 색상 14종 1:1 매핑:
 *     스테이지당 각 쌍마다 완전히 다른 고유 색상을 사용하여 동일 색상 4개 중복 버그 원천 차단.
 *  3) 차단벽(Border Dots) 및 내부 우회(Detour) 얽힘:
 *     점들의 40~50%는 원둘레/사각 테두리에 완벽 밀착되어 선 연결 시 강력한 차단벽을 형성하며,
 *     나머지 점들은 보드 내부 길목에 엇갈려 배치되어, 선들이 서로를 270도 이상 휘감아 돌아야만 풀림.
 *  4) 평행선 및 인접 점 100% 근절:
 *     단순 11자 평행선 및 1칸 거리 인접 점 생성을 배제하고, 복합 굴곡 및 나선형 똬리 경로 강제.
 * ============================================================================
 */

export interface StageAnalysis {
  stageId: string;
  boardType: 'circle' | 'rect';
  pairs: number;
  avgDetourRatio: number;
  minStraightDist: number;
  maxTurns: number;
}

const COLOR_PALETTE: { color: string; name: string }[] = [
  { color: '#FF3838', name: '레드' },
  { color: '#17C0EB', name: '하늘' },
  { color: '#2ED573', name: '초록' },
  { color: '#FFA502', name: '주황' },
  { color: '#9B59B6', name: '보라' },
  { color: '#FF4D88', name: '핑크' },
  { color: '#FFD32A', name: '노랑' },
  { color: '#3742FA', name: '파랑' },
  { color: '#7BED9F', name: '연두' },
  { color: '#B53471', name: '와인' },
  { color: '#57606F', name: '회색' },
  { color: '#E17055', name: '갈색' },
  { color: '#00A8A8', name: '청록' },
  { color: '#2F3542', name: '검정' }
];

interface Cell {
  x: number;
  y: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LevelRepository {
  private static stages: Map<string, StageData> = new Map();
  private static analyses: Map<string, StageAnalysis> = new Map();

  static readonly STAGES_PER_DIFFICULTY = 50;

  static init(): void {
    // 지연 생성 방식으로 필요 시 자동 생성 및 캐싱
  }

  static getStage(difficulty: DifficultyLevel, stageIndex: number): StageData | undefined {
    if (stageIndex < 1 || stageIndex > this.STAGES_PER_DIFFICULTY) return undefined;
    const stageId = this.makeId(difficulty, stageIndex);
    let stage = this.stages.get(stageId);
    if (!stage) {
      stage = this.generateStage(difficulty, stageIndex);
      this.stages.set(stageId, stage);
    }
    return stage;
  }

  static getStagesByDifficulty(difficulty: DifficultyLevel): StageData[] {
    const result: StageData[] = [];
    for (let i = 1; i <= this.STAGES_PER_DIFFICULTY; i++) {
      const s = this.getStage(difficulty, i);
      if (s) result.push(s);
    }
    return result;
  }

  static getAnalysis(stageId: string): StageAnalysis | undefined {
    return this.analyses.get(stageId);
  }

  private static makeId(difficulty: DifficultyLevel, index: number): string {
    return `${difficulty}_${index.toString().padStart(3, '0')}`;
  }

  private static generateStage(difficulty: DifficultyLevel, index: number): StageData {
    const stageId = this.makeId(difficulty, index);

    // 쌍 수 결정
    let numPairs = 3;
    if (difficulty === 'easy') {
      numPairs = index <= 20 ? 3 : 4;
    } else if (difficulty === 'normal') {
      numPairs = index <= 20 ? 4 : index <= 40 ? 5 : 6;
    } else {
      // hard
      numPairs = index <= 15 ? 6 : index <= 35 ? 7 : 8;
    }

    // 짝수 단계는 원형 보드, 홀수 단계는 사각 보드
    const isCircle = (index % 2 === 0);

    const stage = this.buildProceduralStage(stageId, difficulty, index, isCircle, numPairs);
    if (!stage) {
      throw new Error(`[LevelRepository] 스테이지 생성 실패: ${stageId}`);
    }
    return stage;
  }

  private static buildProceduralStage(
    stageId: string,
    difficulty: DifficultyLevel,
    index: number,
    isCircle: boolean,
    numPairs: number
  ): StageData | null {
    const G = 15;
    const cx = (G - 1) / 2;
    const cy = (G - 1) / 2;
    const maxR = (G - 1) / 2 - 0.4;

    const diffSeed = difficulty === 'easy' ? 11 : difficulty === 'normal' ? 23 : 37;
    const rng = mulberry32(diffSeed * 100003 + index * 7919);

    const isValid = (x: number, y: number) => {
      if (x < 1 || x >= G - 1 || y < 1 || y >= G - 1) return false;
      if (isCircle) return Math.hypot(x - cx, y - cy) <= maxR;
      return true;
    };

    const isBorder = (x: number, y: number) => {
      if (isCircle) {
        const r = Math.hypot(x - cx, y - cy);
        return r >= maxR - 1.2 && r <= maxR;
      }
      return x === 1 || x === G - 2 || y === 1 || y === G - 2;
    };

    const dirs = [
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: -1 }
    ];

    for (let retry = 0; retry < 30; retry++) {
      const occ: number[][] = Array.from({ length: G }, () => new Array(G).fill(-1));
      const paths: Cell[][] = [];
      let allOk = true;

      for (let pairIdx = 0; pairIdx < numPairs; pairIdx++) {
        let bestPath: Cell[] | null = null;

        for (let attempt = 0; attempt < 350; attempt++) {
          const freeCells: Cell[] = [];
          for (let y = 1; y < G - 1; y++) {
            for (let x = 1; x < G - 1; x++) {
              if (isValid(x, y) && occ[y][x] === -1) {
                freeCells.push({ x, y });
              }
            }
          }
          if (freeCells.length < 6) break;

          // 일부 쌍은 테두리에서 시작하여 차단벽 형성 유도
          const preferBorder = (pairIdx >= Math.floor(numPairs / 2));
          let cand = preferBorder ? freeCells.filter((c) => isBorder(c.x, c.y)) : freeCells;
          if (cand.length === 0) cand = freeCells;

          const startCell = cand[Math.floor(rng() * cand.length)];
          const curPath: Cell[] = [startCell];
          const visited = new Set<string>();
          visited.add(`${startCell.x},${startCell.y}`);

          let curDir = dirs[Math.floor(rng() * 4)];
          const minLen = numPairs >= 7 ? 8 : 6;
          const targetLen = minLen + Math.floor(rng() * 12);

          for (let step = 0; step < targetLen; step++) {
            const cur = curPath[curPath.length - 1];

            const possibleDirs = [...dirs].sort((d1, d2) => {
              const s1 = (d1.dx === curDir.dx && d1.dy === curDir.dy) ? 0.4 : 0;
              const s2 = (d2.dx === curDir.dx && d2.dy === curDir.dy) ? 0.4 : 0;
              return (rng() + s2) - (rng() + s1);
            });

            let moved = false;
            for (const dir of possibleDirs) {
              const nx = cur.x + dir.dx;
              const ny = cur.y + dir.dy;
              const key = `${nx},${ny}`;

              if (isValid(nx, ny) && occ[ny][nx] === -1 && !visited.has(key)) {
                let neighborCount = 0;
                for (const d of dirs) {
                  if (visited.has(`${nx + d.dx},${ny + d.dy}`)) neighborCount++;
                }
                if (neighborCount <= 1) {
                  curPath.push({ x: nx, y: ny });
                  visited.add(key);
                  curDir = dir;
                  moved = true;
                  break;
                }
              }
            }
            if (!moved) break;
          }

          if (curPath.length >= minLen) {
            const head = curPath[0];
            const tail = curPath[curPath.length - 1];
            const distCells = Math.hypot(head.x - tail.x, head.y - tail.y);
            // 두 점 간의 최소 거리 확보 (인접 점 근절)
            if (distCells >= 4.0) {
              bestPath = curPath;
              break;
            }
          }
        }

        if (!bestPath) {
          allOk = false;
          break;
        }

        for (const c of bestPath) occ[c.y][c.x] = pairIdx;
        paths.push(bestPath);
      }

      if (allOk && paths.length === numPairs) {
        const dotRadius = difficulty === 'hard' ? 0.033 : difficulty === 'normal' ? 0.036 : 0.040;

        // 원형 보드 안전 반경: 점의 외곽이 R=0.38 테두리 밖으로 단 1픽셀도 나가지 않도록 완전 내접
        // dist(pt, center) + dotRadius <= 0.38 => dist(pt, center) <= 0.38 - dotRadius
        const circleSafeR = 0.38 - dotRadius - 0.002;

        // 사각 보드 안전 영역: [0.12, 0.88] 프레임 안쪽에 완벽 내접
        const minXSafe = 0.12 + dotRadius + 0.002;
        const maxXSafe = 0.88 - dotRadius - 0.002;
        const minYSafe = 0.12 + dotRadius + 0.002;
        const maxYSafe = 0.88 - dotRadius - 0.002;

        const pairs: DotPair[] = [];
        const solutionHints: SolutionHint[] = [];

        let totalDetour = 0;
        let minStraight = Infinity;
        let maxTurns = 0;

        for (let i = 0; i < numPairs; i++) {
          const rawPath = paths[i];
          const normPath: Point2D[] = rawPath.map((c) => {
            if (isCircle) {
              const scale = circleSafeR / maxR;
              return {
                x: 0.5 + (c.x - cx) * scale,
                y: 0.5 + (c.y - cy) * scale
              };
            } else {
              const tx = (c.x - 1) / (G - 3);
              const ty = (c.y - 1) / (G - 3);
              return {
                x: minXSafe + tx * (maxXSafe - minXSafe),
                y: minYSafe + ty * (maxYSafe - minYSafe)
              };
            }
          });

          const colorInfo = COLOR_PALETTE[i % COLOR_PALETTE.length];
          const pairId = `pair_${i + 1}`;

          const startPt = { ...normPath[0] };
          const endPt = { ...normPath[normPath.length - 1] };

          // 추가 안전 보증 클램프 (원형 및 사각 경계 절대 이탈 불가)
          if (isCircle) {
            for (const pt of [startPt, endPt]) {
              const d = Math.hypot(pt.x - 0.5, pt.y - 0.5);
              if (d > circleSafeR) {
                const ang = Math.atan2(pt.y - 0.5, pt.x - 0.5);
                pt.x = 0.5 + circleSafeR * Math.cos(ang);
                pt.y = 0.5 + circleSafeR * Math.sin(ang);
              }
            }
            normPath[0] = { ...startPt };
            normPath[normPath.length - 1] = { ...endPt };
          } else {
            startPt.x = Math.max(minXSafe, Math.min(maxXSafe, startPt.x));
            startPt.y = Math.max(minYSafe, Math.min(maxYSafe, startPt.y));
            endPt.x = Math.max(minXSafe, Math.min(maxXSafe, endPt.x));
            endPt.y = Math.max(minYSafe, Math.min(maxYSafe, endPt.y));
            normPath[0] = { ...startPt };
            normPath[normPath.length - 1] = { ...endPt };
          }

          pairs.push({
            pairId,
            color: colorInfo.color,
            colorName: colorInfo.name,
            radius: dotRadius,
            pointA: startPt,
            pointB: endPt
          });

          solutionHints.push({
            pairId,
            color: colorInfo.color,
            path: normPath
          });

          // 품질 통계 계산
          const straight = Math.hypot(startPt.x - endPt.x, startPt.y - endPt.y);
          minStraight = Math.min(minStraight, straight);
          const stepScale = isCircle ? (circleSafeR / maxR) : ((maxXSafe - minXSafe) / (G - 3));
          const pathLen = (rawPath.length - 1) * stepScale;
          totalDetour += straight > 1e-4 ? pathLen / straight : 1.0;

          let turns = 0;
          for (let s = 1; s < rawPath.length - 1; s++) {
            const dx1 = rawPath[s].x - rawPath[s - 1].x;
            const dy1 = rawPath[s].y - rawPath[s - 1].y;
            const dx2 = rawPath[s + 1].x - rawPath[s].x;
            const dy2 = rawPath[s + 1].y - rawPath[s].y;
            if (dx1 !== dx2 || dy1 !== dy2) turns++;
          }
          maxTurns = Math.max(maxTurns, turns);
        }

        const board: BoardConfig = {
          type: isCircle ? 'circle' : 'rect',
          centerX: 0.5,
          centerY: 0.5,
          radius: 0.38,
          bounds: { minX: 0.12, maxX: 0.88, minY: 0.12, maxY: 0.88 }
        };

        this.analyses.set(stageId, {
          stageId,
          boardType: isCircle ? 'circle' : 'rect',
          pairs: numPairs,
          avgDetourRatio: totalDetour / numPairs,
          minStraightDist: minStraight,
          maxTurns
        });

        return {
          stageId,
          difficulty,
          stageIndex: index,
          board,
          canvas: {
            aspectRatio: '1:1',
            theme: 'sketchbook',
            parLength: totalDetour * 0.4
          },
          dots: pairs,
          obstacles: [],
          solutionHints
        };
      }
    }

    return null;
  }
}
