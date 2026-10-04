import { DifficultyLevel, StageData } from '../types/stage';
import { StageEvaluation } from '../types/game';
import { StageManager } from '../core/game/StageManager';
import { GameEngine } from '../core/game/GameEngine';
import { SoundEngine } from '../core/audio/SoundEngine';

export class UIManager {
  private stageManager: StageManager;
  private gameEngine: GameEngine;
  private soundEngine: SoundEngine;

  // DOM 요소 캐시
  private currentStageTitle!: HTMLElement;
  private difficultyBadge!: HTMLElement;
  private totalStarsCounter!: HTMLElement;
  private connectionStatus!: HTMLElement;
  private boardGuideText!: HTMLElement;
  private btnMute!: HTMLButtonElement;
  private btnHint!: HTMLButtonElement;
  private btnUndo!: HTMLButtonElement;
  private btnReset!: HTMLButtonElement;
  private btnStageSelect!: HTMLButtonElement;

  // 모달
  private stageSelectModal!: HTMLElement;
  private btnCloseStageSelect!: HTMLButtonElement;
  private stageGridContainer!: HTMLElement;
  private diffTabs!: NodeListOf<HTMLButtonElement>;

  private clearModal!: HTMLElement;
  private clearStarsContainer!: HTMLElement;
  private clearEfficiencyText!: HTMLElement;
  private btnNextStage!: HTMLButtonElement;
  private btnReplayStage!: HTMLButtonElement;
  private btnClearToSelect!: HTMLButtonElement;

  private selectedDiffTab: DifficultyLevel = 'easy';

  constructor(stageManager: StageManager, gameEngine: GameEngine, soundEngine: SoundEngine) {
    this.stageManager = stageManager;
    this.gameEngine = gameEngine;
    this.soundEngine = soundEngine;

    this.cacheDOMElements();
    this.bindEvents();
  }

  private cacheDOMElements(): void {
    this.currentStageTitle = document.getElementById('current-stage-title')!;
    this.difficultyBadge = document.getElementById('difficulty-badge')!;
    this.totalStarsCounter = document.getElementById('total-stars-counter')!;
    this.connectionStatus = document.getElementById('connection-status')!;
    this.boardGuideText = document.getElementById('board-guide-text')!;
    this.btnMute = document.getElementById('btn-mute') as HTMLButtonElement;
    this.btnHint = document.getElementById('btn-hint') as HTMLButtonElement;
    this.btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
    this.btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
    this.btnStageSelect = document.getElementById('btn-stage-select') as HTMLButtonElement;

    this.stageSelectModal = document.getElementById('stage-select-modal')!;
    this.btnCloseStageSelect = document.getElementById('btn-close-stage-select') as HTMLButtonElement;
    this.stageGridContainer = document.getElementById('stage-grid-container')!;
    this.diffTabs = document.querySelectorAll('.diff-tab-btn');

    this.clearModal = document.getElementById('clear-modal')!;
    this.clearStarsContainer = document.getElementById('clear-stars-container')!;
    this.clearEfficiencyText = document.getElementById('clear-efficiency-text')!;
    this.btnNextStage = document.getElementById('btn-next-stage') as HTMLButtonElement;
    this.btnReplayStage = document.getElementById('btn-replay-stage') as HTMLButtonElement;
    this.btnClearToSelect = document.getElementById('btn-clear-to-select') as HTMLButtonElement;
  }

