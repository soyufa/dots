import { Point2D } from '../../types/geometry';
import { BoardConfig, BoardType } from '../../types/stage';
import { GameRules } from '../rules/GameRules';
import { Vector2 } from '../math/Vector2';
import { Intersection } from '../physics/Intersection';

/**
 * ============================================================================
 *  가림벽(Chord) 기반 자유 곡선 퍼즐 생성기
 * ============================================================================
 *  1) 벽-벽 쌍(Chord)을 먼저 배치한다. 두 끝점은 테두리에 밀착되고, 경로는 직선에서
 *     크게 벗어나도록 경유점(waypoint)을 거쳐 휘어진다. → 보드를 가르는 휘어진 가림벽.
 *  2) 나머지 쌍(한쪽 벽 점 / 내부 점)은 "같은 영역 안에 있지만 Chord의 직선 기준으로는
 *     반대편"이 되는 위치를 우선 선택한다. → 직선 Chord로는 절대 풀 수 없는 함정.
 *  3) 모든 쌍의 정답 경로를 격자 위에서 실제로 라우팅하므로 풀이 존재가 보장된다.
 *     (격자 간격 ≥ 선 간격/점 금지 반경이므로 격자 경로는 그대로 게임 규칙을 만족한다.)
 * ============================================================================
 */

export interface GeneratorParams {
  boardType: BoardType;
  gridN: number;
  dotRadius: number;
  numPairs: number;
  numChords: number;
  /** 비-Chord 쌍 중 한 점이 벽에 붙는 비율 (0~1) */
  mixedRatio: number;
  /** Chord가 직선에서 벗어나는 정도 (0~1) */
  bulge: number;
  /** 하나의 쌍(초점 쌍)을 겹겹이 감싸도록 만드는 Chord 수 (0이면 사용 안 함) */
  wrapChords: number;
}

export interface GeneratedPair {
  pointA: Point2D;
  pointB: Point2D;
  path: Point2D[];
}

export interface GeneratedPuzzle {
  board: BoardConfig;
  pairs: GeneratedPair[];
}

const BOARD_MIN = 0.12;
const BOARD_MAX = 0.88;
const BOARD_R = 0.38;

export function makeBoard(type: BoardType): BoardConfig {
  return {
    type,
    centerX: 0.5,
    centerY: 0.5,
    radius: BOARD_R,
    bounds: { minX: BOARD_MIN, maxX: BOARD_MAX, minY: BOARD_MIN, maxY: BOARD_MAX }
  };
}

interface Anchor {
  cell: number;
  pos: Point2D;
  /** 이 벽 점을 쓰면 다른 선이 지나갈 수 없게 되는 셀들 */
  reserve: number[];
}

class CellGrid {
  readonly N: number;
  readonly h: number;
  readonly valid: boolean[];
  readonly centers: Point2D[];
  readonly nbrs: number[][];
  readonly anchors: Anchor[][];
  /** 내부 점을 놓아도 테두리와 애매한 틈이 생기지 않는 셀 */
  readonly interiorOk: boolean[];

