import {
  Camera,
  Color,
  EventKeyboard,
  EventTouch,
  Input,
  KeyCode,
  Material,
  MeshRenderer,
  Node,
  Prefab,
  Scene,
  Texture2D,
  Vec3,
  gfx,
  input,
  instantiate,
  primitives,
  resources,
  utils,
} from 'cc';
import { RaceHud } from './RaceHud';
import { WorldBend } from './WorldBend';

const GRID = 62;
const ROAD_W = 12;
const LANE_W = 2.5;
const L1_LEN = 47.181;
const TURN_ZONE = 28;
const TURN_R = 8;
const CAM_HOLD = 0.16;
const CAM_SWING = 0.62;
const START_Z = -48;
const MAX_LIVES = 5;
const DIRS = [
  { x: 0, z: 1 },
  { x: 1, z: 0 },
  { x: 0, z: -1 },
  { x: -1, z: 0 },
];
const BLOCKS = ['map_MK1', 'map_MK2', 'map_MK3', 'map_MK4'];
const CARS = ['car_yellow', 'car_g3', 'car_g4', 'car_blue'];

type Actor = {
  node: Node;
  heading: number;
  lane: number;
  x: number;
  z: number;
  speed: number;
  kind?: string;
};

type Pickup = {
  node: Node;
  kind: string;
  x: number;
  z: number;
  taken: boolean;
};

type TurnMotion = {
  fromH: number;
  toH: number;
  dir: number;
  ix: number;
  iz: number;
  r: number;
  t: number;
  dur: number;
};

function hash(i: number, j: number, s = 0): number {
  let n = (i * 73856093) ^ (j * 19349663) ^ (s * 83492791);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n >>> 0) % 10000) / 10000;
}

function rightOf(h: number): { x: number; z: number } {
  const d = DIRS[h];
  return { x: d.z, z: -d.x };
}

function turnLabel(t: number): string {
  if (t > 0) return '← 路口左转';
  if (t < 0) return '路口右转 →';
  return '↑ 路口直行';
}

function headingYaw(h: number): number {
  return (Math.atan2(DIRS[h].x, DIRS[h].z) * 180) / Math.PI;
}

