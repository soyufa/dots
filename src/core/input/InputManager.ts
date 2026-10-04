import { Point2D, LineSegment } from '../../types/geometry';
import { DotPair, Obstacle, StageData } from '../../types/stage';
import { SplinePath } from '../../types/game';
import { Vector2 } from '../math/Vector2';
import { Spline } from '../math/Spline';
import { Intersection } from '../physics/Intersection';
import { SoundEngine } from '../audio/SoundEngine';

export interface InputCallbacks {
  onPathComplete: (pairId: string, path: SplinePath) => void;
  onPathErase: (pairId: string) => void;
  onDrawStart?: () => void;
  onDrawUpdate?: (points: Point2D[], color: string) => void;
  onDrawCancel?: () => void;
  onCollision?: (pos: Point2D) => void;
}

export class InputManager {
  private container: HTMLElement;
  private soundEngine: SoundEngine;
  private callbacks: InputCallbacks;

  private currentStage: StageData | null = null;
  private staticPaths: Map<string, SplinePath> = new Map();

  // 드래그 및 입력 상태
  private isPointerDown: boolean = false;
  private pointerId: number | null = null;
  private startScreenPos: Point2D = { x: 0, y: 0 };
  private startTime: number = 0;
  private isDrawing: boolean = false;

  private activePair: DotPair | null = null;
  private activeStartTarget: 'pointA' | 'pointB' | null = null;
  private activePoints: Point2D[] = [];
  private activeSegments: LineSegment[] = [];
  private stashedExistingPath: SplinePath | null = null;

  constructor(container: HTMLElement, soundEngine: SoundEngine, callbacks: InputCallbacks) {
    this.container = container;
    this.soundEngine = soundEngine;
    this.callbacks = callbacks;

    this.bindEvents();
  }

  setStage(stage: StageData): void {
    this.currentStage = stage;
    this.cancelDrawing();
  }

  setStaticPaths(paths: Map<string, SplinePath>): void {
    this.staticPaths = paths;
  }

  private bindEvents(): void {
    this.container.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
  }