  constructor(readonly board: BoardConfig, N: number, readonly dotRadius: number) {
    this.N = N;
    this.h = (BOARD_MAX - BOARD_MIN) / N;
    const total = N * N;
    this.valid = new Array(total).fill(false);
    this.centers = new Array(total);
    this.nbrs = Array.from({ length: total }, () => []);
    this.anchors = Array.from({ length: total }, () => []);
    this.interiorOk = new Array(total).fill(false);

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const c = { x: BOARD_MIN + (x + 0.5) * this.h, y: BOARD_MIN + (y + 0.5) * this.h };
        this.centers[i] = c;
        this.valid[i] =
          board.type === 'rect' || GameRules.distanceToWall(board, c) >= this.h * 0.55;
      }
    }

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];
    const missing: number[][] = Array.from({ length: total }, () => []);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (!this.valid[i]) continue;
        dirs.forEach(([dx, dy], k) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N && this.valid[ny * N + nx]) {
            this.nbrs[i].push(ny * N + nx);
          } else {
            missing[i].push(k);
          }
        });
      }
    }

    const passGap = dotRadius + GameRules.LINE_WIDTH + GameRules.SOLUTION_MARGIN * 2;
    for (let i = 0; i < total; i++) {
      if (!this.valid[i]) continue;
      this.interiorOk[i] = GameRules.distanceToWall(board, this.centers[i]) >= passGap;
      if (missing[i].length === 0) continue;
      for (const pos of this.anchorPositions(i, missing[i])) {
        if (!GameRules.isDotInside(board, pos, dotRadius)) continue;
        this.anchors[i].push({ cell: i, pos, reserve: this.computeReserve(i, pos) });
      }
    }
  }

  private anchorPositions(i: number, missingDirs: number[]): Point2D[] {
    const c = this.centers[i];
    const r = this.dotRadius;
    const b = this.board;
    if (b.type === 'circle') {
      const dx = c.x - b.centerX;
      const dy = c.y - b.centerY;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) return [];
      return [{ x: b.centerX + (dx / d) * (b.radius - r), y: b.centerY + (dy / d) * (b.radius - r) }];
    }
    const bd = b.bounds;
    const clampY = (v: number) => Math.min(bd.maxY - r, Math.max(bd.minY + r, v));
    const clampX = (v: number) => Math.min(bd.maxX - r, Math.max(bd.minX + r, v));
    const res: Point2D[] = [];
    for (const k of missingDirs) {
      if (k === 0) res.push({ x: bd.maxX - r, y: clampY(c.y) });
      if (k === 1) res.push({ x: bd.minX + r, y: clampY(c.y) });
      if (k === 2) res.push({ x: clampX(c.x), y: bd.maxY - r });
      if (k === 3) res.push({ x: clampX(c.x), y: bd.minY + r });
    }
    return res;
  }

  private computeReserve(b: number, pos: Point2D): number[] {
    const K = GameRules.dotKeepOut(this.dotRadius) + GameRules.SOLUTION_MARGIN * 2;
    const Cl = GameRules.LINE_CLEARANCE + GameRules.SOLUTION_MARGIN * 2;
    const seg = { p1: pos, p2: this.centers[b] };
    const res = new Set<number>();
    for (let q = 0; q < this.valid.length; q++) {
      if (!this.valid[q] || q === b) continue;
      if (Vector2.distanceToSegment(this.centers[q], pos, this.centers[b]) < K) res.add(q);
      for (const q2 of this.nbrs[q]) {
        if (q2 === b || q2 < q) continue;
        const edge = { p1: this.centers[q], p2: this.centers[q2] };
        if (
          Vector2.distanceToSegment(pos, edge.p1, edge.p2) < K ||
          Intersection.distanceBetweenSegments(seg, edge) < Cl
        ) {
          res.add(q);
          res.add(q2);
        }
      }
    }
    return Array.from(res);
  }
}

interface PlacedDot {
  cell: number;
  pos: Point2D;
  anchor?: Anchor;
}

interface PlacedPair {
  a: PlacedDot;
  b: PlacedDot;
  cells: number[];
}

export class PuzzleGenerator {
  private grid: CellGrid;
  private occ: number[] = [];
  private reserved: number[] = [];
  private pairs: PlacedPair[] = [];
  private chordLines: { a: Point2D; b: Point2D }[] = [];

  private static gridCache = new Map<string, CellGrid>();

  constructor(private params: GeneratorParams, private rng: () => number) {
    const key = `${params.boardType}:${params.gridN}:${params.dotRadius}`;
    let grid = PuzzleGenerator.gridCache.get(key);
    if (!grid) {
      grid = new CellGrid(makeBoard(params.boardType), params.gridN, params.dotRadius);
      PuzzleGenerator.gridCache.set(key, grid);
    }
    this.grid = grid;
  }

  /** 아직 경로는 없지만 자리를 맡아 둔 점 (초점 쌍) */
  private pendingDots: PlacedDot[] = [];
  private pendingBlock = new Set<number>();

  private resetState(): void {
    const total = this.grid.N * this.grid.N;
    this.occ = new Array(total).fill(-1);
    this.reserved = new Array(total).fill(0);
    this.pairs = [];
    this.chordLines = [];
    this.pendingDots = [];
    this.pendingBlock = new Set();
  }

