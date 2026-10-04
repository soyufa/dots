import { StageData, DifficultyLevel, DotPair } from '../../types/stage';
import { Point2D } from '../../types/geometry';
import { GeneratorParams, PuzzleGenerator, GeneratedPuzzle } from './PuzzleGenerator';
import { PuzzleAnalyzer, PuzzleMetrics } from './PuzzleAnalyzer';
import { PuzzleValidator } from './PuzzleValidator';

export interface SolutionHint {
  pairId: string;
  color: string;
  path: Point2D[];
}

/**
 * ============================================================================
 *  스테이지 저장소 (결정적 생성 + 난이도 선별)
 * ============================================================================
 *  스테이지마다 고정 시드로 여러 후보를 생성하고,
 *   1) PuzzleValidator 로 실제 게임 규칙상 풀이 가능함을 검증하고
 *   2) PuzzleAnalyzer 로 위상 난이도(강제 우회 수, 감싸기 깊이)를 측정해
 *   3) 스테이지별 최소 요구치를 만족하는 후보 중 진행도에 맞는 난이도를 고른다.
 *  같은 버전의 코드에서는 항상 같은 스테이지가 생성된다.
 * ============================================================================
 */

export type StageAnalysis = PuzzleMetrics & { stageId: string; boardType: 'circle' | 'rect' };

export interface StagePlan {
  params: GeneratorParams;
  /** 최소 강제 우회 수 (0이면 직선 Chord 허용) */
  minForced: number;
  /** 최소 감싸기 깊이 */
  minWrap: number;
  /** 수집된 후보 중 몇 번째 난이도(백분위)를 고를지 0~1 */
  percentile: number;
}

// 한 스테이지 최대 쌍 수(9) 안에서 서로 헷갈리지 않는 색이 먼저 오도록 정렬
// (초록/연두, 빨강/와인처럼 비슷한 색은 뒤로 배치)
const COLOR_PALETTE: { color: string; name: string }[] = [
  { color: '#FF3838', name: '레드' },
  { color: '#17C0EB', name: '하늘' },
  { color: '#2ED573', name: '초록' },
  { color: '#FFA502', name: '주황' },
  { color: '#9B59B6', name: '보라' },
  { color: '#FF4D88', name: '핑크' },
  { color: '#FFD32A', name: '노랑' },
  { color: '#3742FA', name: '파랑' },
  { color: '#57606F', name: '회색' },
  { color: '#00A8A8', name: '청록' },
  { color: '#E17055', name: '갈색' },
  { color: '#B53471', name: '와인' },
  { color: '#7BED9F', name: '연두' },
  { color: '#2F3542', name: '검정' }
];

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