  destroy(): void {
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);
  }

  /**
   * 클라이언트 CSS 화면 좌표 -> 0.0~1.0 정규화 좌표 변환
   */
  private screenToNormalized(screenX: number, screenY: number): Point2D {
    const rect = this.container.getBoundingClientRect();
    const x = (screenX - rect.left) / rect.width;
    const y = (screenY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y))
    };
  }

  private handlePointerDown = (e: PointerEvent): void => {
    // 마우스 좌클릭 또는 터치만 처리
    if (e.button !== 0) return;

    this.soundEngine.unlock();
    this.isPointerDown = true;
    this.pointerId = e.pointerId;
    this.startScreenPos = { x: e.clientX, y: e.clientY };
    this.startTime = performance.now();
    this.isDrawing = false;
    this.activePoints = [];
    this.activeSegments = [];

    const normPos = this.screenToNormalized(e.clientX, e.clientY);

    // 1. 점(Dot) 위를 터치했는지 확인
    const hitDot = this.findHitDot(normPos);
    if (hitDot) {
      this.activePair = hitDot.pair;
      this.activeStartTarget = hitDot.target;
      return;
    }

    // 2. 완성된 선 위를 터치했는지 확인 (Tap-to-Erase 후보)
    this.activePair = null;
    this.activeStartTarget = null;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.isPointerDown || e.pointerId !== this.pointerId) return;

    const normPos = this.screenToNormalized(e.clientX, e.clientY);
    const screenDist = Math.hypot(e.clientX - this.startScreenPos.x, e.clientY - this.startScreenPos.y);

    // 아직 드로잉 모드가 아니고 드래그 임계값(8px)을 넘은 경우
    if (!this.isDrawing) {
      if (screenDist > 8 && this.activePair && this.activeStartTarget) {
        // 시작 직후 목표 위치가 테두리 밖인 경우 즉각 차단
        if (!this.isInsideBoard(normPos)) {
          this.triggerReboundBlock(normPos);
          return;
        }

        // 드로잉 개시!
        this.isDrawing = true;

        // [Redraw 메카닉]: 이미 연결된 선이 있다면 임시 백업(stashedExistingPath) 후 새 드로잉 시작
        if (this.staticPaths.has(this.activePair.pairId)) {
          this.stashedExistingPath = this.staticPaths.get(this.activePair.pairId) || null;
          this.callbacks.onPathErase(this.activePair.pairId);
        } else {
          this.stashedExistingPath = null;
        }

        const startPoint = this.activeStartTarget === 'pointA' ? this.activePair.pointA : this.activePair.pointB;
        this.activePoints = [{ ...startPoint }, normPos];
        this.activeSegments = [{ p1: startPoint, p2: normPos }];

        this.soundEngine.startDrawingSound();
        this.callbacks.onDrawStart?.();
        this.callbacks.onDrawUpdate?.(this.activePoints, this.activePair.color);
      }
      return;
    }

    // 드로잉 진행 중
    if (this.isDrawing && this.activePair) {
      const prevPoint = this.activePoints[this.activePoints.length - 1];
      const distFromPrev = Vector2.distance(prevPoint, normPos);

      // 너무 미세한 이동은 스킵하여 연산 최적화
      if (distFromPrev < 0.012) return;

      // [즉각 차단(Rebound / Block) 0순위: 보드 테두리 밖 이탈 절대 차단]
      if (!this.isInsideBoard(normPos)) {
        this.triggerReboundBlock(normPos);
        return;
      }

      const newSegment: LineSegment = { p1: prevPoint, p2: normPos };

      // [고속 드래그 터널링 방지 서브스텝 보간 및 즉각 차단 검사]
      const existingLines = Array.from(this.staticPaths.values()).map((p) => ({
        pairId: p.pairId,
        segments: p.tessellatedSegments
      }));

      const stepCount = Math.max(1, Math.ceil(distFromPrev / 0.012));
      for (let s = 1; s <= stepCount; s++) {
        const subT = s / stepCount;
        const subPos = Vector2.lerp(prevPoint, normPos, subT);
        const subPrev = s === 1 ? prevPoint : Vector2.lerp(prevPoint, normPos, (s - 1) / stepCount);
        const subSegment: LineSegment = { p1: subPrev, p2: subPos };

        // 0. 서브스텝 단위 보드 테두리 밖 이탈 실시간 검사 (1픽셀도 밖으로 나갈 수 없음)
        if (!this.isInsideBoard(subPos)) {
          this.triggerReboundBlock(subPos);
          return;
        }

        // 1. 타 색상 선분과의 교차 검사 (최소 안전 간격 0.006 적용)
        const intersectCheck = Intersection.doesSegmentIntersectExistingLines(
          subSegment,
          existingLines,
          this.activePair.pairId,
          0.006
        );

        if (intersectCheck.hit) {
          this.triggerReboundBlock(subPos);
          return;
        }

        // 2. 장애물 충돌 검사
        if (this.currentStage) {
          for (const obs of this.currentStage.obstacles) {
            if (Intersection.doesSegmentIntersectObstacle(subPrev, subPos, obs)) {
              this.triggerReboundBlock(subPos);
              return;
            }
          }
        }
      }

      // 3. 다른 색상 점 중심 관통 검사 (Keep-out zone: 점 핵 중심부 0.45만 차단)
      if (this.currentStage) {
        for (const otherPair of this.currentStage.dots) {
          if (otherPair.pairId === this.activePair.pairId) continue;
          const keepOutRadius = otherPair.radius * 0.45;
          if (
            Intersection.doesSegmentIntersectCircle(prevPoint, normPos, otherPair.pointA, keepOutRadius) ||
            Intersection.doesSegmentIntersectCircle(prevPoint, normPos, otherPair.pointB, keepOutRadius)
          ) {
            this.triggerReboundBlock(normPos);
            return;
          }
        }
      }

      // 4. 자기 교차 검사
      this.activePoints.push(normPos);
      this.activeSegments.push(newSegment);
      if (Intersection.doesPathSelfIntersect(this.activeSegments)) {
        this.triggerReboundBlock(normPos);
        return;
      }

      // 5. 반대편 짝 점 스냅 및 연결 완료 검사
      const targetPoint = this.activeStartTarget === 'pointA' ? this.activePair.pointB : this.activePair.pointA;
      const distToTarget = Vector2.distance(normPos, targetPoint);
      const snapRadius = this.activePair.radius * 1.5;

      if (distToTarget <= snapRadius) {
        const finalSegment: LineSegment = { p1: normPos, p2: targetPoint };

        // [도착점 스냅 직전 마지막 선분 충돌 및 교차 검사]
        // 1) 타 색상 선분과의 교차 검사
        const snapIntersectCheck = Intersection.doesSegmentIntersectExistingLines(
          finalSegment,
          existingLines,
          this.activePair.pairId
        );
        if (snapIntersectCheck.hit) {
          this.triggerReboundBlock(normPos);
          return;
        }

        // 2) 장애물 충돌 검사
        if (this.currentStage) {
          for (const obs of this.currentStage.obstacles) {
            if (Intersection.doesSegmentIntersectObstacle(normPos, targetPoint, obs)) {
              this.triggerReboundBlock(normPos);
              return;
            }
          }
        }

        // 3) 다른 색상 점 중심 관통 검사 (Keep-out zone: 점 핵 중심부 0.45만 차단)
        if (this.currentStage) {
          for (const otherPair of this.currentStage.dots) {
            if (otherPair.pairId === this.activePair.pairId) continue;
            const keepOutRadius = otherPair.radius * 0.45;
            if (
              Intersection.doesSegmentIntersectCircle(normPos, targetPoint, otherPair.pointA, keepOutRadius) ||
              Intersection.doesSegmentIntersectCircle(normPos, targetPoint, otherPair.pointB, keepOutRadius)
            ) {
              this.triggerReboundBlock(normPos);
              return;
            }
          }
        }

        // 4) 자기 교차 검사 (스냅 선분 포함)
        const testSegments = [...this.activeSegments, finalSegment];
        if (Intersection.doesPathSelfIntersect(testSegments)) {
          this.triggerReboundBlock(normPos);
          return;
        }

        // 끝점까지 안전하게 스냅 및 완료
        this.activePoints.push({ ...targetPoint });
        this.activeSegments.push(finalSegment);
        this.completeDrawing();
        return;
      }

      // 정상 경로 갱신
      this.callbacks.onDrawUpdate?.(this.activePoints, this.activePair.color);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.isPointerDown || e.pointerId !== this.pointerId) return;

    const screenDist = Math.hypot(e.clientX - this.startScreenPos.x, e.clientY - this.startScreenPos.y);
    const duration = performance.now() - this.startTime;
    const normPos = this.screenToNormalized(e.clientX, e.clientY);

    // [Tap-to-Erase 메카닉]
    if (!this.isDrawing && screenDist < 8 && duration < 300) {
      this.handleTapToErase(normPos);
    }

    if (this.isDrawing) {
      // 반대편 점에 닿지 못하고 허공에서 손을 뗀 경우 -> 취소
      this.cancelDrawing();
    }

    this.isPointerDown = false;
    this.pointerId = null;
    this.activePair = null;
    this.activeStartTarget = null;
  };

  private handlePointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) {
      this.cancelDrawing();
      this.isPointerDown = false;
      this.pointerId = null;
      this.activePair = null;
      this.activeStartTarget = null;
    }
  };

  /**
   * 점 또는 선을 탭했을 때 해당 색상 선 지우기
   */
  private handleTapToErase(normPos: Point2D): void {
    // 1. 점 탭 검사
    const hitDot = this.findHitDot(normPos);
    if (hitDot) {
      if (this.staticPaths.has(hitDot.pair.pairId)) {
        this.soundEngine.playErasePop();
        this.triggerHaptic('light');
        this.callbacks.onPathErase(hitDot.pair.pairId);
        return;
      }
    }

    // 2. 완성된 선 탭 검사 (선분과의 거리 검사)
    for (const [pairId, spline] of this.staticPaths.entries()) {
      for (const seg of spline.tessellatedSegments) {
        const d = Vector2.distanceToSegment(normPos, seg.p1, seg.p2);
        if (d < 0.04) {
          // 선분 근처 탭 감지
          this.soundEngine.playErasePop();
          this.triggerHaptic('light');
          this.callbacks.onPathErase(pairId);
          return;
        }
      }
    }
  }

  /**
   * 점/선 좌표가 보드 내부(테두리 안쪽)에 있는지 엄격하게 검사
   * 테두리 밖으로 단 1픽셀도 나갈 수 없도록 margin = 0 철저 적용
   */
  private isInsideBoard(point: Point2D): boolean {
    if (!this.currentStage || !this.currentStage.board) return true;
    const board = this.currentStage.board;

    if (board.type === 'circle') {
      const dist = Math.hypot(point.x - board.centerX, point.y - board.centerY);
      return dist <= board.radius;
    } else if (board.type === 'rect') {
      return (
        point.x >= board.bounds.minX &&
        point.x <= board.bounds.maxX &&
        point.y >= board.bounds.minY &&
        point.y <= board.bounds.maxY
      );
    }
    return true;
  }

  /**
   * 충돌 발생 시 차단(Rebound) 피드백 및 드로잉 즉각 취소/삭제
   */
  private triggerReboundBlock(collisionPos: Point2D): void {
    this.soundEngine.stopDrawingSound();
    this.soundEngine.playCollisionBuzzer();
    this.triggerHaptic('error');

    // 화면 쉐이크(흔들림) 효과
    this.container.classList.add('shake');
    setTimeout(() => this.container.classList.remove('shake'), 350);

    this.callbacks.onCollision?.(collisionPos);
    this.cancelDrawing();

    // [핵심 버그 수정] 충돌 즉시 현재 터치/드래그를 완전히 종료 및 무효화!
    // 마우스를 누른 채로 계속 움직여도 선이 다시 생기거나 이어지지 않도록 철저히 리셋
    this.isPointerDown = false;
    this.pointerId = null;
    this.activePair = null;
    this.activeStartTarget = null;
    this.isDrawing = false;
    this.activePoints = [];
    this.activeSegments = [];
  }

  /**
   * 드로잉 성공 완료 처리
   */
  private completeDrawing(): void {
    if (!this.activePair) return;

    this.soundEngine.stopDrawingSound();
    const pairId = this.activePair.pairId;
    const color = this.activePair.color;
    const rawPoints = [...this.activePoints];

    // 스플라인 곡선 포인트 생성 (렌더링과 1:1 일치하는 고밀도 세그먼트 생성)
    const splinePoints = Spline.generateSplinePoints(rawPoints, 6);
    const tessellatedSegments = Spline.tessellatePath(splinePoints);
    const totalLength = Spline.calculatePathLength(splinePoints);

    // [최종 게이트: 완성된 전체 경로가 기존의 다른 경로들과 교차하는지 전수 검증]
    const existingLines = Array.from(this.staticPaths.values()).map((p) => ({
      pairId: p.pairId,
      segments: p.tessellatedSegments
    }));

    for (const seg of tessellatedSegments) {
      if (Intersection.doesSegmentIntersectExistingLines(seg, existingLines, pairId, 0.005).hit) {
        // 교차 발생 시 스냅 및 완료 즉각 차단!
        this.triggerReboundBlock(rawPoints[rawPoints.length - 1]);
        return;
      }
    }

    const completedPath: SplinePath = {
      pairId,
      color,
      rawPoints,
      tessellatedSegments,
      totalLength,
      isComplete: true
    };

    // 음계 사운드 및 햅틱
    const colorIndex = parseInt(pairId.replace('pair_', '')) - 1;
    this.soundEngine.playConnectTone(isNaN(colorIndex) ? 0 : colorIndex);
    this.triggerHaptic('success');

    // 정상 완료 시 이전 백업 경로는 새 경로로 덮어써지므로 폐기
    this.stashedExistingPath = null;

    this.callbacks.onPathComplete(pairId, completedPath);

    this.isDrawing = false;
    this.isPointerDown = false;
    this.activePoints = [];
    this.activeSegments = [];
    this.activePair = null;
    this.activeStartTarget = null;
  }

  /**
   * 재드래그 취소 또는 충돌 시 백업해둔 기존 경로를 롤백(복원)
   */
  private rollbackStashedPath(): void {
    if (this.stashedExistingPath) {
      this.callbacks.onPathComplete(this.stashedExistingPath.pairId, this.stashedExistingPath);
      this.stashedExistingPath = null;
    }
  }

  private cancelDrawing(): void {
    this.soundEngine.stopDrawingSound();
    // 화면의 활성 선분을 즉시 완전히 지움
    this.callbacks.onDrawCancel?.();
    // 취소 시 기존 백업 경로가 있다면 복원
    this.rollbackStashedPath();

    this.isDrawing = false;
    this.activePoints = [];
    this.activeSegments = [];
  }

  private findHitDot(pos: Point2D): { pair: DotPair; target: 'pointA' | 'pointB' } | null {
    if (!this.currentStage) return null;

    for (const pair of this.currentStage.dots) {
      const hitRadius = pair.radius * 1.5; // 터치 편의를 위해 1.5배 히트박스 적용
      if (Vector2.distance(pos, pair.pointA) <= hitRadius) {
        return { pair, target: 'pointA' };
      }
      if (Vector2.distance(pos, pair.pointB) <= hitRadius) {
        return { pair, target: 'pointB' };
      }
    }
    return null;
  }

  private triggerHaptic(type: 'light' | 'success' | 'error'): void {
    try {
      if ('vibrate' in navigator) {
        if (type === 'light') {
          navigator.vibrate(15);
        } else if (type === 'success') {
          navigator.vibrate([20, 30, 40]);
        } else if (type === 'error') {
          navigator.vibrate([60, 40, 60]);
        }
      }
    } catch {}
  }
}