  generate(): GeneratedPuzzle | null {
    this.resetState();

    const wrapN = Math.min(this.params.wrapChords, this.params.numChords);
    let focalPairs = 0;
    if (wrapN > 0) {
      if (!this.placeFocalWrap(wrapN)) return null;
      focalPairs = 1;
    }
    for (let c = wrapN; c < this.params.numChords; c++) {
      if (!this.placeChord()) return null;
    }
    const rest = this.params.numPairs - this.params.numChords - focalPairs;
    const order: boolean[] = [];
    const numMixed = Math.round(rest * this.params.mixedRatio);
    for (let i = 0; i < rest; i++) order.push(i < numMixed);
    this.shuffle(order);
    for (const mixed of order) {
      if (!this.placeTrapPair(mixed)) return null;
    }

    return {
      board: this.grid.board,
      pairs: this.shuffle([...this.pairs]).map((p) => this.toGenerated(p))
    };
  }

  // --------------------------------------------------------------------------
  //  Chord (벽-벽 가림벽)
  // --------------------------------------------------------------------------

  private placeChord(): boolean {
    const g = this.grid;
    for (let attempt = 0; attempt < 40; attempt++) {
      const faces = this.computeFaces();
      const faceIds = Array.from(new Set(faces.filter((f) => f >= 0)));
      const options = faceIds
        .map((fid) => ({ fid, ends: this.eligibleWallCells(faces, fid) }))
        .filter((o) => o.ends.length >= 2);
      if (options.length === 0) return false;
      const opt = options[Math.floor(this.rng() * options.length)];

      const e1 = this.pickWallDot(opt.ends, []);
      if (!e1) continue;
      const ang1 = this.angleOf(e1.pos);
      const farEnough = opt.ends.filter((a) => {
        const da = Math.abs(this.angleDiff(this.angleOf(a.pos), ang1));
        return da >= Math.PI * 0.3 && da <= Math.PI * 0.95;
      });
      const e2 = this.pickWallDot(farEnough, [e1]);
      if (!e2) continue;

      const blockedExtra = new Set<number>([...e1.reserve, ...e2.reserve]);
      const passable = (i: number) => this.isFree(i) && !blockedExtra.has(i);
      if (!passable(e1.cell) || !passable(e2.cell)) continue;

      const way = this.pickWaypoint(faces, opt.fid, e1, e2, passable);
      if (way < 0) continue;
      const p1 = this.route(e1.cell, way, passable, 0.8);
      if (!p1) continue;
      const used = new Set(p1);
      used.delete(way);
      const p2 = this.route(way, e2.cell, (i) => passable(i) && !used.has(i), 0.8);
      if (!p2) continue;
      const cells = [...p1, ...p2.slice(1)];

      this.commitPair({ a: this.dotFromAnchor(e1), b: this.dotFromAnchor(e2), cells });
      this.chordLines.push({ a: e1.pos, b: e2.pos });
      return true;
    }
    return false;
  }

  private pickWaypoint(
    faces: number[],
    fid: number,
    e1: Anchor,
    e2: Anchor,
    passable: (i: number) => boolean
  ): number {
    const g = this.grid;
    const side = this.rng() < 0.5 ? 1 : -1;
    const len = Vector2.distance(e1.pos, e2.pos);
    const cands: { i: number; d: number }[] = [];
    for (let i = 0; i < faces.length; i++) {
      if (faces[i] !== fid || !passable(i) || i === e1.cell || i === e2.cell) continue;
      const d = Intersection.ccw(e1.pos, e2.pos, g.centers[i]) / Math.max(len, 1e-9);
      cands.push({ i, d: d * side });
    }
    let pool = cands.filter((c) => c.d > 0);
    if (pool.length === 0) pool = cands.map((c) => ({ i: c.i, d: -c.d })).filter((c) => c.d > 0);
    if (pool.length === 0) return -1;
    const maxD = pool.reduce((m, c) => Math.max(m, c.d), 0);
    const target = maxD * (0.35 + 0.6 * this.params.bulge);
    const deep = pool.filter((c) => c.d >= target * 0.85);
    const from = deep.length > 0 ? deep : pool;
    return from[Math.floor(this.rng() * from.length)].i;
  }

