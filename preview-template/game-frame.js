/**
 * Preview frame — design 1080×1920.
 * Tall/narrow: fill the window (FIXED_WIDTH).
 * Wide: keep a 9:16 frame with side letterbox.
 */
(function () {
  var DESIGN_WIDTH = 1080;
  var DESIGN_HEIGHT = 1920;
  var gameFrame = document.getElementById('GameDiv');
  if (!gameFrame) return;

  var resizeFrameId = 0;
  var lastW = 0;
  var lastH = 0;
  var cocosScreen = null;
  var CocosSize = null;

  function parentBox() {
    var wrap = gameFrame.parentElement;
    if (wrap && wrap.clientWidth > 1 && wrap.clientHeight > 1) {
      return { w: wrap.clientWidth, h: wrap.clientHeight };
    }
    var vv = window.visualViewport;
    return {
      w: Math.max(1, (vv && vv.width) || window.innerWidth),
      h: Math.max(1, (vv && vv.height) || window.innerHeight),
    };
  }

  function calculateGameFrameSize() {
    var box = parentBox();
    var designAspect = DESIGN_WIDTH / DESIGN_HEIGHT;
    var boxAspect = box.w / Math.max(box.h, 1);
    if (boxAspect <= designAspect + 1e-3) {
      return { width: box.w, height: box.h };
    }
    return {
      width: box.h * designAspect,
      height: box.h,
    };
  }

  function applyGameFrameSize(forceEngineSync) {
    var frameSize = calculateGameFrameSize();
    if (
      !forceEngineSync &&
      frameSize.width === lastW &&
      frameSize.height === lastH
    ) {
      return;
    }
    lastW = frameSize.width;
    lastH = frameSize.height;
    gameFrame.style.setProperty('--game-frame-width', frameSize.width + 'px');
    gameFrame.style.setProperty('--game-frame-height', frameSize.height + 'px');
    if (cocosScreen && CocosSize) {
      var dpr = cocosScreen.devicePixelRatio || window.devicePixelRatio || 1;
      cocosScreen.windowSize = new CocosSize(
        frameSize.width * dpr,
        frameSize.height * dpr,
      );
    }
  }

  function scheduleResize() {
    if (resizeFrameId) return;
    resizeFrameId = requestAnimationFrame(function () {
      resizeFrameId = 0;
      applyGameFrameSize();
    });
  }

  applyGameFrameSize();
  window.addEventListener('resize', scheduleResize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleResize, {
      passive: true,
    });
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    var cc = window.cc;
    if (!cc || !cc.game || !cc.screen) {
      if (tries > 200) clearInterval(timer);
      return;
    }
    clearInterval(timer);
    cocosScreen = cc.screen;
    CocosSize = cc.Size;
    try {
      if (cc.game.config) {
        var ov = cc.game.config.overrideSettings || (cc.game.config.overrideSettings = {});
        var screenSettings = ov.screen || (ov.screen = {});
        screenSettings.exactFitScreen = false;
      }
    } catch (e) {
      // ignore
    }
    applyGameFrameSize(true);
  }, 50);
})();