  private bindEvents(): void {
    // 툴바 버튼
    this.btnMute.addEventListener('click', () => {
      const isMuted = this.soundEngine.toggleMute();
      this.btnMute.textContent = isMuted ? '🔇' : '🔊';
      this.btnMute.classList.toggle('active', isMuted);
    });

    this.btnHint.addEventListener('click', () => {
      const success = this.gameEngine.requestHint();
      if (!success) {
        this.btnHint.classList.add('shake');
        setTimeout(() => this.btnHint.classList.remove('shake'), 400);
      }
    });

    this.btnUndo.addEventListener('click', () => {
      this.gameEngine.undo();
    });

    this.btnReset.addEventListener('click', () => {
      this.gameEngine.reset();
    });

    this.btnStageSelect.addEventListener('click', () => {
      this.openStageSelectModal();
    });

    this.btnCloseStageSelect.addEventListener('click', () => {
      this.closeStageSelectModal();
    });

    // 난이도 탭 전환
    this.diffTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const diff = tab.dataset.diff as DifficultyLevel;
        if (diff) {
          this.selectedDiffTab = diff;
          this.updateDiffTabs();
          this.renderStageGrid();
        }
      });
    });

    // 클리어 모달 버튼
    this.btnNextStage.addEventListener('click', () => {
      this.clearModal.classList.add('hidden');
      if (!this.gameEngine.nextStage()) {
        // 모든 스테이지 완료 시 목록으로
        this.openStageSelectModal();
      }
    });

    this.btnReplayStage.addEventListener('click', () => {
      this.clearModal.classList.add('hidden');
      this.gameEngine.restartStage();
    });

    this.btnClearToSelect.addEventListener('click', () => {
      this.clearModal.classList.add('hidden');
      this.openStageSelectModal();
    });
  }

  updateStageHeader(stage: StageData): void {
    const diffNames: Record<DifficultyLevel, string> = {
      easy: 'EASY',
      normal: 'NORMAL',
      hard: 'HARD'
    };

    this.currentStageTitle.textContent = `STAGE ${stage.stageIndex}`;
    this.difficultyBadge.textContent = diffNames[stage.difficulty];
    this.difficultyBadge.className = `diff-badge diff-${stage.difficulty}`;
    this.totalStarsCounter.textContent = `★ ${this.stageManager.getTotalStars()}`;

    if (this.boardGuideText) {
      if (stage.board?.type === 'circle') {
        this.boardGuideText.textContent = '⚪ 원형 보드 (외곽 밖 차단)';
      } else {
        this.boardGuideText.textContent = '⏹ 사각 보드 (테두리 밖 차단)';
      }
    }
  }

  showWarningToast(msg: string): void {
    if (this.boardGuideText) {
      const original = this.boardGuideText.textContent;
      this.boardGuideText.textContent = msg;
      this.boardGuideText.style.color = '#FF3838';
      this.boardGuideText.style.fontWeight = 'bold';
      setTimeout(() => {
        if (this.boardGuideText) {
          this.boardGuideText.textContent = original;
          this.boardGuideText.style.color = '';
          this.boardGuideText.style.fontWeight = '';
        }
      }, 2500);
    }
  }

  updateConnectionCount(connected: number, total: number): void {
    this.connectionStatus.textContent = `연결: ${connected} / ${total}`;
  }

  showClearModal(evaluation: StageEvaluation): void {
    this.clearModal.classList.remove('hidden');

    // 별점 렌더링
    this.clearStarsContainer.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const starSpan = document.createElement('span');
      starSpan.className = `star-item ${i <= evaluation.stars ? 'active' : 'inactive'}`;
      starSpan.textContent = '★';
      this.clearStarsContainer.appendChild(starSpan);
    }

    this.clearEfficiencyText.textContent = `경로 효율성: ${evaluation.efficiencyRatio}% (사용 길이: ${evaluation.userTotalLength})`;
    this.totalStarsCounter.textContent = `★ ${this.stageManager.getTotalStars()}`;
  }

  openStageSelectModal(): void {
    this.selectedDiffTab = this.stageManager.getCurrentDifficulty();
    this.updateDiffTabs();
    this.renderStageGrid();
    this.stageSelectModal.classList.remove('hidden');
  }

  closeStageSelectModal(): void {
    this.stageSelectModal.classList.add('hidden');
  }

  private updateDiffTabs(): void {
    this.diffTabs.forEach((tab) => {
      if (tab.dataset.diff === this.selectedDiffTab) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }

  private renderStageGrid(): void {
    this.stageGridContainer.innerHTML = '';
    const diff = this.selectedDiffTab;
    const currentDiff = this.stageManager.getCurrentDifficulty();
    const currentIndex = this.stageManager.getCurrentStageIndex();

    for (let i = 1; i <= 50; i++) {
      const stageId = `${diff}_${i.toString().padStart(3, '0')}`;
      const progress = this.stageManager.getProgress(stageId);
      const isCurrent = diff === currentDiff && i === currentIndex;

      const card = document.createElement('div');
      card.className = `stage-card ${progress.cleared ? 'cleared' : ''} ${isCurrent ? 'current' : ''}`;

      const numSpan = document.createElement('span');
      numSpan.className = 'stage-number';
      numSpan.textContent = `${i}`;

      const starDiv = document.createElement('div');
      starDiv.className = 'stage-stars';
      starDiv.textContent = progress.cleared ? '★'.repeat(progress.stars) + '☆'.repeat(3 - progress.stars) : '☆☆☆';

      card.appendChild(numSpan);
      card.appendChild(starDiv);

      card.addEventListener('click', () => {
        this.gameEngine.selectStage(diff, i);
        this.closeStageSelectModal();
      });

      this.stageGridContainer.appendChild(card);
    }
  }
}