  // --------------------------------------------------------------------------
  //  초점 감싸기 (여러 Chord가 한 쌍을 겹겹이 휘감는 구조)
  // --------------------------------------------------------------------------
  //  초점 쌍 X–Y 를 먼저 정해 두고, 매 Chord 를 "직선으로는 X 와 Y 를 갈라놓지만
  //  실제 경로는 X 바깥쪽으로 돌아가 X 를 Y 쪽 영역에 남기는" U자 형태로 만든다.
  //  Chord 가 k개면 X–Y 를 잇기 위해 k개의 가림벽이 모두 X 를 감싸 휘어야 한다.

  private placeFocalWrap(wrapN: number): boolean {
    const g = this.grid;
    for (let attempt = 0; attempt < 15; attempt++) {
      this.resetState();

      const deepCells: number[] = [];
      for (let i = 0; i < g.valid.length; i++) {
        if (g.interiorOk[i] && Vector2.distance(g.centers[i], { x: 0.5, y: 0.5 }) <= 0.13) deepCells.push(i);
      }
      if (deepCells.length === 0) return false;
      const xCell = deepCells[Math.floor(this.rng() * deepCells.length)];
      const X: PlacedDot = { cell: xCell, pos: g.centers[xCell] };

      let Y: PlacedDot | null = null;
      if (this.rng() < this.params.mixedRatio) {
        const ends: Anchor[] = [];
        for (let i = 0; i < g.valid.length; i++) {
          for (const an of g.anchors[i]) {
            if (Vector2.distance(an.pos, X.pos) >= 0.3 && !an.reserve.includes(xCell)) ends.push(an);
          }
        }
        if (ends.length > 0) Y = this.dotFromAnchor(ends[Math.floor(this.rng() * ends.length)]);
      }
      if (!Y) {
        const far: number[] = [];
        for (let c = 0; c < g.valid.length; c++) {
          if (g.interiorOk[c] && Vector2.distance(g.centers[c], X.pos) >= 0.25) far.push(c);
        }
        if (far.length === 0) continue;
        const c = far[Math.floor(this.rng() * far.length)];
        Y = { cell: c, pos: g.centers[c] };
      }

      this.pendingDots = [X, Y];
      this.pendingBlock = new Set([X.cell, Y.cell, ...(Y.anchor ? Y.anchor.reserve : [])]);

      let ok = true;
      // 바깥 U 부터 만들고 안쪽 U 로 좁혀 들어간다 (안쪽부터 만들면 바깥 U 가 지나갈 자리가 없다)
      for (let k = 0; k < wrapN && ok; k++) ok = this.placeWrapChord(X, Y, wrapN - k - 1);
      if (!ok) continue;

      this.pendingDots = [];
      this.pendingBlock = new Set();
      const extra = new Set<number>(Y.anchor ? Y.anchor.reserve : []);
      const cells = this.route(Y.cell, X.cell, (i) => this.isFree(i) && !extra.has(i), 0.6);
      if (!cells) continue;
      this.commitPair({ a: Y, b: X, cells });
      return true;
    }
    return false;
  }

  /** layersInside: 이 Chord 안쪽에 앞으로 더 들어올 U 의 수 (그만큼 X 에서 멀리 돌아간다) */
  private placeWrapChord(X: PlacedDot, Y: PlacedDot, layersInside: number): boolean {
    const g = this.grid;
    for (let tries = 0; tries < 25; tries++) {
      const faces = this.computeFaces();
      const fid = this.sharedFace(faces, X.cell, Y.cell);
      if (fid < 0) return false;

      const ends = this.eligibleWallCells(faces, fid);
      const pair = this.pickSeparatingEnds(ends, X.pos, Y.pos, layersInside);
      if (!pair) return false;
      const [e1, e2] = pair;

      const blockedExtra = new Set<number>([...e1.reserve, ...e2.reserve]);
      const passable = (i: number) => this.isFree(i) && !blockedExtra.has(i);
      if (!passable(e1.cell) || !passable(e2.cell)) continue;

      // X 바깥쪽(직선에서 X보다 더 먼 쪽), X 의 수선 발 근처에 경유점을 잡는다
      const len = Math.max(Vector2.distance(e1.pos, e2.pos), 1e-9);
      const dir = { x: (e2.pos.x - e1.pos.x) / len, y: (e2.pos.y - e1.pos.y) / len };
      const sX = Math.sign(Intersection.ccw(e1.pos, e2.pos, X.pos));
      const dX = Math.abs(Intersection.ccw(e1.pos, e2.pos, X.pos)) / len;
      const alongX = (X.pos.x - e1.pos.x) * dir.x + (X.pos.y - e1.pos.y) * dir.y;
      const minOff = dX + g.h * (0.9 + 1.8 * layersInside);
      const ways: { i: number; s: number }[] = [];
      for (let i = 0; i < faces.length; i++) {
        if (faces[i] !== fid || !passable(i)) continue;
        const c = g.centers[i];
        const sd = Intersection.ccw(e1.pos, e2.pos, c) / len;
        if (Math.sign(sd) !== sX || Math.abs(sd) < minOff) continue;
        const along = (c.x - e1.pos.x) * dir.x + (c.y - e1.pos.y) * dir.y;
        ways.push({ i, s: Math.abs(along - alongX) + (Math.abs(sd) - minOff) * 0.5 + this.rng() * g.h * 1.5 });
      }
      if (ways.length === 0) continue;
      ways.sort((a, b) => a.s - b.s);
      const way = ways[Math.floor(this.rng() * Math.min(3, ways.length))].i;

      const cells = this.routeVia(e1.cell, way, e2.cell, passable, 0.3);
      if (!cells) continue;

      this.commitPair({ a: this.dotFromAnchor(e1), b: this.dotFromAnchor(e2), cells });
      if (this.sharedFace(this.computeFaces(), X.cell, Y.cell) < 0) {
        this.uncommitLast();
        continue;
      }
      this.chordLines.push({ a: e1.pos, b: e2.pos });
      return true;
    }
    return false;
  }

