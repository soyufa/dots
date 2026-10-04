import { GameState, SplinePath, StageEvaluation, DrawCommand } from '../../types/game';
import { StageData, DifficultyLevel } from '../../types/stage';
import { CanvasRenderer } from '../render/CanvasRenderer';
import { SoundEngine } from '../audio/SoundEngine';
import { StageManager } from './StageManager';

export interface GameEngineEvents {
  onStateChange: (state: GameState) => void;
  onStageLoad: (stage: StageData, isCleared: boolean, stars: number) => void;
  onConnectionChange: (connectedCount: number, totalCount: number) => void;
  onStageClear: (evaluation: StageEvaluation) => void;
}

export class GameEngine {
  private state: GameState = 'LOADING';
  private stageManager: StageManager;
  private renderer: CanvasRenderer;
  private soundEngine: SoundEngine;
  private events: GameEngineEvents;

  private currentStage: StageData;
  private staticPaths: Map<string, SplinePath> = new Map();
  private commandHistory: DrawCommand[] = [];

  constructor(
    stageManager: StageManager,
    renderer: CanvasRenderer,
    soundEngine: SoundEngine,
    events: GameEngineEvents
  ) {
    this.stageManager = stageManager;
    this.renderer = renderer;
    this.soundEngine = soundEngine;
    this.events = events;

    this.currentStage = this.stageManager.getCurrentStage();
  }

  init(): void {
    this.loadCurrentStage();
  }

  getState(): GameState {
    return this.state;
  }

  setState(newState: GameState): void {
    this.state = newState;
    this.events.onStateChange(this.state);
  }

  getCurrentStage(): StageData {
    return this.currentStage;
  }

  getStaticPaths(): Map<string, SplinePath> {
    return this.staticPaths;
  }

  /**
   * 지정한 난이도와 스테이지로 전환
   */
  selectStage(difficulty: DifficultyLevel, index: number): void {
    this.stageManager.setDifficulty(difficulty);
    this.stageManager.setStageIndex(index);
    this.loadCurrentStage();
  }

  /**
   * 다음 스테이지로 진행
   */
  nextStage(): boolean {
    const next = this.stageManager.goToNextStage();
    if (next) {
      this.loadCurrentStage();
      return true;
    }
    return false;
  }

  /**
   * 현재 스테이지 다시 시작
   */
  restartStage(): void {
    this.loadCurrentStage();
  }

  private loadCurrentStage(): void {
    this.currentStage = this.stageManager.getCurrentStage();
    this.staticPaths.clear();
    this.commandHistory = [];

    this.renderer.setStage(this.currentStage);
    this.renderer.clearActive();

    const progress = this.stageManager.getProgress(this.currentStage.stageId);
    this.setState('PLAYING');

    this.events.onStageLoad(this.currentStage, progress.cleared, progress.stars);
    this.events.onConnectionChange(0, this.currentStage.dots.length);
  }

  /**
   * 선 연결 완료 처리
   */
  handlePathComplete(pairId: string, path: SplinePath): void {
    const prev = this.staticPaths.get(pairId);
    this.staticPaths.set(pairId, path);

    this.commandHistory.push({
      type: 'CONNECT',
      pairId,
      previousPath: prev,
      newPath: path
    });

    this.renderer.setStaticPaths(this.staticPaths);
    this.renderer.clearActive();

    const targetDot = this.currentStage.dots.find((d) => d.pairId === pairId);
    if (targetDot) {
      this.renderer.triggerSnapFX(targetDot.pointB, path.color);
    }

    this.events.onConnectionChange(this.staticPaths.size, this.currentStage.dots.length);

    // 전체 클리어 판정 검사
    this.checkStageCompletion();
  }

  /**
   * 특정 점 쌍 선분 삭제 처리 (Tap-to-Erase 또는 덮어쓰기)
   */
  handlePathErase(pairId: string): void {
    const prev = this.staticPaths.get(pairId);
    if (!prev) return;

    this.staticPaths.delete(pairId);
    this.commandHistory.push({
      type: 'ERASE',
      pairId,
      previousPath: prev
    });

    this.renderer.setStaticPaths(this.staticPaths);
    this.events.onConnectionChange(this.staticPaths.size, this.currentStage.dots.length);
  }

  /**
   * 실행 취소 (Undo)
   */
  undo(): boolean {
    if (this.commandHistory.length === 0) return false;

    const lastCmd = this.commandHistory.pop()!;
    if (lastCmd.type === 'CONNECT') {
      if (lastCmd.previousPath) {
        this.staticPaths.set(lastCmd.pairId, lastCmd.previousPath);
      } else {
        this.staticPaths.delete(lastCmd.pairId);
      }
    } else if (lastCmd.type === 'ERASE') {
      if (lastCmd.previousPath) {
        this.staticPaths.set(lastCmd.pairId, lastCmd.previousPath);
      }
    }

    this.soundEngine.playErasePop();
    this.renderer.setStaticPaths(this.staticPaths);
    this.events.onConnectionChange(this.staticPaths.size, this.currentStage.dots.length);
    return true;
  }

  /**
   * 전체 초기화 (Reset)
   */
  reset(): void {
    if (this.staticPaths.size === 0) return;

    this.soundEngine.playErasePop();
    this.staticPaths.clear();
    this.commandHistory = [];
    this.renderer.setStaticPaths(this.staticPaths);
    this.renderer.clearActive();
    this.renderer.clearHint();
    this.events.onConnectionChange(0, this.currentStage.dots.length);
  }

  /**
   * 힌트 사용
   */
  requestHint(): boolean {
    if (!this.currentStage.solutionHints || this.currentStage.solutionHints.length === 0) {
      return false;
    }

    // 아직 연결되지 않은 점 쌍 중 첫 번째 힌트 찾기
    for (const hint of this.currentStage.solutionHints) {
      if (!this.staticPaths.has(hint.pairId)) {
        const dot = this.currentStage.dots.find((d) => d.pairId === hint.pairId);
        const color = dot ? dot.color : '#FFA502';
        this.renderer.showHint(hint.path, color);
        return true;
      }
    }
    return false;
  }

  /**
   * 모든 점 쌍 연결 검사 및 클리어 평가
   */
  private checkStageCompletion(): void {
    const totalPairs = this.currentStage.dots.length;
    if (this.staticPaths.size < totalPairs) return;

    // 모든 선이 연결되었을 때 클리어 평가
    let userTotalLength = 0;
    this.staticPaths.forEach((path) => {
      userTotalLength += path.totalLength;
    });

    const parLength = this.currentStage.canvas.parLength;
    const ratio = userTotalLength / Math.max(parLength, 0.1);

    // 3스타 산출 공식
    let stars = 1;
    if (ratio <= 1.18) {
      stars = 3;
    } else if (ratio <= 1.38) {
      stars = 2;
    }

    const evaluation: StageEvaluation = {
      isCleared: true,
      stars,
      userTotalLength: parseFloat(userTotalLength.toFixed(2)),
      parLength,
      efficiencyRatio: Math.min(100, Math.round((parLength / Math.max(userTotalLength, 0.01)) * 100))
    };

    // 저장 및 연출
    this.stageManager.saveProgress(this.currentStage.stageId, stars, userTotalLength);
    this.setState('STAGE_CLEAR');

    this.soundEngine.playStageClearFanfare();
    this.renderer.triggerClearConfetti();

    setTimeout(() => {
      this.events.onStageClear(evaluation);
    }, 450);
  }
}
