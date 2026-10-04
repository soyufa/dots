import { DifficultyLevel, StageData, StageProgress } from '../../types/stage';
import { LevelRepository } from '../levels/LevelData';

export class StageManager {
  private currentDifficulty: DifficultyLevel = 'easy';
  private currentStageIndex: number = 1;
  private progressKey = 'connect_dots_progress_v1';

  private progressMap: Map<string, StageProgress> = new Map();

  constructor() {
    LevelRepository.init();
    this.loadProgress();
  }

  getCurrentDifficulty(): DifficultyLevel {
    return this.currentDifficulty;
  }

  setDifficulty(diff: DifficultyLevel): void {
    this.currentDifficulty = diff;
  }

  getCurrentStageIndex(): number {
    return this.currentStageIndex;
  }

  setStageIndex(index: number): void {
    this.currentStageIndex = Math.max(1, Math.min(50, index));
  }

  getCurrentStage(): StageData {
    let stage = LevelRepository.getStage(this.currentDifficulty, this.currentStageIndex);
    if (!stage) {
      stage = LevelRepository.getStage('easy', 1)!;
    }
    return stage;
  }

  getStage(difficulty: DifficultyLevel, index: number): StageData | undefined {
    return LevelRepository.getStage(difficulty, index);
  }

  getProgress(stageId: string): StageProgress {
    return this.progressMap.get(stageId) || { stars: 0, cleared: false };
  }

  saveProgress(stageId: string, stars: number, length: number): void {
    const prev = this.getProgress(stageId);
    const updatedStars = Math.max(prev.stars, stars);
    const bestLength = prev.bestLength ? Math.min(prev.bestLength, length) : length;

    this.progressMap.set(stageId, {
      stars: updatedStars,
      cleared: true,
      bestLength
    });

    this.persistProgress();
  }

  getTotalStars(difficulty?: DifficultyLevel): number {
    let total = 0;
    for (const [stageId, prog] of this.progressMap.entries()) {
      if (difficulty) {
        if (stageId.startsWith(difficulty)) {
          total += prog.stars;
        }
      } else {
        total += prog.stars;
      }
    }
    return total;
  }

  getClearedCount(difficulty: DifficultyLevel): number {
    let count = 0;
    for (let i = 1; i <= 50; i++) {
      const stageId = `${difficulty}_${i.toString().padStart(3, '0')}`;
      if (this.getProgress(stageId).cleared) {
        count++;
      }
    }
    return count;
  }

  hasNextStage(): boolean {
    if (this.currentStageIndex < 50) return true;
    if (this.currentDifficulty === 'easy' || this.currentDifficulty === 'normal') return true;
    return false;
  }

  goToNextStage(): StageData | null {
    if (this.currentStageIndex < 50) {
      this.currentStageIndex++;
    } else {
      if (this.currentDifficulty === 'easy') {
        this.currentDifficulty = 'normal';
        this.currentStageIndex = 1;
      } else if (this.currentDifficulty === 'normal') {
        this.currentDifficulty = 'hard';
        this.currentStageIndex = 1;
      } else {
        return null; // 모든 난이도 완료
      }
    }
    return this.getCurrentStage();
  }

  private loadProgress(): void {
    try {
      const raw = localStorage.getItem(this.progressKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          this.progressMap.set(k, v as StageProgress);
        }
      }
    } catch {
      this.progressMap.clear();
    }
  }

  private persistProgress(): void {
    try {
      const obj: Record<string, StageProgress> = {};
      for (const [k, v] of this.progressMap.entries()) {
        obj[k] = v;
      }
      localStorage.setItem(this.progressKey, JSON.stringify(obj));
    } catch {}
  }
}
