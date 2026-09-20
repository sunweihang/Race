import { Camera, EffectAsset, Material, MeshRenderer, Node, Vec4, resources } from 'cc';

const SKIP = /^(sky|Hud|Canvas|LetterboxCam)$/i;
const GLASS = /glass|car00b/i;

export class WorldBend {
  enabled = false;
  radius = 130;
  private camera: Camera | null = null;
  private effect: EffectAsset | null = null;
  private mats: Material[] = [];
  private saved = new Map<MeshRenderer, (Material | null)[]>();
  private params = new Vec4();

  attach(camera: Camera | null): void {
    this.camera = camera;
    resources.load('effects/world-bend', EffectAsset, (err, fx) => {
      if (err || !fx) {
        console.warn('[Bend] effect missing', err);
        return;
      }
      this.effect = fx;
    });
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.release();
  }

  capture(root: Node | null): void {
    if (!this.enabled || !this.effect || !root?.isValid) return;
    const list = root.getComponentsInChildren(MeshRenderer);
    for (let i = 0; i < list.length; i++) this.patch(list[i]);
  }

  sync(): void {
    if (!this.enabled) return;
    const cam = this.camera?.node;
    if (!cam?.isValid || this.mats.length === 0) return;
    const p = cam.worldPosition;
    this.params.set(p.x, p.y, p.z, Math.max(this.radius, 8));
    for (let i = this.mats.length - 1; i >= 0; i--) {
      const mat = this.mats[i];
      if (!mat || !mat.isValid) {
        this.mats.splice(i, 1);
        continue;
      }
      mat.setProperty('bendParams', this.params);
    }
  }

  release(): void {
    for (const [mr, mats] of this.saved) {
      if (!mr?.isValid) continue;
      for (let i = 0; i < mats.length; i++) mr.setMaterial(mats[i], i);
    }
    this.saved.clear();
    this.mats.length = 0;
  }

  private patch(mr: MeshRenderer): void {
    if (!this.effect || !mr?.isValid || this.saved.has(mr)) return;
    if (this.shouldSkip(mr.node)) return;
    const shared = mr.sharedMaterials || [];
    const count = Math.max(shared.length, 1);
    const backup: (Material | null)[] = [];
    for (let i = 0; i < count; i++) backup.push(mr.getSharedMaterial(i) ?? mr.material ?? null);
    this.saved.set(mr, backup);
    for (let i = 0; i < count; i++) {
      const src = shared[i] ?? mr.getSharedMaterial(i) ?? mr.material;
      const glass = this.isGlass(mr, src);
      const tex =
        src?.getProperty('mainTexture') ??
        src?.getProperty('albedoMap') ??
        src?.getProperty('mainTex');
      const color = src?.getProperty('mainColor') ?? src?.getProperty('albedo');
      const mat = new Material();
      mat.initialize({
        effectAsset: this.effect,
        technique: glass ? 1 : 0,
        defines: { USE_TEXTURE: !!tex },
      });
      if (tex) mat.setProperty('mainTexture', tex);
      if (color) mat.setProperty('mainColor', color);
      const tiling = src?.getProperty('tilingOffset');
      if (tiling) mat.setProperty('tilingOffset', tiling);
      mr.setMaterial(mat, i);
      this.mats.push(mat);
    }
  }

  private isGlass(mr: MeshRenderer, src: Material | null): boolean {
    if (GLASS.test(mr.node.name)) return true;
    if (!src) return false;
    try {
      const c = src.getProperty('mainColor') as { w?: number; a?: number } | null;
      if (c && typeof c.w === 'number' && c.w < 0.95) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  private shouldSkip(node: Node): boolean {
    let n: Node | null = node;
    while (n) {
      if (SKIP.test(n.name)) return true;
      n = n.parent;
    }
    return false;
  }
}