/** glTF cars face -Z; travel heading 0 is +Z. */
function modelYaw(travelYaw: number): number {
  return travelYaw + 180;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export class RaceGame {
  private scene: Scene;
  private world = new Node('World');
  private actors = new Node('Actors');
  private hud: RaceHud | null = null;
  private templates = new Map<string, Prefab>();
  private tiles = new Map<string, Node>();
  private traffic: Actor[] = [];
  private pickups: Pickup[] = [];
  private player: Node | null = null;
  private robber: Node | null = null;
  private hazard: Actor | null = null;
  private mainCam: Camera | null = null;
  private sky: Node | null = null;
  private skyTex: Texture2D | null = null;
  private disposed = false;
  private touch0 = { x: 0, y: 0 };

  private mode: 'boot' | 'play' | 'over' = 'boot';
  private heading = 0;
  private lane = 2;
  private x = 0;
  private z = START_Z;
  private speed = 16;
  private lives = 3;
  private coins = 0;
  private dist = 0;
  private invuln = 0;
  private magnet = 0;
  private double = 0;
  private pendingTurn = 0;
  private firstCross = true;
  private robberHeading = 0;
  private robberLane = 1;
  private robberX = 0;
  private robberZ = START_Z + 22;
  private robberTurn = 0;
  private hazardT = 18;
  private playerTurn: TurnMotion | null = null;
  private robberMotion: TurnMotion | null = null;
  private playerYaw = 0;
  private robberYaw = 0;
  private playerAt = new Vec3();
  private viewYaw = 0;
  private viewFrom = 0;
  private viewTo = 0;
  private viewT = 1;
  private camHold = 0;
  private camPos = new Vec3();
  private lookPos = new Vec3();
  private lookSmoothed = new Vec3();
  private camInited = false;
  private pickupSpin = 0;
  private glassMat: Material | null = null;
  private worldBend = new WorldBend();

  static create(scene: Scene): RaceGame {
    const g = new RaceGame(scene);
    g.boot();
    return g;
  }

  constructor(scene: Scene) {
    this.scene = scene;
  }

  layoutChrome(): void {
    this.hud?.layout();
  }

  dispose(): void {
    this.disposed = true;
    input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    this.hud?.dispose();
    this.sky?.destroy();
    this.sky = null;
    this.world.destroy();
    this.actors.destroy();
  }

  private async boot(): Promise<void> {
    this.scene.addChild(this.world);
    this.scene.addChild(this.actors);
    this.mainCam = this.scene.getChildByName('Main Camera')?.getComponent(Camera) ?? null;
    if (this.mainCam) {
      this.mainCam.clearColor = new Color(185, 216, 239, 255);
      this.mainCam.far = 650;
    }
    this.worldBend.attach(this.mainCam);

    const canvas = this.scene.getChildByName('Canvas');
    if (canvas) this.hud = new RaceHud(canvas, () => this.resetRun());

    const names = ['map_L0', 'map_L1', ...BLOCKS, 'car_player', 'car_robber', ...CARS, 'sky'];
    await Promise.all([...names.map((n) => this.loadPrefab(n)), this.loadSkyTexture()]);
    if (this.disposed) return;

    this.attachSky();
    this.player = this.spawn('car_player');
    this.robber = this.spawn('car_robber');
    this.ensureWorld();
    const start = this.pose(this.player, this.x, this.z, this.heading, this.lane);
    this.playerAt.set(start.x, 0, start.z);
    this.playerYaw = headingYaw(this.heading);
    this.robberYaw = headingYaw(this.robberHeading);
    this.viewYaw = this.playerYaw;
    this.viewFrom = this.playerYaw;
    this.viewTo = this.playerYaw;
    this.pose(this.robber, this.robberX, this.robberZ, this.robberHeading, this.robberLane);
    this.hud?.setStats(0, 0, 3);

    input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
  }

  private loadPrefab(name: string): Promise<void> {
    const paths = [`models/${name}/${name}`, `models/${name}`];
    const tryAt = (i: number, resolve: () => void): void => {
      if (i >= paths.length) {
        console.warn(`[Race] missing prefab models/${name}`);
        resolve();
        return;
      }
      resources.load(paths[i], Prefab, (err, prefab) => {
        if (!err && prefab) {
          this.templates.set(name, prefab);
          resolve();
          return;
        }
        tryAt(i + 1, resolve);
      });
    };
    return new Promise((resolve) => tryAt(0, resolve));
  }

  private loadSkyTexture(): Promise<void> {
    return new Promise((resolve) => {
      resources.load('textures/sky/texture', Texture2D, (err, tex) => {
        if (!err && tex) {
          this.skyTex = tex;
          resolve();
          return;
        }
        resources.load('textures/sky', Texture2D, (err2, tex2) => {
          if (!err2 && tex2) this.skyTex = tex2;
          resolve();
        });
      });
    });
  }

  private tint(color: Color): Material {
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit' });
    mat.setProperty('mainColor', color);
    return mat;
  }

  private meshNode(name: string, geo: Parameters<typeof utils.MeshUtils.createMesh>[0], color: Color): Node {
    const node = new Node(name);
    const mr = node.addComponent(MeshRenderer);
    mr.mesh = utils.MeshUtils.createMesh(geo);
    mr.material = this.tint(color);
    return node;
  }

  private makeRoadFallback(name: string, width: number, length: number): Node {
    const root = new Node(name);
    const slab = this.meshNode('slab', primitives.box({ width, height: 0.04, length }), new Color(198, 186, 168, 255));
    slab.setPosition(0, -0.02, 0);
    root.addChild(slab);
    return root;
  }

  private makeFallback(name: string): Node {
    if (name.startsWith('car_')) {
      const colors: Record<string, Color> = {
        car_player: new Color(220, 70, 70, 255),
        car_robber: new Color(40, 40, 48, 255),
        car_yellow: new Color(240, 193, 75, 255),
        car_g3: new Color(80, 180, 90, 255),
        car_g4: new Color(70, 160, 80, 255),
        car_blue: new Color(70, 130, 220, 255),
      };
      return this.meshNode(name, primitives.box({ width: 1.5, height: 0.75, length: 3.2 }), colors[name] || Color.WHITE);
    }
    if (name.startsWith('map_MK')) {
      const root = new Node(name);
      const block = this.meshNode('block', primitives.box({ width: 46, height: 8, length: 46 }), new Color(92, 118, 86, 255));
      block.setPosition(0, 4, 0);
      root.addChild(block);
      return root;
    }
    if (name === 'map_L1') {
      return this.makeRoadFallback(name, ROAD_W, L1_LEN);
    }
    return this.makeRoadFallback(name, ROAD_W, ROAD_W);
  }

  private carGlass(): Material {
    if (this.glassMat) return this.glassMat;
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-unlit' });
    mat.setProperty('mainColor', new Color(28, 34, 42, 255));
    mat.overridePipelineStates({
      rasterizerState: { cullMode: 0 },
    });
    this.glassMat = mat;
    return mat;
  }

  private sealCar(node: Node): void {
    const glass = this.carGlass();
    for (const mr of node.getComponentsInChildren(MeshRenderer)) {
      if (/^car00b/i.test(mr.node.name)) mr.material = glass;
    }
  }

  private attachSky(): void {
    const prefab = this.templates.get('sky');
    this.sky = prefab ? instantiate(prefab) : this.makeSkyFallback();
    this.sky.name = 'sky';
    this.scene.addChild(this.sky);
    this.dressSky(this.sky);
  }

  private makeSkyFallback(): Node {
    const root = new Node('sky');
    const dome = this.meshNode(
      'dome',
      primitives.cylinder({ radiusTop: 320, radiusBottom: 320, height: 211, radialSegments: 48 }),
      Color.WHITE,
    );
    dome.setPosition(0, 105.5, 0);
    root.addChild(dome);
    return root;
  }

  private dressSky(root: Node): void {
    const mrs = root.getComponentsInChildren(MeshRenderer);
    for (const mr of mrs) {
      mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
      mr.receiveShadow = false;
      const src = mr.getSharedMaterial(0) ?? mr.material;
      const tex = this.skyTex ?? src?.getProperty('mainTexture') ?? src?.getProperty('albedoMap');
      const mat = new Material();
      mat.initialize({
        effectName: 'builtin-unlit',
        defines: { USE_TEXTURE: !!tex },
        states: { rasterizerState: { cullMode: gfx.CullMode.NONE } },
      });
      if (tex) mat.setProperty('mainTexture', tex);
      mat.setProperty('mainColor', Color.WHITE);
      mr.material = mat;
    }
  }

  private spawn(name: string): Node {
    const prefab = this.templates.get(name);
    const node = prefab ? instantiate(prefab) : this.makeFallback(name);
    if (name.startsWith('car_')) this.sealCar(node);
    this.actors.addChild(node);
    return node;
  }

  private instWorld(name: string): Node {
    const prefab = this.templates.get(name);
    const node = prefab ? instantiate(prefab) : this.makeFallback(name);
    this.world.addChild(node);
    return node;
  }

  private snapRoad(x: number, z: number, heading: number): { x: number; z: number } {
    if (heading % 2 === 0) return { x: Math.round(x / GRID) * GRID, z };
    return { x, z: Math.round(z / GRID) * GRID };
  }

  private poseOnRoad(x: number, z: number, heading: number, lane: number) {
    const road = this.snapRoad(x, z, heading);
    const r = rightOf(heading);
    const off = (lane - 1.5) * LANE_W;
    return { x: road.x + r.x * off, z: road.z + r.z * off };
  }

  private pose(node: Node | null, x: number, z: number, heading: number, lane: number): { x: number; z: number } {
    const p = this.poseOnRoad(x, z, heading, lane);
    if (node) {
      node.setPosition(p.x, 0, p.z);
      node.setRotationFromEuler(0, modelYaw(headingYaw(heading)), 0);
    }
    return p;
  }

  private nextIntersection(x: number, z: number, heading: number) {
    const d = DIRS[heading];
    let ti = Math.round(x / GRID);
    let tj = Math.round(z / GRID);
    if (heading === 0) tj = Math.floor(z / GRID) + 1;
    if (heading === 2) tj = Math.ceil(z / GRID) - 1;
    if (heading === 1) ti = Math.floor(x / GRID) + 1;
    if (heading === 3) ti = Math.ceil(x / GRID) - 1;
    const tx = ti * GRID;
    const tz = tj * GRID;
    const dist = (tx - x) * d.x + (tz - z) * d.z;
    return { i: ti, j: tj, x: tx, z: tz, dist };
  }

  private ensureWorld(): void {
    const pi = Math.round(this.x / GRID);
    const pj = Math.round(this.z / GRID);
    const keep = new Set<string>();
    const R = 2;
    for (let i = pi - R; i <= pi + R; i++) {
      for (let j = pj - R; j <= pj + R; j++) {
        keep.add(`x:${i}:${j}`);
        keep.add(`v:${i}:${j}`);
        keep.add(`h:${i}:${j}`);
        keep.add(`b:${i}:${j}`);
        this.placeIntersection(i, j);
        this.placeVertical(i, j);
        this.placeHorizontal(i, j);
        this.placeBlock(i, j);
      }
    }
    for (const [k, node] of this.tiles) {
      if (keep.has(k)) continue;
      node.destroy();
      this.tiles.delete(k);
    }
  }

  private placeIntersection(i: number, j: number): void {
    const k = `x:${i}:${j}`;
    if (this.tiles.has(k)) return;
    const n = this.instWorld('map_L0');
    n.setPosition(i * GRID, 0, j * GRID);
    this.tiles.set(k, n);
  }

  private placeVertical(i: number, j: number): void {
    const k = `v:${i}:${j}`;
    if (this.tiles.has(k)) return;
    const n = this.instWorld('map_L1');
    n.setPosition(i * GRID, 0, j * GRID + GRID / 2);
    n.setScale(1, 1, (GRID - ROAD_W) / L1_LEN);
    this.tiles.set(k, n);
  }

  private placeHorizontal(i: number, j: number): void {
    const k = `h:${i}:${j}`;
    if (this.tiles.has(k)) return;
    const n = this.instWorld('map_L1');
    n.setPosition(i * GRID + GRID / 2, 0, j * GRID);
    n.setRotationFromEuler(0, 90, 0);
    n.setScale(1, 1, (GRID - ROAD_W) / L1_LEN);
    this.tiles.set(k, n);
  }

  private placeBlock(i: number, j: number): void {
    const k = `b:${i}:${j}`;
    if (this.tiles.has(k)) return;
    const n = this.instWorld(BLOCKS[Math.floor(hash(i, j, 3) * 4)]);
    n.setPosition(i * GRID + GRID / 2, 0, j * GRID + GRID / 2);
    n.setRotationFromEuler(0, Math.floor(hash(i, j, 7) * 4) * 90, 0);
    this.tiles.set(k, n);
  }

  private resetRun(): void {
    this.mode = 'play';
    this.heading = 0;
    this.lane = 2;
    this.x = 0;
    this.z = START_Z;
    this.speed = 16;
    this.lives = 3;
    this.coins = 0;
    this.dist = 0;
    this.invuln = 0;
    this.magnet = 0;
    this.double = 0;
    this.pendingTurn = 0;
    this.firstCross = true;
    this.playerTurn = null;
    this.robberMotion = null;
    this.playerYaw = 0;
    this.robberYaw = 0;
    this.viewYaw = 0;
    this.viewFrom = 0;
    this.viewTo = 0;
    this.viewT = 1;
    this.camHold = 0;
    this.robberHeading = 0;
    this.robberLane = 1;
    this.robberX = 0;
    this.robberZ = START_Z + 22;
    this.robberTurn = 0;
    this.hazardT = 16;
    for (const t of this.traffic) t.node.destroy();
    this.traffic.length = 0;
    for (const p of this.pickups) p.node.destroy();
    this.pickups.length = 0;
    if (this.hazard) {
      this.hazard.node.destroy();
      this.hazard = null;
    }
    this.hud?.hideCover();
    this.hud?.setHint('');
    this.hud?.setWarn('');
    const start = this.pose(this.player, this.x, this.z, this.heading, this.lane);
    this.playerAt.set(start.x, 0, start.z);
    this.pose(this.robber, this.robberX, this.robberZ, this.robberHeading, this.robberLane);
  }

  private endRun(reason: string): void {
    this.mode = 'over';
    this.hud?.showCover('追捕结束', `${reason}\n距离 ${Math.floor(this.dist)} 米 · 金币 ${this.coins}`, '再追一次');
  }

  private onTouchStart = (e: EventTouch): void => {
    const loc = e.getUILocation();
    this.touch0.x = loc.x;
    this.touch0.y = loc.y;
  };

  private onTouchEnd = (e: EventTouch): void => {
    const loc = e.getUILocation();
    this.swipe(loc.x - this.touch0.x, loc.y - this.touch0.y);
  };

  private onKey = (e: EventKeyboard): void => {
    if (e.keyCode === KeyCode.ARROW_LEFT || e.keyCode === KeyCode.KEY_A) this.swipe(-80, 0);
    if (e.keyCode === KeyCode.ARROW_RIGHT || e.keyCode === KeyCode.KEY_D) this.swipe(80, 0);
    if (e.keyCode === KeyCode.ARROW_UP || e.keyCode === KeyCode.KEY_W) this.swipe(0, 80);
  };

  private swipe(dx: number, dy: number): void {
    if (this.mode !== 'play') return;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    const turning = !!this.playerTurn;
    const nx = this.nextIntersection(this.x, this.z, this.heading);
    const inTurn = !turning && nx.dist > 0 && nx.dist < TURN_ZONE;
    if (inTurn && Math.abs(dx) > Math.abs(dy) * 0.7) {
      this.pendingTurn = dx < 0 ? 1 : -1;
      return;
    }
    if (inTurn && dy > 30) {
      this.pendingTurn = 0;
      return;
    }
    if (dx < 0) this.lane = Math.min(3, this.lane + 1);
    if (dx > 0) this.lane = Math.max(0, this.lane - 1);
  }

  private move(target: { heading: number; x: number; z: number }, dt: number, speed: number): void {
    const d = DIRS[target.heading];
    target.x += d.x * speed * dt;
    target.z += d.z * speed * dt;
  }

  private chooseTurn(i: number, j: number): number {
    const roll = hash(i, j, 11);
    if (roll < 0.34) return -1;
    if (roll < 0.68) return 1;
    return 0;
  }

  private pickRobberNextTurn(): void {
    const nxt = this.nextIntersection(
      this.robberX + DIRS[this.robberHeading].x * 3,
      this.robberZ + DIRS[this.robberHeading].z * 3,
      this.robberHeading,
    );
    this.robberTurn = this.chooseTurn(nxt.i, nxt.j);
  }

  private arcPoint(m: TurnMotion, t: number): { x: number; z: number } {
    const fromD = DIRS[m.fromH];
    const right = rightOf(m.fromH);
    const px = m.ix - fromD.x * m.r + right.x * m.dir * m.r;
    const pz = m.iz - fromD.z * m.r + right.z * m.dir * m.r;
    const ox = -right.x * m.dir * m.r;
    const oz = -right.z * m.dir * m.r;
    const th = t * Math.PI * 0.5;
    const c = Math.cos(th);
    const s = Math.sin(th);
    return {
      x: px + ox * c + m.dir * oz * s,
      z: pz - m.dir * ox * s + oz * c,
    };
  }

  private makeTurn(fromH: number, turn: number, ix: number, iz: number, dist: number, speed: number): TurnMotion {
    const r = TURN_R;
    const s = Math.max(0, Math.min(1, 1 - dist / r));
    const t0 = Math.asin(s) / (Math.PI * 0.5);
    return {
      fromH,
      toH: (fromH + turn + 4) % 4,
      dir: turn,
      ix,
      iz,
      r,
      t: t0,
      dur: Math.max(0.4, ((Math.PI * 0.5) * r) / Math.max(speed, 10)),
    };
  }

  private poseCar(node: Node | null, x: number, z: number, lane: number, yaw: number, roll = 0): { x: number; z: number } {
    const rad = (yaw * Math.PI) / 180;
    const off = (lane - 1.5) * LANE_W;
    const px = x + Math.cos(rad) * off;
    const pz = z - Math.sin(rad) * off;
    if (node) {
      node.setPosition(px, 0, pz);
      node.setRotationFromEuler(0, modelYaw(yaw), roll);
    }
    return { x: px, z: pz };
  }

  private tryBeginTurn(who: 'player' | 'robber'): void {
    const isPlayer = who === 'player';
    if (isPlayer ? this.playerTurn : this.robberMotion) return;
    const x = isPlayer ? this.x : this.robberX;
    const z = isPlayer ? this.z : this.robberZ;
    const heading = isPlayer ? this.heading : this.robberHeading;
    const nx = this.nextIntersection(x, z, heading);
    const turn = isPlayer ? (this.firstCross ? 0 : this.pendingTurn) : this.robberTurn;

    if (turn === 0) {
      if (nx.dist > 1.2 || nx.dist < -1.5) return;
      if (isPlayer) {
        this.x = nx.x;
        this.z = nx.z;
        this.pendingTurn = 0;
        this.firstCross = false;
      } else {
        this.robberX = nx.x;
        this.robberZ = nx.z;
        this.pickRobberNextTurn();
      }
      return;
    }

    if (nx.dist > TURN_R || nx.dist < -0.6) return;
    const motion = this.makeTurn(heading, turn, nx.x, nx.z, nx.dist, this.speed);
    const p = this.arcPoint(motion, motion.t);
    if (isPlayer) {
      this.playerTurn = motion;
      this.heading = motion.toH;
      this.x = p.x;
      this.z = p.z;
      this.playerYaw = headingYaw(motion.fromH) + motion.dir * 90 * motion.t;
      this.pendingTurn = 0;
      this.firstCross = false;
      this.viewFrom = headingYaw(motion.fromH);
      this.viewTo = headingYaw(motion.fromH);
      this.viewT = 1;
      this.camHold = 0;
    } else {
      this.robberMotion = motion;
      this.robberHeading = motion.toH;
      this.robberX = p.x;
      this.robberZ = p.z;
      this.robberYaw = headingYaw(motion.fromH) + motion.dir * 90 * motion.t;
    }
  }

  private finishTurn(who: 'player' | 'robber', m: TurnMotion): void {
    const p = this.arcPoint(m, 1);
    if (who === 'player') {
      this.x = p.x;
      this.z = p.z;
      this.heading = m.toH;
      this.playerYaw = headingYaw(m.toH);
      this.playerTurn = null;
      this.viewFrom = headingYaw(m.fromH);
      this.viewTo = headingYaw(m.toH);
      this.viewT = 0;
      this.camHold = CAM_HOLD;
    } else {
      this.robberX = p.x;
      this.robberZ = p.z;
      this.robberHeading = m.toH;
      this.robberYaw = headingYaw(m.toH);
      this.robberMotion = null;
      this.pickRobberNextTurn();
    }
  }

  private advanceTurn(who: 'player' | 'robber', dt: number): void {
    const m = who === 'player' ? this.playerTurn : this.robberMotion;
    if (!m) return;
    m.t = Math.min(1, m.t + dt / m.dur);
    const p = this.arcPoint(m, m.t);
    const yaw = headingYaw(m.fromH) + m.dir * 90 * m.t;
    if (who === 'player') {
      this.x = p.x;
      this.z = p.z;
      this.playerYaw = yaw;
    } else {
      this.robberX = p.x;
      this.robberZ = p.z;
      this.robberYaw = yaw;
    }
    if (m.t >= 1) this.finishTurn(who, m);
  }

  private advanceView(dt: number): void {
    if (this.playerTurn) {
      this.viewYaw = headingYaw(this.playerTurn.fromH);
      return;
    }
    if (this.camHold > 0) {
      this.camHold = Math.max(0, this.camHold - dt);
      this.viewYaw = this.viewFrom;
      return;
    }
    if (this.viewT < 1) {
      this.viewT = Math.min(1, this.viewT + dt / CAM_SWING);
      this.viewYaw = lerpAngle(this.viewFrom, this.viewTo, easeInOutCubic(this.viewT));
      return;
    }
    this.viewYaw = this.viewTo;
  }

  private hitPlayer(from?: Actor): void {
    if (this.invuln > 0) return;
    this.lives -= 1;
    this.invuln = 1.4;
    if (from) {
      from.node.destroy();
      const i = this.traffic.indexOf(from);
      if (i >= 0) this.traffic.splice(i, 1);
      if (this.hazard === from) {
        this.hazard = null;
        this.hazardT = 12;
      }
    }
    if (this.lives <= 0) this.endRun('被撞停了');
  }

  tick(dt: number): void {
    if (!this.player) {
      this.updateCamera(0.08);
      this.syncBend();
      return;
    }
    if (this.mode !== 'play') {
      this.advanceView(dt);
      this.updateCamera(0.08);
      this.syncBend();
      return;
    }
    this.speed = Math.min(28, 16 + this.dist * 0.01);
    if (this.playerTurn) this.advanceTurn('player', dt);
    else {
      this.move(this, dt, this.speed);
      this.tryBeginTurn('player');
    }
    this.dist += this.speed * dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.magnet = Math.max(0, this.magnet - dt);
    this.double = Math.max(0, this.double - dt);

    if (this.mode !== 'play') return;

    if (this.robberMotion) this.advanceTurn('robber', dt);
    else {
      const robberLead = 22;
      const along =
        (this.robberX - this.x) * DIRS[this.heading].x + (this.robberZ - this.z) * DIRS[this.heading].z;
      const catchUp = along < robberLead ? this.speed + 2 : this.speed - 1.5;
      const rd = DIRS[this.robberHeading];
      this.robberX += rd.x * catchUp * dt;
      this.robberZ += rd.z * catchUp * dt;
      this.tryBeginTurn('robber');
    }

    this.ensureWorld();
    if (Math.random() < 0.025) this.spawnTraffic();
    if (Math.random() < 0.04) this.spawnPickup();
    this.hazardT -= dt;
    this.pickupSpin += dt * 180;
    if (!this.hazard && this.hazardT < 0) this.spawnHazard();

    const playerRoll = this.playerTurn ? -this.playerTurn.dir * 12 * Math.sin(Math.PI * this.playerTurn.t) : 0;
    const p = this.playerTurn
      ? this.poseCar(this.player, this.x, this.z, this.lane, this.playerYaw, playerRoll)
      : this.pose(this.player, this.x, this.z, this.heading, this.lane);
    this.playerAt.set(p.x, 0, p.z);
    const robberRoll = this.robberMotion ? -this.robberMotion.dir * 12 * Math.sin(Math.PI * this.robberMotion.t) : 0;
    if (this.robberMotion) {
      this.poseCar(this.robber, this.robberX, this.robberZ, this.robberLane, this.robberYaw, robberRoll);
    } else {
      this.pose(this.robber, this.robberX, this.robberZ, this.robberHeading, this.robberLane);
    }

    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const t = this.traffic[i];
      this.move(t, dt, t.speed);
      this.pose(t.node, t.x, t.z, t.heading, t.lane);
      const dx = t.node.position.x - p.x;
      const dz = t.node.position.z - p.z;
      if (dx * dx + dz * dz < 2.4 && t.lane === this.lane) this.hitPlayer(t);
    }
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.node.setRotationFromEuler(90, this.pickupSpin, 0);
      const pdx = pk.node.position.x - p.x;
      const pdz = pk.node.position.z - p.z;
      const reach = this.magnet > 0 ? 7 : 1.6;
      if (pdx * pdx + pdz * pdz < reach * reach) this.collect(pk);
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (this.pickups[i].taken) this.pickups.splice(i, 1);
    }
    if (this.hazard) {
      this.move(this.hazard, dt, this.hazard.speed);
      this.pose(this.hazard.node, this.hazard.x, this.hazard.z, this.hazard.heading, this.hazard.lane);
      const hx = this.hazard.node.position.x - p.x;
      const hz = this.hazard.node.position.z - p.z;
      if (hx * hx + hz * hz < 2.8 && this.hazard.lane === this.lane) this.hitPlayer(this.hazard);
      const hd = DIRS[this.heading];
      const alongH = (this.hazard.x - this.x) * hd.x + (this.hazard.z - this.z) * hd.z;
      if (alongH > 28) {
        this.hazard.node.destroy();
        this.hazard = null;
        this.hazardT = 18 + Math.random() * 8;
      }
    }

    const nx = this.nextIntersection(this.x, this.z, this.heading);
    if (this.playerTurn) {
      this.hud?.setHint(this.playerTurn.dir > 0 ? '← 转弯中' : '转弯中 →');
    } else if (nx.dist > 0 && nx.dist < TURN_ZONE) {
      this.hud?.setHint(turnLabel(this.pendingTurn));
    } else {
      this.hud?.setHint('');
    }
    this.hud?.setWarn(this.hazard && this.hazard.lane === this.lane ? '救护车占道，立刻换道' : '');
    this.hud?.setStats(this.dist, this.coins, this.lives);
    this.advanceView(dt);
    const camBusy = !!(this.playerTurn || this.camHold > 0 || this.viewT < 1);
    this.updateCamera(camBusy ? 0.28 : 0.14);
    this.syncBend();
    this.recycle();
  }

  private syncBend(): void {
    this.worldBend.capture(this.world);
    this.worldBend.capture(this.actors);
    this.worldBend.sync();
  }

  private spawnTraffic(): void {
    if (this.traffic.length > 10) return;
    const d = DIRS[this.heading];
    const along = 30 + Math.random() * 50;
    const lane = Math.floor(Math.random() * 4);
    if (lane === this.lane && Math.random() < 0.55) return;
    const name = CARS[Math.floor(Math.random() * CARS.length)];
    const node = this.spawn(name);
    const actor: Actor = {
      node,
      heading: this.heading,
      lane,
      x: this.x + d.x * along,
      z: this.z + d.z * along,
      speed: 10 + Math.random() * 4,
    };
    this.traffic.push(actor);
    this.pose(node, actor.x, actor.z, actor.heading, actor.lane);
  }

  private spawnPickup(): void {
    if (this.pickups.length > 28) return;
    const d = DIRS[this.heading];
    const along = 18 + Math.random() * 70;
    const lane = 1 + Math.floor(Math.random() * 2);
    const x = this.x + d.x * along;
    const z = this.z + d.z * along;
    const nx = this.nextIntersection(x, z, this.heading);
    if (nx.dist > 0 && nx.dist < 8) return;
    const roll = Math.random();
    let kind = 'coin';
    let color = new Color(240, 193, 75, 255);
    if (roll > 0.93) {
      kind = 'life';
      color = new Color(232, 93, 76, 255);
    } else if (roll > 0.88) {
      kind = 'magnet';
      color = new Color(110, 198, 255, 255);
    } else if (roll > 0.83) {
      kind = 'star';
      color = new Color(255, 224, 138, 255);
    } else if (roll > 0.78) {
      kind = 'double';
      color = new Color(192, 132, 252, 255);
    }
    const geo =
      kind === 'coin'
        ? primitives.cylinder({ radiusTop: 0.38, radiusBottom: 0.38, height: 0.1, radialSegments: 16 })
        : primitives.box({ width: 0.7, height: 0.7, length: 0.7 });
    const node = this.meshNode(kind, geo, color);
    const p = this.poseOnRoad(x, z, this.heading, lane);
    node.setPosition(p.x, 0.8, p.z);
    this.actors.addChild(node);
    this.pickups.push({ node, kind, x: p.x, z: p.z, taken: false });
  }

  private collect(p: Pickup): void {
    p.taken = true;
    p.node.destroy();
    if (p.kind === 'coin') this.coins += this.double > 0 ? 2 : 1;
    if (p.kind === 'life') this.lives = Math.min(MAX_LIVES, this.lives + 1);
    if (p.kind === 'magnet') this.magnet = 6;
    if (p.kind === 'star') this.invuln = 5;
    if (p.kind === 'double') this.double = 6;
  }

  private spawnHazard(): void {
    const d = DIRS[this.heading];
    const node = this.spawn('car_g3');
    this.hazard = {
      node,
      heading: this.heading,
      lane: Math.floor(Math.random() * 4),
      x: this.x - d.x * 18,
      z: this.z - d.z * 18,
      speed: this.speed + 8,
      kind: 'hazard',
    };
    this.pose(node, this.hazard.x, this.hazard.z, this.hazard.heading, this.hazard.lane);
  }

  private recycle(): void {
    const d = DIRS[this.heading];
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const a = this.traffic[i];
      const along = (a.x - this.x) * d.x + (a.z - this.z) * d.z;
      if (along < -36 || along > 120) {
        a.node.destroy();
        this.traffic.splice(i, 1);
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const a = this.pickups[i];
      const along = (a.x - this.x) * d.x + (a.z - this.z) * d.z;
      if (along < -36 || along > 120) {
        a.node.destroy();
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateCamera(lerp: number): void {
    if (!this.mainCam) return;
    const watchingTurn = !!(this.playerTurn || this.camHold > 0);
    const car = this.player
      ? this.playerAt
      : this.poseOnRoad(this.x, this.z, this.heading, this.lane);
    const rad = (this.viewYaw * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fz = Math.cos(rad);
    this.camPos.set(car.x - fx * 16, 8.4, car.z - fz * 16);
    const ahead = watchingTurn ? 0 : 2 + 8 * (this.viewT < 1 ? this.viewT : 1);
    this.lookPos.set(car.x + fx * ahead, 1.2, car.z + fz * ahead);
    const n = this.mainCam.node;
    if (!this.camInited) {
      n.setPosition(this.camPos);
      this.lookSmoothed.set(this.lookPos.x, this.lookPos.y, this.lookPos.z);
      this.camInited = true;
    } else {
      n.setPosition(
        n.position.x + (this.camPos.x - n.position.x) * lerp,
        n.position.y + (this.camPos.y - n.position.y) * lerp,
        n.position.z + (this.camPos.z - n.position.z) * lerp,
      );
      this.lookSmoothed.x += (this.lookPos.x - this.lookSmoothed.x) * lerp;
      this.lookSmoothed.y += (this.lookPos.y - this.lookSmoothed.y) * lerp;
      this.lookSmoothed.z += (this.lookPos.z - this.lookSmoothed.z) * lerp;
    }
    n.lookAt(this.lookSmoothed);
    this.sky?.setWorldPosition(n.position.x, 0, n.position.z);
  }
}
