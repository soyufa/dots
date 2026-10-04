import { Point2D } from '../../types/geometry';
import { DotPair, Obstacle, StageData } from '../../types/stage';
import { SplinePath } from '../../types/game';
import { Spline } from '../math/Spline';
import { Vector2 } from '../math/Vector2';
import { GameRules } from '../rules/GameRules';

interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  decay: number;
}

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vr: number;
  angle: number;
  color: string;
  size: number;
  alpha: number;
  decay: number;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
  decay: number;
}

export class CanvasRenderer {
  private bgCanvas: HTMLCanvasElement;
  private staticCanvas: HTMLCanvasElement;
  private activeCanvas: HTMLCanvasElement;
  private fxCanvas: HTMLCanvasElement;

  private bgCtx: CanvasRenderingContext2D;
  private staticCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private fxCtx: CanvasRenderingContext2D;

  private widthCss: number = 0;
  private heightCss: number = 0;
  private dpr: number = 1;

  private currentStage: StageData | null = null;
  private staticPaths: Map<string, SplinePath> = new Map();
  private activePath: Point2D[] = [];
  private activeColor: string = '#FF4757';
  private hintPath: Point2D[] | null = null;
  private hintColor: string = '#FFA502';
  private hintAlpha: number = 0;

  // 파티클 & FX 상태
  private sparks: SparkParticle[] = [];
  private confetti: ConfettiParticle[] = [];
  private shockwaves: Shockwave[] = [];
  private animFrameId: number | null = null;
  private pulseTime: number = 0;

  constructor(
    bgCanvas: HTMLCanvasElement,
    staticCanvas: HTMLCanvasElement,
    activeCanvas: HTMLCanvasElement,
    fxCanvas: HTMLCanvasElement
  ) {
    this.bgCanvas = bgCanvas;
    this.staticCanvas = staticCanvas;
    this.activeCanvas = activeCanvas;
    this.fxCanvas = fxCanvas;

    this.bgCtx = this.bgCanvas.getContext('2d', { alpha: true })!;
    this.staticCtx = this.staticCanvas.getContext('2d', { alpha: true })!;
    this.activeCtx = this.activeCanvas.getContext('2d', { alpha: true })!;
    this.fxCtx = this.fxCanvas.getContext('2d', { alpha: true })!;

    this.startFXLoop();
  }

  /**
   * HiDPI 스케일링 동기화 및 리사이즈
   */
  resize(widthCss: number, heightCss: number): void {
    this.widthCss = Math.floor(widthCss);
    this.heightCss = Math.floor(heightCss);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    const canvases = [this.bgCanvas, this.staticCanvas, this.activeCanvas, this.fxCanvas];
    const contexts = [this.bgCtx, this.staticCtx, this.activeCtx, this.fxCtx];

    canvases.forEach((canvas, idx) => {
      canvas.width = Math.floor(this.widthCss * this.dpr);
      canvas.height = Math.floor(this.heightCss * this.dpr);
      canvas.style.width = `${this.widthCss}px`;
      canvas.style.height = `${this.heightCss}px`;

      const ctx = contexts[idx];
      ctx.setTransform(1, 0, 0, 1, 0, 0); // 리셋
      ctx.scale(this.dpr, this.dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    });

    this.renderBackground();
    this.renderStaticPaths();
  }

  setStage(stage: StageData): void {
    this.currentStage = stage;
    this.staticPaths.clear();
    this.activePath = [];
    this.hintPath = null;
    this.hintAlpha = 0;
    this.renderBackground();
    this.renderStaticPaths();
    this.clearActive();
  }

  setStaticPaths(paths: Map<string, SplinePath>): void {
    this.staticPaths = new Map(paths);
    this.renderStaticPaths();
  }

  setActivePath(points: Point2D[], color: string): void {
    this.activePath = points;
    this.activeColor = color;
    this.renderActive();
  }

  clearActive(): void {
    this.activePath = [];
    this.activeCtx.clearRect(0, 0, this.widthCss, this.heightCss);
  }

  showHint(path: Point2D[], color: string): void {
    this.hintPath = path;
    this.hintColor = color;
    this.hintAlpha = 1.0;
  }

  clearHint(): void {
    this.hintPath = null;
    this.hintAlpha = 0;
  }

  /**
   * Layer 1: 배경, 보드 테두리 프레임, 격자, 정적 장애물 렌더링
   */
  private renderBackground(): void {
    const ctx = this.bgCtx;
    ctx.clearRect(0, 0, this.widthCss, this.heightCss);
    if (!this.currentStage || this.widthCss === 0 || this.heightCss === 0) return;

    // 1. 도화지 스케치북 외곽 바탕 (#F3EDE2)
    const bgGrad = ctx.createLinearGradient(0, 0, this.widthCss, this.heightCss);
    bgGrad.addColorStop(0, '#F5EFE4');
    bgGrad.addColorStop(1, '#ECE3D4');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.widthCss, this.heightCss);

    // 2. 현재 스테이지 보드 프레임 렌더링 (원형 링 또는 사각 프레임)
    if (this.currentStage.board) {
      this.drawBoardFrame(ctx, this.currentStage.board);
    } else {
      // 기본 보드인 경우 일반 격자
      this.drawDefaultGrid(ctx);
    }

    // 3. 정적 장애물 렌더링
    for (const obs of this.currentStage.obstacles) {
      this.drawObstacle(ctx, obs);
    }
  }

