import {
  Camera,
  Color,
  Node,
  Rect,
  ResolutionPolicy,
  Size,
  UITransform,
  Widget,
  game,
  screen,
  view,
} from 'cc';

export const DESIGN_W = 1080;
export const DESIGN_H = 1920;
export const LETTERBOX_CLEAR = new Color(0, 0, 0, 255);

const _rect = new Rect();
const _size = new Size();
const FULL_VIEW = new Rect(0, 0, 1, 1);

let _appliedPolicy = -1;
let _appliedWinW = -1;
let _appliedWinH = -1;

export function applyDesignResolution(): void {
  const win = screen.windowSize;
  const ww = win.width;
  const wh = win.height;
  const winAspect = ww / Math.max(wh, 1);
  const designAspect = DESIGN_W / DESIGN_H;
  const policy =
    winAspect <= designAspect + 1e-3
      ? ResolutionPolicy.FIXED_WIDTH
      : ResolutionPolicy.SHOW_ALL;
  if (_appliedPolicy === policy && _appliedWinW === ww && _appliedWinH === wh) {
    return;
  }
  _appliedPolicy = policy;
  _appliedWinW = ww;
  _appliedWinH = wh;
  view.setDesignResolutionSize(DESIGN_W, DESIGN_H, policy);
}

export function portraitVisibleSize(out: Size = _size): Size {
  const v = view.getVisibleSize();
  out.set(Math.max(v.width, DESIGN_W), Math.max(v.height, DESIGN_H));
  return out;
}

export function uiOrthoHeight(): number {
  return portraitVisibleSize().height * 0.5;
}

export function designAspectViewRect(out: Rect = _rect): Rect {
  const vp = view.getViewportRect();
  const win = screen.windowSize;
  const ww = Math.max(win.width, 1);
  const wh = Math.max(win.height, 1);
  out.set(vp.x / ww, vp.y / wh, vp.width / ww, vp.height / wh);
  return out;
}

export function clientToUiLocation(
  clientX: number,
  clientY: number,
  allowOutside = false,
): { x: number; y: number } | null {
  const canvas = game.canvas as HTMLCanvasElement | null;
  if (!canvas) return null;
  const box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const lx = clientX - box.left;
  const ly = clientY - box.top;
  if (!allowOutside && (lx < 0 || ly < 0 || lx > box.width || ly > box.height)) {
    return null;
  }
  return normalizeViewToUi(lx / box.width, 1 - ly / box.height, allowOutside);
}

function normalizeViewToUi(nx: number, ny: number, allowOutside: boolean): { x: number; y: number } | null {
  const vp = designAspectViewRect();
  const rx = (nx - vp.x) / Math.max(vp.width, 1e-6);
  const ry = (ny - vp.y) / Math.max(vp.height, 1e-6);
  if (!allowOutside && (rx < -0.02 || ry < -0.02 || rx > 1.02 || ry > 1.02)) {
    return null;
  }
  const vis = portraitVisibleSize();
  return {
    x: Math.min(1, Math.max(0, rx)) * vis.width,
    y: Math.min(1, Math.max(0, ry)) * vis.height,
  };
}

export function applyPortraitCameraRect(cam: Camera): void {
  const r = designAspectViewRect();
  cam.rect = new Rect(r.x, r.y, r.width, r.height);
}

export function applyPortraitUiCamera(cam: Camera, coverWorld = false): void {
  cam.projection = Camera.ProjectionType.ORTHO;
  cam.orthoHeight = uiOrthoHeight();
  cam.clearFlags = coverWorld ? Camera.ClearFlag.SOLID_COLOR : Camera.ClearFlag.DEPTH_ONLY;
  if (coverWorld) cam.clearColor = LETTERBOX_CLEAR;
  applyPortraitCameraRect(cam);
}

export function fullViewRect(): Rect {
  return FULL_VIEW;
}

export function lockPortraitUiRoot(node: Node | null): void {
  if (!node?.isValid) return;
  const vis = portraitVisibleSize();
  const widget = node.getComponent(Widget);
  if (widget) widget.enabled = false;
  node.getComponent(UITransform)?.setContentSize(vis.width, vis.height);
  node.setPosition(0, 0, 0);
}