  /**
   * X 와 Y 를 직선으로 갈라놓는 벽 점 두 개를 고른다.
   * 바깥 U(안쪽에 들어올 층이 많음)는 직선이 X 가까이, 안쪽 U 는 Y 가까이 지나가도록 선호한다.
   */
  private pickSeparatingEnds(ends: Anchor[], X: Point2D, Y: Point2D, layersInside: number): [Anchor, Anchor] | null {
    const gap = this.minDotGap();
    const wrapN = Math.max(1, this.params.wrapChords);
    const targetT = wrapN <= 1 ? 0.5 : 0.25 + 0.5 * (1 - layersInside / (wrapN - 1));
    const cands: { a: Anchor; b: Anchor; s: number }[] = [];
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const a = ends[i];
        const b = ends[j];
        if (a.cell === b.cell || Vector2.distance(a.pos, b.pos) < gap) continue;
        if (a.reserve.includes(b.cell) || b.reserve.includes(a.cell)) continue;
        const sx = Intersection.ccw(a.pos, b.pos, X);
        const sy = Intersection.ccw(a.pos, b.pos, Y);
        if (sx * sy >= 0) continue;
        if (Math.abs(this.angleDiff(this.angleOf(a.pos), this.angleOf(b.pos))) < Math.PI * 0.25) continue;
        const t = Math.abs(sx) / (Math.abs(sx) + Math.abs(sy));
        cands.push({ a, b, s: Math.abs(t - targetT) + this.rng() * 0.15 });
      }
    }
    if (cands.length === 0) return null;
    cands.sort((p, q) => p.s - q.s);
    const pick = cands[Math.floor(this.rng() * Math.min(4, cands.length))];
    return this.rng() < 0.5 ? [pick.a, pick.b] : [pick.b, pick.a];
  }

  /** 두 (예약된) 셀이 같은 면에 인접해 있으면 그 면 id, 아니면 -1 */
  private sharedFace(faces: number[], a: number, b: number): number {
    const around = (c: number) => {
      const s = new Set<number>();
      if (faces[c] >= 0) s.add(faces[c]);
      for (const n of this.grid.nbrs[c]) if (faces[n] >= 0) s.add(faces[n]);
      return s;
    };
    const fb = around(b);
    for (const f of around(a)) if (fb.has(f)) return f;
    return -1;
  }

  private uncommitLast(): void {
    const p = this.pairs.pop();
    if (!p) return;
    for (const c of p.cells) this.occ[c] = -1;
    for (const d of [p.a, p.b]) {
      if (d.anchor) for (const q of d.anchor.reserve) this.reserved[q]--;
    }
  }

  // --------------------------------------------------------------------------
  //  함정 쌍 (한쪽 벽 점 또는 내부 점)
  // --------------------------------------------------------------------------

  private placeTrapPair(mixed: boolean): boolean {
    const g = this.grid;
    for (let attempt = 0; attempt < 12; attempt++) {
      const faces = this.computeFaces();
      const cands: { a: PlacedDot; b: PlacedDot; score: number }[] = [];

      const interiorCells: number[] = [];
      for (let i = 0; i < faces.length; i++) {
        if (faces[i] >= 0 && g.interiorOk[i] && this.dotSpacingOk(g.centers[i])) interiorCells.push(i);
      }
      if (interiorCells.length === 0) return false;
      const ends = mixed ? this.eligibleWallCells(faces, -1) : [];

      for (let s = 0; s < 80; s++) {
        let a: PlacedDot | null = null;
        if (mixed) {
          const an = ends.length > 0 ? ends[Math.floor(this.rng() * ends.length)] : null;
          if (!an) break;
          a = this.dotFromAnchor(an);
        } else {
          const c = interiorCells[Math.floor(this.rng() * interiorCells.length)];
          a = { cell: c, pos: g.centers[c] };
        }
        const fa = faces[a.cell];
        const same = interiorCells.filter(
          (c) =>
            faces[c] === fa &&
            c !== a!.cell &&
            !(a!.anchor && a!.anchor.reserve.includes(c)) &&
            Vector2.distance(g.centers[c], a!.pos) >= this.minDotGap()
        );
        if (same.length === 0) continue;
        const bCell = same[Math.floor(this.rng() * same.length)];
        const b: PlacedDot = { cell: bCell, pos: g.centers[bCell] };
        const sep = this.separation(a.pos, b.pos);
        const dist = Vector2.distance(a.pos, b.pos);
        cands.push({ a, b, score: sep * 10 + dist * 3 + this.rng() * 2 });
      }
      if (cands.length === 0) continue;
      cands.sort((x, y) => y.score - x.score);

      for (const cand of cands.slice(0, 6)) {
        const extra = new Set<number>(cand.a.anchor ? cand.a.anchor.reserve : []);
        const passable = (i: number) => this.isFree(i) && !extra.has(i);
        if (!passable(cand.a.cell) || !passable(cand.b.cell)) continue;
        const cells = this.route(cand.a.cell, cand.b.cell, passable, 0.6);
        if (!cells) continue;
        this.commitPair({ a: cand.a, b: cand.b, cells });
        return true;
      }
    }
    return false;
  }

  /** 두 점을 직선 기준으로 갈라놓는 Chord 수 */
  private separation(p: Point2D, q: Point2D): number {
    let n = 0;
    for (const c of this.chordLines) {
      const s1 = Intersection.ccw(c.a, c.b, p);
      const s2 = Intersection.ccw(c.a, c.b, q);
      if (s1 * s2 < 0) n++;
    }
    return n;
  }

  // --------------------------------------------------------------------------
  //  공통 유틸
  // --------------------------------------------------------------------------

  private isFree(i: number): boolean {
    return this.grid.valid[i] && this.occ[i] === -1 && this.reserved[i] === 0 && !this.pendingBlock.has(i);
  }

  private minDotGap(): number {
    return this.params.dotRadius * 2 + GameRules.LINE_WIDTH + 0.008;
  }

  private dotSpacingOk(p: Point2D): boolean {
    const gap = this.minDotGap();
    for (const pr of this.pairs) {
      if (Vector2.distance(pr.a.pos, p) < gap || Vector2.distance(pr.b.pos, p) < gap) return false;
    }
    for (const d of this.pendingDots) {
      if (Vector2.distance(d.pos, p) < gap) return false;
    }
    return true;
  }

  /** 면(face) 안에서 벽 점으로 쓸 수 있는 앵커 목록. fid = -1 이면 모든 면 */
  private eligibleWallCells(faces: number[], fid: number): Anchor[] {
    const g = this.grid;
    const res: Anchor[] = [];
    for (let i = 0; i < faces.length; i++) {
      if (faces[i] < 0 || (fid >= 0 && faces[i] !== fid)) continue;
      for (const an of g.anchors[i]) {
        if (!this.dotSpacingOk(an.pos)) continue;
        if (an.reserve.some((q) => this.occ[q] !== -1 || this.pendingDots.some((d) => d.cell === q))) continue;
        res.push(an);
      }
    }
    return res;
  }

  private pickWallDot(list: Anchor[], exclude: Anchor[]): Anchor | null {
    const gap = this.minDotGap();
    const ok = list.filter(
      (a) =>
        !exclude.some((e) => e.cell === a.cell || Vector2.distance(e.pos, a.pos) < gap || e.reserve.includes(a.cell))
    );
    if (ok.length === 0) return null;
    return ok[Math.floor(this.rng() * ok.length)];
  }

  private dotFromAnchor(a: Anchor): PlacedDot {
    return { cell: a.cell, pos: a.pos, anchor: a };
  }

  private commitPair(p: PlacedPair): void {
    const idx = this.pairs.length;
    for (const c of p.cells) this.occ[c] = idx;
    for (const d of [p.a, p.b]) {
      if (d.anchor) for (const q of d.anchor.reserve) this.reserved[q]++;
    }
    this.pairs.push(p);
  }

  /** 아직 아무도 쓰지 않은 셀들의 연결 요소 (같은 면 = 서로 이을 수 있음) */
  private computeFaces(): number[] {
    const g = this.grid;
    const faces = new Array(g.valid.length).fill(-1);
    let id = 0;
    for (let s = 0; s < faces.length; s++) {
      if (faces[s] !== -1 || !this.isFree(s)) continue;
      const stack = [s];
      faces[s] = id;
      while (stack.length) {
        const c = stack.pop()!;
        for (const n of g.nbrs[c]) {
          if (faces[n] === -1 && this.isFree(n)) {
            faces[n] = id;
            stack.push(n);
          }
        }
      }
      id++;
    }
    return faces;
  }

  /** from → via → to 경로. 한쪽 순서로 막히면 반대 순서로도 시도한다. */
  private routeVia(from: number, via: number, to: number, passable: (i: number) => boolean, noise: number): number[] | null {
    const tryOrder = (a: number, b: number): number[] | null => {
      const p1 = this.route(a, via, passable, noise);
      if (!p1) return null;
      const used = new Set(p1);
      used.delete(via);
      const p2 = this.route(via, b, (i) => passable(i) && !used.has(i), noise);
      if (!p2) return null;
      return [...p1, ...p2.slice(1)];
    };
    const fwd = tryOrder(from, to);
    if (fwd) return fwd;
    const rev = tryOrder(to, from);
    return rev ? rev.reverse() : null;
  }

  /** 무작위 가중치 다익스트라 (noise가 클수록 구불구불한 경로) */
  private route(from: number, to: number, passable: (i: number) => boolean, noise: number): number[] | null {
    const g = this.grid;
    const n = g.valid.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const cost = new Float64Array(n);
    for (let i = 0; i < n; i++) cost[i] = 1 + noise * this.rng();
    const heap = new MinHeap();
    dist[from] = 0;
    heap.push(0, from);
    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      if (u === to) break;
      for (const v of g.nbrs[u]) {
        if (!(v === to || passable(v))) continue;
        const nd = d + cost[v];
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          heap.push(nd, v);
        }
      }
    }
    if (dist[to] === Infinity) return null;
    const path: number[] = [];
    for (let c = to; c !== -1; c = prev[c]) path.push(c);
    path.reverse();
    return path;
  }

  private toGenerated(p: PlacedPair): GeneratedPair {
    const g = this.grid;
    const pts: Point2D[] = [];
    if (p.a.anchor) pts.push({ ...p.a.pos });
    for (const c of p.cells) pts.push({ ...g.centers[c] });
    if (p.b.anchor) pts.push({ ...p.b.pos });
    return { pointA: { ...p.a.pos }, pointB: { ...p.b.pos }, path: simplify(pts) };
  }

  private angleOf(p: Point2D): number {
    return Math.atan2(p.y - 0.5, p.x - 0.5);
  }

  private angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }

  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length > 0) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** 일직선 위의 중간 점 제거 */
function simplify(pts: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const p of pts) {
    if (out.length > 0 && Vector2.distance(out[out.length - 1], p) < 1e-9) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if (Math.abs(Intersection.ccw(a, b, c)) < 1e-12 && Vector2.dot(Vector2.subtract(b, a), Vector2.subtract(c, b)) > 0) {
        out.splice(out.length - 2, 1);
      } else break;
    }
  }
  return out;
}
