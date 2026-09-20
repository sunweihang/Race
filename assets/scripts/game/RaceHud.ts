import {
  Button,
  Color,
  Graphics,
  Label,
  Layers,
  Node,
  UITransform,
  Widget,
} from 'cc';
import { DESIGN_H, DESIGN_W, portraitVisibleSize } from './PortraitFit';

function ui(node: Node): void {
  node.layer = Layers.Enum.UI_2D;
}

function label(parent: Node, name: string, size: number, color: Color): Label {
  const n = new Node(name);
  ui(n);
  parent.addChild(n);
  n.addComponent(UITransform);
  const lb = n.addComponent(Label);
  lb.string = '';
  lb.fontSize = size;
  lb.lineHeight = size + 8;
  lb.color = color;
  lb.isBold = true;
  lb.overflow = Label.Overflow.NONE;
  return lb;
}

export class RaceHud {
  root: Node;
  dist: Label;
  coins: Label;
  hearts: Label;
  hint: Label;
  warn: Label;
  cover: Node;
  coverTitle: Label;
  coverBody: Label;
  playBtn: Button;
  gm: Node;
  private bendBtn: Node;
  private bendLabel: Label;
  private bendGfx: Graphics;

  constructor(canvas: Node, onPlay: () => void, onToggleBend: () => void) {
    this.root = new Node('Hud');
    ui(this.root);
    canvas.addChild(this.root);
    const ut = this.root.addComponent(UITransform);
    ut.setContentSize(DESIGN_W, DESIGN_H);
    const w = this.root.addComponent(Widget);
    w.alignFlags = 45;
    w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
    w.top = w.bottom = w.left = w.right = 0;
    w.alignMode = Widget.AlignMode.ALWAYS;

    this.dist = label(this.root, 'Dist', 36, Color.WHITE);
    this.dist.node.setPosition(-420, 820, 0);
    this.dist.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.coins = label(this.root, 'Coins', 36, new Color(240, 193, 75, 255));
    this.coins.node.setPosition(420, 820, 0);
    this.coins.horizontalAlign = Label.HorizontalAlign.RIGHT;
    this.hearts = label(this.root, 'Hearts', 40, new Color(232, 93, 76, 255));
    this.hearts.node.setPosition(0, 820, 0);
    this.hint = label(this.root, 'Hint', 32, Color.WHITE);
    this.hint.node.setPosition(0, 560, 0);
    this.warn = label(this.root, 'Warn', 28, new Color(255, 224, 138, 255));
    this.warn.node.setPosition(0, -720, 0);

    this.cover = new Node('Cover');
    ui(this.cover);
    this.root.addChild(this.cover);
    const cut = this.cover.addComponent(UITransform);
    cut.setContentSize(DESIGN_W, DESIGN_H);
    const dim = this.cover.addComponent(Graphics);
    dim.fillColor = new Color(12, 16, 28, 210);
    dim.rect(-DESIGN_W * 0.5, -DESIGN_H * 0.5, DESIGN_W, DESIGN_H);
    dim.fill();
    this.coverTitle = label(this.cover, 'Title', 64, new Color(244, 239, 228, 255));
    this.coverTitle.node.setPosition(0, 180, 0);
    this.coverBody = label(this.cover, 'Body', 28, new Color(244, 239, 228, 255));
    this.coverBody.node.setPosition(0, 20, 0);
    this.coverBody.overflow = Label.Overflow.RESIZE_HEIGHT;
    this.coverBody.node.getComponent(UITransform)!.setContentSize(820, 220);

    const btnNode = new Node('Play');
    ui(btnNode);
    this.cover.addChild(btnNode);
    btnNode.setPosition(0, -220, 0);
    const but = btnNode.addComponent(UITransform);
    but.setContentSize(360, 96);
    const bg = btnNode.addComponent(Graphics);
    bg.fillColor = new Color(240, 193, 75, 255);
    bg.roundRect(-180, -48, 360, 96, 14);
    bg.fill();
    const btnLabel = label(btnNode, 'PlayLabel', 36, new Color(26, 35, 51, 255));
    btnLabel.string = '开始追捕';
    this.playBtn = btnNode.addComponent(Button);
    btnNode.on(Button.EventType.CLICK, onPlay, this);

    this.gm = new Node('Gm');
    ui(this.gm);
    this.root.addChild(this.gm);
    const gmUt = this.gm.addComponent(UITransform);
    gmUt.setContentSize(DESIGN_W, DESIGN_H);
    const gmDim = this.gm.addComponent(Graphics);
    gmDim.fillColor = new Color(12, 16, 28, 200);
    gmDim.rect(-DESIGN_W * 0.5, -DESIGN_H * 0.5, DESIGN_W, DESIGN_H);
    gmDim.fill();
    const gmTitle = label(this.gm, 'GmTitle', 56, new Color(244, 239, 228, 255));
    gmTitle.string = 'GM';
    gmTitle.node.setPosition(0, 280, 0);
    const gmHint = label(this.gm, 'GmHint', 26, new Color(196, 204, 216, 255));
    gmHint.string = '按 G 关闭';
    gmHint.node.setPosition(0, 200, 0);

    this.bendBtn = new Node('BendToggle');
    ui(this.bendBtn);
    this.gm.addChild(this.bendBtn);
    this.bendBtn.setPosition(0, 40, 0);
    this.bendBtn.addComponent(UITransform).setContentSize(420, 96);
    this.bendGfx = this.bendBtn.addComponent(Graphics);
    this.bendLabel = label(this.bendBtn, 'BendLabel', 34, new Color(244, 239, 228, 255));
    this.bendBtn.addComponent(Button);
    this.bendBtn.on(Button.EventType.CLICK, onToggleBend, this);
    this.setBendOn(false);
    this.gm.active = false;

    this.showCover('试试赛车', '左右滑：换道 / 路口转弯\n吃金币、躲车', '开始追捕');
    this.setStats(0, 0, 3);
    this.setHint('');
    this.setWarn('');
  }