const MAX_SEEDS = 80;
const ENOUGH_CANDIDATES = 10;

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

  /**
   * 난이도 곡선.
   *  - 5의 배수 스테이지는 보스(상위 난이도 후보), 그 다음 스테이지는 한 박자 쉬어가는 톱니형 곡선.
   *  - 쌍 수·가림벽 수·최소 강제 우회 수가 단계적으로 증가한다.
   */
  static planStage(difficulty: DifficultyLevel, index: number): StagePlan {
    const t = (index - 1) / (this.STAGES_PER_DIFFICULTY - 1);
    const boardType = index % 2 === 0 ? 'circle' : 'rect';
    const saw = index % 5 === 0 ? 0.25 : index % 5 === 1 && index > 1 ? -0.2 : 0;
    const percentile = Math.min(1, Math.max(0, 0.25 + 0.6 * t + saw));

    if (difficulty === 'easy') {
      return {
        params: {
          boardType,
          gridN: 9,
          dotRadius: 0.036,
          numPairs: index <= 10 ? 3 : index <= 30 ? 4 : 5,
          numChords: index <= 12 ? 1 : 2,
          mixedRatio: 0.5,
          bulge: 0.4 + 0.3 * t,
          wrapChords: index >= 35 ? 2 : 0
        },
        minForced: index <= 2 ? 0 : index <= 20 ? 1 : 2,
        minWrap: index <= 2 ? 0 : index >= 35 ? 2 : 1,
        percentile
      };
    }

    if (difficulty === 'normal') {
      const wrap = index <= 10 ? 0 : index <= 30 ? 2 : boardType === 'rect' ? 3 : 2;
      return {
        params: {
          boardType,
          gridN: 12,
          dotRadius: 0.032,
          numPairs: index <= 15 ? 4 : index <= 35 ? 5 : 6,
          numChords: index <= 15 ? 2 : 3,
          mixedRatio: 0.6,
          bulge: 0.6 + 0.3 * t,
          wrapChords: wrap
        },
        minForced: 2 + Math.floor(t * 3.99),
        minWrap: Math.max(1, wrap),
        percentile
      };
    }

    // hard: 원형 보드는 공간이 좁아 3겹 감싸기를 후반부에만 요구한다
    const wrap = boardType === 'rect' || index > 25 ? 3 : 2;
    return {
      params: {
        boardType,
        gridN: 15,
        dotRadius: 0.028,
        numPairs: index <= 15 ? 7 : index <= 35 ? 8 : 9,
        numChords: index <= 15 ? 3 : 4,
        mixedRatio: 0.6,
        bulge: 0.8 + 0.2 * t,
        wrapChords: wrap
      },
      minForced: boardType === 'rect' ? 6 + Math.floor(t * 5.99) : 5 + Math.floor(t * 2.99),
      minWrap: wrap,
      percentile
    };
  }

  private static generateStage(difficulty: DifficultyLevel, index: number): StageData {
    const stageId = this.makeId(difficulty, index);
    const plan = this.planStage(difficulty, index);
    const diffSeed = difficulty === 'easy' ? 11 : difficulty === 'normal' ? 23 : 37;

    type Cand = { stage: StageData; metrics: PuzzleMetrics };
    const qualified: Cand[] = [];
    const fallback: Cand[] = [];

    for (let s = 0; s < MAX_SEEDS && qualified.length < ENOUGH_CANDIDATES; s++) {
      const rng = mulberry32(diffSeed * 100003 + index * 7919 + s * 104729);
      const puzzle = new PuzzleGenerator(plan.params, rng).generate();
      if (!puzzle) continue;
      const stage = this.toStageData(stageId, difficulty, index, puzzle, plan.params.dotRadius);
      if (PuzzleValidator.validate(stage).length > 0) continue;
      const metrics = PuzzleAnalyzer.analyze(stage);
      const cand = { stage, metrics };
      const meets =
        metrics.forcedBends >= plan.minForced &&
        metrics.maxWrap >= plan.minWrap &&
        (plan.minForced === 0 || !metrics.trivial);
      (meets ? qualified : fallback).push(cand);
    }

    let chosen: Cand | undefined;
    if (qualified.length > 0) {
      qualified.sort((a, b) => a.metrics.score - b.metrics.score);
      chosen = qualified[Math.round(plan.percentile * (qualified.length - 1))];
    } else if (fallback.length > 0) {
      fallback.sort((a, b) => b.metrics.score - a.metrics.score);
      chosen = fallback[0];
      console.warn(`[LevelRepository] ${stageId}: 최소 난이도 요구치 미달 후보로 대체`);
    }
    if (!chosen) {
      throw new Error(`[LevelRepository] 스테이지 생성 실패: ${stageId}`);
    }

    this.analyses.set(stageId, {
      ...chosen.metrics,
      stageId,
      boardType: plan.params.boardType
    });
    return chosen.stage;
  }

  private static toStageData(
    stageId: string,
    difficulty: DifficultyLevel,
    index: number,
    puzzle: GeneratedPuzzle,
    dotRadius: number
  ): StageData {
    const dots: DotPair[] = [];
    const solutionHints: SolutionHint[] = [];
    let parLength = 0;

    puzzle.pairs.forEach((p, i) => {
      const colorInfo = COLOR_PALETTE[i % COLOR_PALETTE.length];
      const pairId = `pair_${i + 1}`;
      dots.push({
        pairId,
        color: colorInfo.color,
        colorName: colorInfo.name,
        radius: dotRadius,
        pointA: p.pointA,
        pointB: p.pointB
      });
      solutionHints.push({ pairId, color: colorInfo.color, path: p.path });
      for (let k = 0; k < p.path.length - 1; k++) {
        parLength += Math.hypot(p.path[k + 1].x - p.path[k].x, p.path[k + 1].y - p.path[k].y);
      }
    });

    return {
      stageId,
      difficulty,
      stageIndex: index,
      board: puzzle.board,
      canvas: {
        aspectRatio: '1:1',
        theme: 'sketchbook',
        // 격자 정답 경로 총 길이. 자유 곡선은 모서리를 깎아 이보다 짧게 그릴 수 있다.
        parLength
      },
      dots,
      obstacles: [],
      solutionHints
    };
  }
}
