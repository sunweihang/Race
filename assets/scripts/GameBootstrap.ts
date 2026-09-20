import { _decorator, Camera, Component, Layers, Node, view } from 'cc';
import { RaceGame } from './game/RaceGame';
import {
  LETTERBOX_CLEAR,
  applyDesignResolution,
  applyPortraitCameraRect,
  applyPortraitUiCamera,
  lockPortraitUiRoot,
} from './game/PortraitFit';

const { ccclass } = _decorator;

@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
  private _game: RaceGame | null = null;
  private _letterboxCam: Camera | null = null;
  private _mainCam: Camera | null = null;
  private _uiCam: Camera | null = null;
  private _applyingFrame = false;

  onLoad(): void {
    applyDesignResolution();
    this._cacheCameras();
    this._ensureLetterboxCam();
    view.on('canvas-resize', this._applyPortraitFrame, this);
    this._game = RaceGame.create(this.node.scene!);
    this._applyPortraitFrame();
  }

  update(dt: number): void {
    this._game?.tick(dt);
  }

  onDestroy(): void {
    view.off('canvas-resize', this._applyPortraitFrame, this);
    this._game?.dispose();
    this._game = null;
  }

  private _cacheCameras(): void {
    const scene = this.node.scene;
    if (!scene) return;
    this._mainCam = scene.getChildByName('Main Camera')?.getComponent(Camera) ?? null;
    if (this._mainCam) {
      this._mainCam.enabled = true;
      this._mainCam.priority = 0;
      this._mainCam.visibility &= ~Layers.Enum.UI_2D;
    }
    const canvas = scene.getChildByName('Canvas');
    this._uiCam = canvas?.getChildByName('Camera')?.getComponent(Camera) ?? null;
  }

  private _ensureLetterboxCam(): void {
    const scene = this.node.scene;
    if (!scene) return;
    let node = scene.getChildByName('LetterboxCam');
    if (!node) {
      node = new Node('LetterboxCam');
      scene.addChild(node);
      node.setPosition(0, 0, 0);
    }
    let cam = node.getComponent(Camera);
    if (!cam) cam = node.addComponent(Camera);
    cam.projection = Camera.ProjectionType.ORTHO;
    cam.orthoHeight = 10;
    cam.priority = -100;
    cam.visibility = 0;
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = LETTERBOX_CLEAR;
    cam.rect.set(0, 0, 1, 1);
    this._letterboxCam = cam;
  }

  private _applyPortraitFrame = (): void => {
    if (this._applyingFrame) return;
    this._applyingFrame = true;
    try {
      applyDesignResolution();
      const canvas = this.node.scene?.getChildByName('Canvas') ?? null;
      lockPortraitUiRoot(canvas);
      if (this._uiCam?.isValid) applyPortraitUiCamera(this._uiCam, false);
      if (this._mainCam?.isValid) applyPortraitCameraRect(this._mainCam);
      if (this._letterboxCam?.isValid) {
        this._letterboxCam.clearColor = LETTERBOX_CLEAR;
        this._letterboxCam.rect.set(0, 0, 1, 1);
        this._letterboxCam.enabled = true;
      }
      this._game?.layoutChrome();
    } finally {
      this._applyingFrame = false;
    }
  };
}