  get gmOpen(): boolean {
    return !!this.gm?.active;
  }

  toggleGm(): void {
    this.gm.active = !this.gm.active;
  }

  setBendOn(on: boolean): void {
    this.bendLabel.string = on ? '求面视角  开' : '求面视角  关';
    this.bendLabel.color = on ? new Color(26, 35, 51, 255) : new Color(244, 239, 228, 255);
    this.bendGfx.clear();
    this.bendGfx.fillColor = on ? new Color(240, 193, 75, 255) : new Color(90, 100, 118, 255);
    this.bendGfx.roundRect(-210, -48, 420, 96, 14);
    this.bendGfx.fill();
  }

  layout(): void {
    const vis = portraitVisibleSize();
    this.root.getComponent(UITransform)?.setContentSize(vis.width, vis.height);
    this.root.getComponent(Widget)?.updateAlignment();
  }

  setStats(dist: number, coins: number, lives: number): void {
    this.dist.string = `距离 ${Math.floor(dist)}`;
    this.coins.string = `金币 ${coins}`;
    const full = Math.max(0, lives);
    this.hearts.string = '❤'.repeat(full) + '♡'.repeat(Math.max(0, 5 - full));
  }

  setHint(text: string): void {
    this.hint.string = text;
    this.hint.node.active = !!text;
  }

  setWarn(text: string): void {
    this.warn.string = text;
    this.warn.node.active = !!text;
  }

  showCover(title: string, body: string, btn: string): void {
    this.cover.active = true;
    this.coverTitle.string = title;
    this.coverBody.string = body;
    this.playBtn.node.getChildByName('PlayLabel')!.getComponent(Label)!.string = btn;
  }

  hideCover(): void {
    this.cover.active = false;
  }

  dispose(): void {
    this.root.destroy();
  }
}