  /**
   * 보드 프레임 (원형 테두리 링 또는 사각 테두리 프레임) 렌더링
   */
  private drawBoardFrame(ctx: CanvasRenderingContext2D, board: import('../../types/stage').BoardConfig): void {
    const minDim = Math.min(this.widthCss, this.heightCss);

    if (board.type === 'circle') {
      const cx = board.centerX * this.widthCss;
      const cy = board.centerY * this.heightCss;
      const r = board.radius * minDim;

      // 1) 보드 내부 도화지 클리어 & 밝은 순백/크림 배경
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFEFC';
      ctx.shadowColor = 'rgba(60, 45, 30, 0.18)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 4;
      ctx.fill();
      ctx.restore();

      // 2) 내부 미세 도트 격자
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
      ctx.clip();
      const gridSize = Math.max(22, Math.floor(this.widthCss / 16));
      ctx.fillStyle = 'rgba(190, 170, 150, 0.28)';
      for (let x = cx - r; x <= cx + r; x += gridSize) {
        for (let y = cy - r; y <= cy + r; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // 3) 원형 테두리 링(Circle Board Ring) - 고급스러운 입체 링
      ctx.save();
      // 외부 그림자
      ctx.shadowColor = 'rgba(0, 0, 0, 0.16)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;

      // 외곽 메인 베벨 링
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#4A3E31';
      ctx.lineWidth = 5.5;
      ctx.stroke();

      // 이너 메탈릭 림
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(215, 195, 170, 0.85)';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      // 점들이 걸쳐지는 안내 트랙 (Dotted/Dashed Guide Groove)
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120, 100, 80, 0.35)';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // 4) 틱 마크(Tick Marks: 15도마다 눈금)
      ctx.strokeStyle = 'rgba(140, 120, 100, 0.6)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI * 2) / 24;
        const tickInner = r - (i % 2 === 0 ? 8 : 5);
        const tickOuter = r - 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * tickInner, cy + Math.sin(a) * tickInner);
        ctx.lineTo(cx + Math.cos(a) * tickOuter, cy + Math.sin(a) * tickOuter);
        ctx.stroke();
      }
      ctx.restore();

    } else if (board.type === 'rect') {
      const rx = board.bounds.minX * this.widthCss;
      const ry = board.bounds.minY * this.heightCss;
      const rw = (board.bounds.maxX - board.bounds.minX) * this.widthCss;
      const rh = (board.bounds.maxY - board.bounds.minY) * this.heightCss;
      const cornerRadius = 14;

      // 1) 사각 보드 내부 밝은 도화지
      ctx.save();
      ctx.beginPath();
      this.drawRoundedRect(ctx, rx, ry, rw, rh, cornerRadius);
      ctx.fillStyle = '#FFFEFC';
      ctx.shadowColor = 'rgba(60, 45, 30, 0.18)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 4;
      ctx.fill();
      ctx.restore();

      // 2) 내부 미세 도트 격자
      ctx.save();
      ctx.beginPath();
      this.drawRoundedRect(ctx, rx + 4, ry + 4, rw - 8, rh - 8, cornerRadius - 2);
      ctx.clip();
      const gridSize = Math.max(22, Math.floor(this.widthCss / 16));
      ctx.fillStyle = 'rgba(190, 170, 150, 0.28)';
      for (let x = rx; x <= rx + rw; x += gridSize) {
        for (let y = ry; y <= ry + rh; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // 3) 사각 테두리 프레임
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.16)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;

      // 외곽 베벨 선
      ctx.beginPath();
      this.drawRoundedRect(ctx, rx, ry, rw, rh, cornerRadius);
      ctx.strokeStyle = '#4A3E31';
      ctx.lineWidth = 5.5;
      ctx.stroke();

      // 안쪽 림
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.beginPath();
      this.drawRoundedRect(ctx, rx + 3.5, ry + 3.5, rw - 7, rh - 7, Math.max(2, cornerRadius - 3));
      ctx.strokeStyle = 'rgba(215, 195, 170, 0.85)';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      // 상/하/좌/우 점 밀착 가이드 레일 (Groove Lines)
      ctx.strokeStyle = 'rgba(160, 140, 120, 0.4)';
      ctx.lineWidth = 1.0;
      ctx.setLineDash([4, 4]);
      // 상단 테두리 홈
      ctx.beginPath();
      ctx.moveTo(rx + cornerRadius, ry);
      ctx.lineTo(rx + rw - cornerRadius, ry);
      // 하단 테두리 홈
      ctx.moveTo(rx + cornerRadius, ry + rh);
      ctx.lineTo(rx + rw - cornerRadius, ry + rh);
      // 좌측 테두리 홈
      ctx.moveTo(rx, ry + cornerRadius);
      ctx.lineTo(rx, ry + rh - cornerRadius);
      // 우측 테두리 홈
      ctx.moveTo(rx + rw, ry + cornerRadius);
      ctx.lineTo(rx + rw, ry + rh - cornerRadius);
      ctx.stroke();
      ctx.setLineDash([]);

      // 코너 리벳 장식 (4개 모서리 볼트)
      const rivets = [
        { x: rx + 6, y: ry + 6 },
        { x: rx + rw - 6, y: ry + 6 },
        { x: rx + rw - 6, y: ry + rh - 6 },
        { x: rx + 6, y: ry + rh - 6 }
      ];
      ctx.fillStyle = '#8D7B68';
      for (const rv of rivets) {
        ctx.beginPath();
        ctx.arc(rv.x, rv.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawDefaultGrid(ctx: CanvasRenderingContext2D): void {
    const gridSize = Math.max(24, Math.floor(this.widthCss / 16));
    ctx.fillStyle = 'rgba(180, 160, 140, 0.22)';
    for (let x = gridSize / 2; x < this.widthCss; x += gridSize) {
      for (let y = gridSize / 2; y < this.heightCss; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawObstacle(ctx: CanvasRenderingContext2D, obs: Obstacle): void {
    ctx.save();
    const minDim = Math.min(this.widthCss, this.heightCss);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = '#E8DEC8';
    ctx.strokeStyle = '#B8A890';
    ctx.lineWidth = 2.5;

    if (obs.type === 'circle') {
      const cx = obs.x * this.widthCss;
      const cy = obs.y * this.heightCss;
      const r = (obs.radius ?? 0.05) * minDim;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 내부 텍스처 (X 패턴 또는 빗금)
      ctx.strokeStyle = 'rgba(160, 140, 120, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy - r * 0.5);
      ctx.lineTo(cx + r * 0.5, cy + r * 0.5);
      ctx.moveTo(cx + r * 0.5, cy - r * 0.5);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.5);
      ctx.stroke();
    } else if (obs.type === 'rect') {
      const rx = obs.x * this.widthCss;
      const ry = obs.y * this.heightCss;
      const rw = (obs.width ?? 0.1) * this.widthCss;
      const rh = (obs.height ?? 0.1) * this.heightCss;

      ctx.beginPath();
      this.drawRoundedRect(ctx, rx, ry, rw, rh, 8);
      ctx.fill();
      ctx.stroke();

      // 내부 빗금
      ctx.strokeStyle = 'rgba(160, 140, 120, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx + 6, ry + rh - 6);
      ctx.lineTo(rx + rw - 6, ry + 6);
      ctx.stroke();
    } else if (obs.type === 'room_arc') {
      // ----------------------------------------------------
      // [C자형 룸(원형 방) 렌더링: 펜 스케치 건축 도면 스타일]
      // ----------------------------------------------------
      const cx = obs.x * this.widthCss;
      const cy = obs.y * this.heightCss;
      const r = (obs.radius ?? 0.1) * minDim;
      const wallThick = (obs.wallThickness ?? 0.024) * minDim;
      const gateAngle = obs.gateAngle ?? 0;
      const gateSpan = obs.gateSpan ?? Math.PI / 3;

      const rOuter = r + wallThick * 0.5;
      const rInner = Math.max(8, r - wallThick * 0.5);

      const startAngle = gateAngle + gateSpan * 0.5;
      const endAngle = gateAngle + Math.PI * 2 - gateSpan * 0.5;

      // 1. 방 바닥 미색 하이라이트 (방 내부 영역을 살짝 밝고 아늑하게)
      ctx.save();
      ctx.fillStyle = 'rgba(255, 250, 240, 0.75)';
      ctx.beginPath();
      ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 2. C자형 원호 벽체 채우기 및 외곽선
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, startAngle, endAngle, false);
      // 끝점 둥근 캡
      const endX = cx + Math.cos(endAngle) * ((rOuter + rInner) / 2);
      const endY = cy + Math.sin(endAngle) * ((rOuter + rInner) / 2);
      ctx.arc(cx, cy, rInner, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = '#E4D5BE';
      ctx.fill();
      ctx.stroke();

      // 3. 벽체 내부 레이디얼 벽돌/해치 선(Radial hatching)
      ctx.save();
      ctx.strokeStyle = 'rgba(145, 125, 105, 0.4)';
      ctx.lineWidth = 1.2;
      const hatchSteps = Math.max(6, Math.floor((endAngle - startAngle) / 0.28));
      const stepAngle = (endAngle - startAngle) / hatchSteps;
      for (let i = 1; i < hatchSteps; i++) {
        const a = startAngle + i * stepAngle;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
        ctx.lineTo(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
        ctx.stroke();
      }

      // 4. 게이트 출입구 가이드 마커 (열린 문 표시)
      ctx.strokeStyle = 'rgba(220, 120, 60, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, (rOuter + rInner) * 0.5, gateAngle - gateSpan * 0.5, gateAngle + gateSpan * 0.5, false);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else if (obs.type === 'room_rect') {
      // ----------------------------------------------------
      // [포위형 사각 룸 렌더링: 1면 게이트가 있는 방]
      // ----------------------------------------------------
      const rx = obs.x * this.widthCss;
      const ry = obs.y * this.heightCss;
      const rw = (obs.width ?? 0.18) * this.widthCss;
      const rh = (obs.height ?? 0.18) * this.heightCss;
      const wallThick = (obs.wallThickness ?? 0.022) * minDim;

      // 1. 방 바닥 미색
      ctx.save();
      ctx.fillStyle = 'rgba(255, 252, 245, 0.7)';
      ctx.fillRect(rx + wallThick, ry + wallThick, rw - wallThick * 2, rh - wallThick * 2);

      // 2. 세그먼트 기반 벽체 렌더링
      if (obs.segments && obs.segments.length > 0) {
        ctx.strokeStyle = '#B8A890';
        ctx.fillStyle = '#E4D5BE';
        ctx.lineWidth = wallThick;
        ctx.lineCap = 'round';
        for (const seg of obs.segments) {
          ctx.beginPath();
          ctx.moveTo(seg.p1.x * this.widthCss, seg.p1.y * this.heightCss);
          ctx.lineTo(seg.p2.x * this.widthCss, seg.p2.y * this.heightCss);
          ctx.stroke();
        }
      }
      ctx.restore();
    } else if (obs.type === 'wall') {
      // ----------------------------------------------------
      // [미로 벽 / 중앙 회랑 / 십자벽 렌더링]
      // ----------------------------------------------------
      const wallThick = (obs.wallThickness ?? 0.02) * minDim;
      if (obs.segments && obs.segments.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 1. 벽체 본체 (두꺼운 스케치 벽)
        ctx.strokeStyle = '#D9CCA8';
        ctx.lineWidth = wallThick;
        for (const seg of obs.segments) {
          ctx.beginPath();
          ctx.moveTo(seg.p1.x * this.widthCss, seg.p1.y * this.heightCss);
          ctx.lineTo(seg.p2.x * this.widthCss, seg.p2.y * this.heightCss);
          ctx.stroke();
        }

        // 2. 벽체 외곽 테두리 (정밀 드로잉 펜 선)
        ctx.strokeStyle = '#A6967E';
        ctx.lineWidth = 1.5;
        for (const seg of obs.segments) {
          const x1 = seg.p1.x * this.widthCss;
          const y1 = seg.p1.y * this.heightCss;
          const x2 = seg.p2.x * this.widthCss;
          const y2 = seg.p2.y * this.heightCss;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * (wallThick * 0.5);
          const ny = (dx / len) * (wallThick * 0.5);

          ctx.beginPath();
          ctx.moveTo(x1 + nx, y1 + ny);
          ctx.lineTo(x2 + nx, y2 + ny);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(x1 - nx, y1 - ny);
          ctx.lineTo(x2 - nx, y2 - ny);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /**
   * 보드 테두리 프레임 내부 영역으로 컨텍스트 클리핑 (선이 테두리 밖으로 삐져나가지 않도록 완벽 보장)
   */
  private clipToBoard(ctx: CanvasRenderingContext2D): void {
    if (!this.currentStage || !this.currentStage.board) return;
    const board = this.currentStage.board;
    const minDim = Math.min(this.widthCss, this.heightCss);

    ctx.beginPath();
    if (board.type === 'circle') {
      const cx = board.centerX * this.widthCss;
      const cy = board.centerY * this.heightCss;
      const r = board.radius * minDim;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (board.type === 'rect') {
      const rx = board.bounds.minX * this.widthCss;
      const ry = board.bounds.minY * this.heightCss;
      const rw = (board.bounds.maxX - board.bounds.minX) * this.widthCss;
      const rh = (board.bounds.maxY - board.bounds.minY) * this.heightCss;
      this.drawRoundedRect(ctx, rx, ry, rw, rh, 14);
    }
    ctx.clip();
  }

  /**
   * Layer 2: 완성된 정적 스플라인들
   */
  private renderStaticPaths(): void {
    const ctx = this.staticCtx;
    ctx.clearRect(0, 0, this.widthCss, this.heightCss);
    if (this.widthCss === 0 || this.heightCss === 0) return;

    ctx.save();
    this.clipToBoard(ctx);
    this.staticPaths.forEach((spline) => {
      if (spline.rawPoints.length < 2) return;
      this.drawSmoothSpline(ctx, spline.rawPoints, spline.color, this.lineWidthPx(), false);
    });
    ctx.restore();
  }

  /**
   * Layer 3: 실시간 드래그 활성 선분
   */
  private renderActive(): void {
    const ctx = this.activeCtx;
    ctx.clearRect(0, 0, this.widthCss, this.heightCss);
    if (this.activePath.length < 2) return;

    // 활성 선분 렌더링 (가벼운 글로우 효과와 함께 테두리 내 클리핑)
    ctx.save();
    this.clipToBoard(ctx);
    this.drawSmoothSpline(ctx, this.activePath, this.activeColor, this.lineWidthPx(), true);
    ctx.restore();
  }

  /** 선 두께(px). 충돌 판정과 같은 정규화 두께를 사용해 "판정상 안 겹침 = 화면상 안 겹침"을 보장 */
  private lineWidthPx(): number {
    return GameRules.LINE_WIDTH * Math.min(this.widthCss, this.heightCss);
  }

  /**
   * 부드러운 스플라인 드로잉 유틸리티
   */
  private drawSmoothSpline(
    ctx: CanvasRenderingContext2D,
    normalizedPoints: Point2D[],
    color: string,
    lineWidth: number,
    isActive: boolean
  ): void {
    if (normalizedPoints.length < 2) return;

    // 정규화 좌표 -> 픽셀 좌표 변환
    const pixelPoints = normalizedPoints.map((p) => ({
      x: p.x * this.widthCss,
      y: p.y * this.heightCss
    }));

    // Catmull-Rom 스플라인 보간 포인트 생성
    const smoothed = Spline.generateSplinePoints(pixelPoints, 6);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 외곽 소프트 글로우/그림자
    ctx.shadowColor = isActive ? color : 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = isActive ? 12 : 4;
    ctx.shadowOffsetY = isActive ? 1 : 2;

    // 2. 메인 스트로크
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(smoothed[0].x, smoothed[0].y);
    for (let i = 1; i < smoothed.length; i++) {
      ctx.lineTo(smoothed[i].x, smoothed[i].y);
    }
    ctx.stroke();

    // 3. 중심 하이라이트 (만년필/잉크 광택감)
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = Math.max(2, lineWidth * 0.28);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Layer 4: FX 루프 (Dots, 펄스, 파티클, 힌트)
   */
  private startFXLoop(): void {
    const loop = () => {
      this.renderFX();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private renderFX(): void {
    const ctx = this.fxCtx;
    ctx.clearRect(0, 0, this.widthCss, this.heightCss);
    if (!this.currentStage || this.widthCss === 0 || this.heightCss === 0) return;

    this.pulseTime += 0.05;

    // 1. 힌트 경로 렌더링 (활성화된 경우)
    if (this.hintPath && this.hintPath.length >= 2 && this.hintAlpha > 0.01) {
      this.drawHintPath(ctx, this.hintPath, this.hintColor, this.hintAlpha);
      this.hintAlpha = Math.max(0, this.hintAlpha - 0.003); // 서서히 페이드아웃
    }

    // 2. 점(Dots) 렌더링
    for (const pair of this.currentStage.dots) {
      const isConnected = this.staticPaths.has(pair.pairId);
      this.drawDot(ctx, pair.pointA, pair.color, pair.radius, isConnected);
      this.drawDot(ctx, pair.pointB, pair.color, pair.radius, isConnected);
    }

    // 3. 쇼크웨이브 펄스 렌더링
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += 2.8;
      sw.alpha -= sw.decay;

      if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3 * sw.alpha;
      ctx.globalAlpha = sw.alpha;
      ctx.stroke();
      ctx.restore();
    }

    // 4. 충돌/스냅 스파크 파티클
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.alpha -= sp.decay;
      sp.vy += 0.12; // 중력 가속도

      if (sp.alpha <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = sp.alpha;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. 클리어 축하 컨페티 파티클
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const cf = this.confetti[i];
      cf.x += cf.vx;
      cf.y += cf.vy;
      cf.angle += cf.vr;
      cf.alpha -= cf.decay;
      cf.vy += 0.15; // 중력
      cf.vx *= 0.99; // 공기 저항

      if (cf.alpha <= 0 || cf.y > this.heightCss + 30) {
        this.confetti.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(cf.x, cf.y);
      ctx.rotate(cf.angle);
      ctx.fillStyle = cf.color;
      ctx.globalAlpha = cf.alpha;
      ctx.fillRect(-cf.size / 2, -cf.size / 3, cf.size, cf.size * 0.7);
      ctx.restore();
    }
  }

  /**
   * 색상 밝기 조정 헬퍼 (양수: 밝게, 음수: 어둡게)
   */
  private adjustColorBrightness(hex: string, percent: number): string {
    let cleanHex = hex.replace('#', '');
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split('').map((c) => c + c).join('');
    }
    const num = parseInt(cleanHex, 16);
    if (isNaN(num)) return hex;

    let r = (num >> 16) + Math.round(255 * (percent / 100));
    let g = ((num >> 8) & 0x00ff) + Math.round(255 * (percent / 100));
    let b = (num & 0x0000ff) + Math.round(255 * (percent / 100));

    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));

    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  /**
   * 단일 점(Dot) 렌더링 - 테두리 선 위에 안착된 3D 뱃지/버튼 스타일
   */
  private drawDot(
    ctx: CanvasRenderingContext2D,
    pos: Point2D,
    color: string,
    normRadius: number,
    isConnected: boolean
  ): void {
    const cx = pos.x * this.widthCss;
    const cy = pos.y * this.heightCss;
    const r = normRadius * Math.min(this.widthCss, this.heightCss);

    ctx.save();

    // 1. 미연결 점 맥박(Pulse) 링 연출
    if (!isConnected) {
      const pulseScale = 1.0 + Math.sin(this.pulseTime * 2.5) * 0.14;
      const pulseAlpha = 0.22 + Math.sin(this.pulseTime * 2.5) * 0.12;

      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.6 * pulseScale, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(0, pulseAlpha);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // 2. 바닥 드롭 섀도우 (3D 돌출 그림자)
    ctx.shadowColor = 'rgba(20, 15, 10, 0.38)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3.5;

    // 3. 외곽 3D 메탈/크롬 베이스 림 (Bevel Base Rim)
    const baseGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    baseGrad.addColorStop(0, '#FFFFFF');
    baseGrad.addColorStop(0.5, '#E4E7EB');
    baseGrad.addColorStop(1, '#9AA0A6');

    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();

    // 외곽 엣지 라인
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 4. 내부 챔퍼 음영 링 (Inner Recess Bevel)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.90, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fill();

    // 5. 3D 구면 컬러 돔 (Spherical Color Dome)
    const lightX = cx - r * 0.25;
    const lightY = cy - r * 0.28;
    const domeGrad = ctx.createRadialGradient(lightX, lightY, r * 0.06, cx, cy, r * 0.85);
    domeGrad.addColorStop(0, this.adjustColorBrightness(color, 45));
    domeGrad.addColorStop(0.55, color);
    domeGrad.addColorStop(1, this.adjustColorBrightness(color, -38));

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = domeGrad;
    ctx.fill();

    // 6. 상단 유광 글레어 (Glossy Top Flare - 조약돌/유리알 반사광)
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.12, cy - r * 0.26, r * 0.44, r * 0.22, -0.25, 0, Math.PI * 2);
    const flareGrad = ctx.createLinearGradient(cx, cy - r * 0.48, cx, cy - r * 0.04);
    flareGrad.addColorStop(0, 'rgba(255, 255, 255, 0.88)');
    flareGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.35)');
    flareGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = flareGrad;
    ctx.fill();
    ctx.restore();

    // 7. 하단 림 라이트 (Bottom Rim Specular)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.06, r * 0.72, Math.PI * 0.25, Math.PI * 0.75, false);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    // 8. 연결 완료(Connected) 표시 or 대기 하이라이트
    if (isConnected) {
      // 보석 코어 인레이 & 체크 링
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.30, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.0;
      ctx.stroke();
    } else {
      // 중앙 부드러운 엠보스 점
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.15, cy - r * 0.15, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * 힌트 점선 경로 렌더링
   */
  private drawHintPath(
    ctx: CanvasRenderingContext2D,
    path: Point2D[],
    color: string,
    alpha: number
  ): void {
    const pixelPoints = path.map((p) => ({
      x: p.x * this.widthCss,
      y: p.y * this.heightCss
    }));
    const smoothed = Spline.generateSplinePoints(pixelPoints, 6);

    ctx.save();
    ctx.globalAlpha = alpha * 0.75;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -this.pulseTime * 20; // 움직이는 점선 효과
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(smoothed[0].x, smoothed[0].y);
    for (let i = 1; i < smoothed.length; i++) {
      ctx.lineTo(smoothed[i].x, smoothed[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 충돌 차단(Rebound) 쇼크웨이브 및 스파크 폭발 생성
   */
  triggerCollisionFX(normPos: Point2D): void {
    const x = normPos.x * this.widthCss;
    const y = normPos.y * this.heightCss;

    this.shockwaves.push({
      x,
      y,
      radius: 6,
      maxRadius: 42,
      color: '#FF4757',
      alpha: 1.0,
      decay: 0.05
    });

    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI * 2 * i) / 16 + (Math.random() * 0.2);
      const speed = 2.5 + Math.random() * 4.5;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: Math.random() > 0.3 ? '#FF4757' : '#FFA502',
        size: 2.5 + Math.random() * 2,
        alpha: 1.0,
        decay: 0.04 + Math.random() * 0.03
      });
    }
  }

  /**
   * 연결 성공(Snap) 스파크 생성
   */
  triggerSnapFX(normPos: Point2D, color: string): void {
    const x = normPos.x * this.widthCss;
    const y = normPos.y * this.heightCss;

    this.shockwaves.push({
      x,
      y,
      radius: 6,
      maxRadius: 36,
      color,
      alpha: 0.85,
      decay: 0.045
    });

    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 3.5;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 2 + Math.random() * 2,
        alpha: 1.0,
        decay: 0.04 + Math.random() * 0.02
      });
    }
  }

  /**
   * 스테이지 클리어 축하 컨페티 파티클 폭죽 발사
   */
  triggerClearConfetti(): void {
    const colors = ['#FF4757', '#1E90FF', '#2ED573', '#FFA502', '#9B59B6', '#00D2D3', '#FF6B81'];
    const count = 90;

    for (let i = 0; i < count; i++) {
      const x = this.widthCss * (0.15 + Math.random() * 0.7);
      const y = this.heightCss * (0.2 + Math.random() * 0.4);
      const angle = Math.random() * Math.PI * 2;
      const speed = 3.5 + Math.random() * 6.5;

      this.confetti.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3.5, // 위로 솟구침
        angle: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.25,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 6 + Math.random() * 6,
        alpha: 1.0,
        decay: 0.012 + Math.random() * 0.008
      });
    }
  }

  destroy(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
