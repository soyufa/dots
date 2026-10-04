import './style.css';
import { CanvasRenderer } from './core/render/CanvasRenderer';
import { SoundEngine } from './core/audio/SoundEngine';
import { StageManager } from './core/game/StageManager';
import { GameEngine } from './core/game/GameEngine';
import { InputManager } from './core/input/InputManager';
import { UIManager } from './ui/UIManager';
import { Point2D } from './types/geometry';
import { SplinePath } from './types/game';

window.addEventListener('DOMContentLoaded', () => {
  // DOM 캔버스 엘리먼트
  const canvasCard = document.getElementById('canvas-card') as HTMLElement;
  const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
  const staticCanvas = document.getElementById('static-canvas') as HTMLCanvasElement;
  const activeCanvas = document.getElementById('active-canvas') as HTMLCanvasElement;
  const fxCanvas = document.getElementById('fx-canvas') as HTMLCanvasElement;

  if (!canvasCard || !bgCanvas || !staticCanvas || !activeCanvas || !fxCanvas) {
    console.error('캔버스 DOM 요소를 찾을 수 없습니다.');
    return;
  }

  // 1. 코어 서브시스템 생성
  const soundEngine = SoundEngine.getInstance();
  const renderer = new CanvasRenderer(bgCanvas, staticCanvas, activeCanvas, fxCanvas);
  const stageManager = new StageManager();

  let uiManager: UIManager | null = null;
  let inputManager: InputManager | null = null;

  // 2. 게임 엔진 생성
  const gameEngine = new GameEngine(stageManager, renderer, soundEngine, {
    onStateChange: (state) => {
      console.log(`[GameEngine State]: ${state}`);
    },
    onStageLoad: (stage, _cleared, _stars) => {
      uiManager?.updateStageHeader(stage);
      inputManager?.setStage(stage);
      inputManager?.setStaticPaths(gameEngine.getStaticPaths());
    },
    onConnectionChange: (connectedCount, totalCount) => {
      uiManager?.updateConnectionCount(connectedCount, totalCount);
      inputManager?.setStaticPaths(gameEngine.getStaticPaths());
    },
    onStageClear: (evaluation) => {
      uiManager?.showClearModal(evaluation);
    }
  });

  // 3. 입력 관리자 생성
  inputManager = new InputManager(canvasCard, soundEngine, {
    onPathComplete: (pairId: string, path: SplinePath) => {
      gameEngine.handlePathComplete(pairId, path);
    },
    onPathErase: (pairId: string) => {
      gameEngine.handlePathErase(pairId);
    },
    onDrawStart: () => {
      // 드로잉 시작 시 동작
    },
    onDrawUpdate: (points: Point2D[], color: string) => {
      renderer.setActivePath(points, color);
    },
    onDrawCancel: () => {
      renderer.clearActive();
    },
    onCollision: (pos: Point2D) => {
      renderer.triggerCollisionFX(pos);
    }
  });

  // 4. UI 관리자 생성
  uiManager = new UIManager(stageManager, gameEngine, soundEngine);

  // 5. 반응형 캔버스 리사이즈 함수
  const updateCanvasSize = () => {
    const rect = canvasCard.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      renderer.resize(rect.width, rect.height);
      renderer.setStaticPaths(gameEngine.getStaticPaths());
    }
  };

  // 초기 캔버스 사이즈 설정 및 윈도우 리사이즈 옵저버 등록
  const resizeObserver = new ResizeObserver(() => {
    updateCanvasSize();
  });
  resizeObserver.observe(canvasCard);
  window.addEventListener('resize', updateCanvasSize);

  // 6. 게임 시작
  gameEngine.init();
  updateCanvasSize();
});
