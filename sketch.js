const FIT_BOOST = 1.35;

let canvasParent;
let arialFont;

let angleY = 0;
let angleX = 0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let zoomFactor = 1.0;

let orbitalsX = [];
let orbitalsY = [];

let isPlaying = false;
let currentApproach = 0;
let animationCompletedNaturally = false;
let prevIsPlaying = false;
const APPROACH_STEP = 1.5;
const POINTS_APPROACH_MULTIPLIER = 1.8; // faster in "points" mode

const POINTS_S = 400;
const POINTS_P = 650;

let overlapType = "sigma"; // 'sigma' or 'pi'
let renderMode = "points"; // 'points' or 'surface'

const SS_TARGET_OVERLAP = 0.40;
const SS_MAX_APPROACH   = 120;
const SP_TARGET_OVERLAP = 0.40;
const SP_MAX_APPROACH   = 82;
const PP_SIGMA_TARGET_OVERLAP = 0.18;
const PP_SIGMA_MAX_APPROACH   = 65;
const PP_PI_TARGET_OVERLAP = 0.22;
const PP_PI_MAX_APPROACH   = 116;
const OVERLAP_TOL = 0.03;

const COLOR_DEFAULT_BASE = [170, 190, 255];
const COLOR_DEFAULT_GLOW = [255, 230, 140];

const COLOR_X_BASE = [230, 120, 110];
const COLOR_X_GLOW = [255, 140, 120];

const COLOR_Y_BASE = [120, 230, 140];
const COLOR_Y_GLOW = [140, 255, 140];

const COLOR_Z_BASE = [120, 150, 255];
const COLOR_Z_GLOW = [140, 160, 255];

const SURFACE_DETAIL_X = 64;
const SURFACE_DETAIL_Y = 40;

// Overlay labels array (world positions)
let overlayLabels = [];
let showAxisLabels = false; // default OFF

// slider offset
let centerSliderValue = 0;

// UI references holder
const ui = {};

// Flag that marks that we created the canvas and p5 renderer is ready
let p5Ready = false;

// ---------- Preload ----------
function preload() {
  try {
    arialFont = loadFont('Arial.ttf');
  } catch (e) {
    console.warn('Arial preload error (ignored):', e);
    arialFont = null;
  }
}

// ---------- Material helper ----------
function setSurfaceMaterial(r, g, b) {
  if (typeof diffuseMaterial === "function") {
    diffuseMaterial(r, g, b);
  } else {
    ambientMaterial(r, g, b);
    if (typeof specularMaterial === "function") {
      specularMaterial(Math.min(255, Math.round(r * 0.08)), Math.min(255, Math.round(g * 0.08)), Math.min(255, Math.round(b * 0.08)));
      shininess(4);
    }
  }
}

// ---------- Sampling helpers ----------
function sampleSpherePoints(radius, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = radius * Math.cos(phi);
    pts.push({ x, y, z });
  }
  return pts;
}

function sampleEllipsoidLobes(long, short, offset, axisChar, count) {
  const pts = [];
  const half = Math.floor(count / 2);
  for (let sign of [1, -1]) {
    for (let i = 0; i < half; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const X = long * Math.sin(phi) * Math.cos(theta);
      const Y = short * Math.sin(phi) * Math.sin(theta);
      const Z = short * Math.cos(phi);
      let x = 0, y = 0, z = 0;
      if (axisChar === "x") {
        x = X + sign * offset; y = Y; z = Z;
      } else if (axisChar === "y") {
        x = Y; y = X + sign * offset; z = Z;
      } else {
        x = Y; y = Z; z = X + sign * offset;
      }
      pts.push({ x, y, z });
    }
  }
  return pts;
}

// ---------- Orbital class ----------
class Orbital {
  constructor(side, type, indexP, baseOffset) {
    this.side = side;
    this.type = type;
    this.indexP = indexP || 0;
    this.baseOffset = baseOffset;
    this.currentOffset = baseOffset;

    this.sRadius = 35;
    this.pRadius = 42;
    // Reduced pOffset so the two p-lobes sit closer to the nucleus center
    this.pOffset = 59;
    this.longFactor = 1.4;

    this.visible = true; // per-orbital toggle

    if (this.type === 's') this.maxRadiusSq = this.sRadius * this.sRadius;
    else {
      const maxDist = this.pOffset + (this.pRadius * this.longFactor);
      this.maxRadiusSq = (maxDist + 5) * (maxDist + 5);
    }

    this.points = [];
    this._generatePoints();
  }

  _generatePoints() {
    if (this.type === "s") {
      this.points = sampleSpherePoints(this.sRadius, POINTS_S);
    } else {
      const base = this.pRadius;
      const long = base * this.longFactor;
      const short = base * 0.9;
      const d = this.pOffset;
      let axis = "x";
      if (this.indexP === 1) axis = "y";
      if (this.indexP === 2) axis = "z";
      this.points = sampleEllipsoidLobes(long, short, d, axis, POINTS_P);
    }
  }

  applyApproach(amount) {
    if (this.side === "X") this.currentOffset = this.baseOffset + amount;
    else this.currentOffset = this.baseOffset - amount;
  }

  containsPointWorld(gx, gy, gz, piMode = false) {
    const dx = gx - this.currentOffset;
    const dy = gy;
    const dz = gz;
    const distSq = dx*dx + dy*dy + dz*dz;

    if (distSq > this.maxRadiusSq) return false;

    let lx = dx, ly = dy, lz = dz;
    if (this.type === "s") return distSq <= (this.sRadius * this.sRadius);

    if (piMode) {
      if (this.indexP === 0) { const tx = -ly; const ty = lx; lx = tx; ly = ty; }
      else if (this.indexP === 2) { const ty = lz; const tz = -ly; ly = ty; lz = tz; }
    }

    const base = this.pRadius;
    const long = base * this.longFactor;
    const short = base * 0.9;
    const d = this.pOffset;
    const longSqInv = 1 / (long * long);
    const shortSqInv = 1 / (short * short);

    let axis;
    if (!piMode) axis = (this.indexP === 1) ? "y" : (this.indexP === 2 ? "z" : "x");
    else axis = "x";

    const checkLobe = (sign) => {
      let X, Y, Z;
      if (axis === "x") { X = lx - sign * d; Y = ly; Z = lz; }
      else if (axis === "y") { X = ly - sign * d; Y = lx; Z = lz; }
      else { X = lz - sign * d; Y = lx; Z = ly; }
      return (X*X)*longSqInv + (Y*Y)*shortSqInv + (Z*Z)*shortSqInv <= 1;
    };

    return checkLobe(1) || checkLobe(-1);
  }

  draw(partnerOrbital, piMode=false, isMultiP=false, defaultBaseColor=[200,200,255], defaultGlowColor=[255,255,200], groupIndex=0, groupCount=1) {
    if (!this.visible) return;

    push();
    translate(this.currentOffset, 0, 0);

    const isP = (this.type === "p");
    const idx = this.indexP;

    let myBase = defaultBaseColor, myGlow = defaultGlowColor;
    if (groupCount > 1) {
      const palette = [COLOR_X_BASE, COLOR_Y_BASE, COLOR_Z_BASE];
      const glowPalette = [COLOR_X_GLOW, COLOR_Y_GLOW, COLOR_Z_GLOW];
      myBase = palette[groupIndex % palette.length];
      myGlow = glowPalette[groupIndex % palette.length];
    } else if (isMultiP && isP) {
      if (idx === 0) { myBase = COLOR_X_BASE; myGlow = COLOR_X_GLOW; }
      else if (idx === 1) { myBase = COLOR_Y_BASE; myGlow = COLOR_Y_GLOW; }
      else { myBase = COLOR_Z_BASE; myGlow = COLOR_Z_GLOW; }
    }

    const [br,bg,bb] = myBase;
    const [gr,gg,gb] = myGlow;

    strokeWeight(3);

    let shrinkScale = 1.0;
    let isShrinkTarget = false;
    if (isMultiP && isP && idx === 0 && partnerOrbital) {
      const dist = Math.abs(this.currentOffset - partnerOrbital.currentOffset);
      const shrinkStart = 150, shrinkEnd = 60;
      if (dist < shrinkStart) { shrinkScale = map(dist, shrinkStart, shrinkEnd, 1.0, 0.3, true); isShrinkTarget = true; }
    }

    let clipMin = -99999, clipMax = 99999;
    let center1 = this.currentOffset, center2 = 99999;
    const GLOW_MARGIN = 10, SAFE_DISTANCE_FROM_NUCLEUS = 25;
    if (partnerOrbital) { center2 = partnerOrbital.currentOffset; clipMin = Math.min(center1, center2) + GLOW_MARGIN; clipMax = Math.max(center1, center2) - GLOW_MARGIN; }

    const isBlinkOn = (frameCount % 2 === 0);

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      let lx = p.x, ly = p.y, lz = p.z;

      if (isShrinkTarget) {
        if (this.side === 'X' && lx > 0) lx *= shrinkScale;
        else if (this.side === 'Y' && lx < 0) lx *= shrinkScale;
      }

      if (isP && piMode) {
        if (idx === 0) { const tx = -ly; const ty = lx; lx = tx; ly = ty; }
        else if (idx === 2) { const ty = lz; const tz = -ly; ly = ty; lz = tz; }
      }

      const gx = this.currentOffset + lx;
      let rCol = br, gCol = bg, bCol = bb, aCol = 120;
      if (partnerOrbital && partnerOrbital.containsPointWorld(gx, ly, lz, piMode)) {
        if (gx > clipMin && gx < clipMax) {
          let isSafe = true;
          if (groupCount > 1) {
            const d1 = Math.abs(gx - center1), d2 = Math.abs(gx - center2);
            if (d1 < SAFE_DISTANCE_FROM_NUCLEUS || d2 < SAFE_DISTANCE_FROM_NUCLEUS) isSafe = false;
          }
          if (isSafe) {
            if (isBlinkOn) { rCol = gr; gCol = gg; bCol = gb; aCol = 200; }
            else { rCol = br; gCol = bg; bCol = bb; aCol = 120; }
          }
        }
      }
      stroke(rCol, gCol, bCol, aCol);
      point(lx, ly, lz);
    }

    pop();
  }

  drawSurface(partnerOrbital, piMode=false, isMultiP=false, defaultBaseColor=[200,200,255], defaultGlowColor=[255,255,200], groupIndex=0, groupCount=1) {
    if (!this.visible) return;

    push();
    translate(this.currentOffset, 0, 0);

    const isP = (this.type === "p");
    const idx = this.indexP;

    let myBase = defaultBaseColor;
    if (groupCount > 1) {
      const palette = [COLOR_X_BASE, COLOR_Y_BASE, COLOR_Z_BASE];
      myBase = palette[groupIndex % palette.length];
    } else if (isMultiP && isP) {
      if (idx === 0) myBase = COLOR_X_BASE;
      else if (idx === 1) myBase = COLOR_Y_BASE;
      else myBase = COLOR_Z_BASE;
    }
    const [br, bg, bb] = myBase;

    setSurfaceMaterial(br, bg, bb);
    noStroke();

    let shrinkScale = 1.0;
    let doShrink = false;
    if (isMultiP && isP && idx === 0 && partnerOrbital) {
      const dist = Math.abs(this.currentOffset - partnerOrbital.currentOffset);
      const shrinkStart = 150, shrinkEnd = 60;
      if (dist < shrinkStart) { shrinkScale = map(dist, shrinkStart, shrinkEnd, 1.0, 0.35, true); doShrink = true; }
    }

    if (this.type === "s") {
      sphere(this.sRadius, SURFACE_DETAIL_X, SURFACE_DETAIL_Y);
    } else {
      const base = this.pRadius;
      const long = base * this.longFactor;
      const short = base * 0.9;
      const d = this.pOffset;

      for (let sign of [1, -1]) {
        push();
        let localD = d;
        let localLong = long;
        if (doShrink) {
          const facing = (this.side === 'X' && sign === 1) || (this.side === 'Y' && sign === -1);
          if (facing) { localD = d * shrinkScale; localLong = long * shrinkScale; }
        }

        if (!piMode) {
          if (idx === 0) translate(sign * localD, 0, 0);
          else if (idx === 1) { translate(0, sign * localD, 0); rotateZ(HALF_PI); }
          else { translate(0, 0, sign * localD); rotateY(HALF_PI); }
        } else {
          if (idx === 0) { rotateZ(HALF_PI); translate(sign * localD, 0, 0); }
          else if (idx === 1) { translate(0, sign * localD, 0); rotateZ(HALF_PI); }
          else { rotateX(HALF_PI); translate(sign * localD, 0, 0); }
        }

        ellipsoid(localLong, short, short, SURFACE_DETAIL_X, SURFACE_DETAIL_Y);
        pop();
      }
    }

    pop();
  }
}

// ---------- Overlap helpers ----------
function overlapRatioOneSide(oA, oB, piMode, sampleStep, isMultiP) {
  if (!oA || !oB || !oA.points || oA.points.length === 0) return 0;
  const pts = oA.points;
  let count = 0, inside = 0;
  const isP = (oA.type === "p");
  const idx = oA.indexP;
  const c1 = oA.currentOffset, c2 = oB.currentOffset;
  const GLOW_MARGIN = 10;
  const clipMin = Math.min(c1, c2) + GLOW_MARGIN;
  const clipMax = Math.max(c1, c2) - GLOW_MARGIN;
  const SAFE_DISTANCE_FROM_NUCLEUS = 25;

  for (let i = 0; i < pts.length; i += sampleStep) {
    let { x: lx, y: ly, z: lz } = pts[i];
    if (isP && piMode) {
      if (idx === 0) { const tx = -ly; const ty = lx; lx = tx; ly = ty; }
      else if (idx === 2) { const ty = lz; const tz = -ly; ly = ty; lz = tz; }
    }
    const gx = oA.currentOffset + lx;
    count++;
    if (gx > clipMin && gx < clipMax) {
      let isSafe = true;
      if (isMultiP) {
        const d1 = Math.abs(gx - c1), d2 = Math.abs(gx - c2);
        if (d1 < SAFE_DISTANCE_FROM_NUCLEUS || d2 < SAFE_DISTANCE_FROM_NUCLEUS) isSafe = false;
      }
      if (isSafe) { if (oB.containsPointWorld(gx, ly, lz, piMode)) inside++; }
    }
  }
  return count > 0 ? inside / count : 0;
}

function computeOverlapRatio(piMode, isMultiP) {
  if (!orbitalsX.length || !orbitalsY.length) return 0;
  let repX = orbitalsX[0], repY = orbitalsY[0];

  const pCountX = orbitalsX.reduce((acc, o) => acc + (o.type === 'p' ? 1 : 0), 0);
  const pCountY = orbitalsY.reduce((acc, o) => acc + (o.type === 'p' ? 1 : 0), 0);
  const hasMultipleP = pCountX > 1 && pCountY > 1;

  if (piMode || hasMultipleP) {
    const pyX = orbitalsX.find(o => o.type === 'p' && o.indexP !== 0);
    const pyY = orbitalsY.find(o => o.type === 'p' && o.indexP !== 0);
    if (pyX && pyY) { repX = pyX; repY = pyY; }
  }

  const stepX = repX.type === "s" ? 2 : 4;
  const stepY = repY.type === "s" ? 2 : 4;

  const rXY = overlapRatioOneSide(repX, repY, piMode, stepX, isMultiP);
  const rYX = overlapRatioOneSide(repY, repX, piMode, stepY, isMultiP);
  return (rXY + rYX) / 2;
}

function resolveOverlapConfig(piMode) {
  if (!orbitalsX.length || !orbitalsY.length) {
    return { target: SP_TARGET_OVERLAP, max: SP_MAX_APPROACH };
  }

  const pCountX = orbitalsX.reduce((acc, o) => acc + (o.type === 'p' ? 1 : 0), 0);
  const pCountY = orbitalsY.reduce((acc, o) => acc + (o.type === 'p' ? 1 : 0), 0);

  if (pCountX > 1 && pCountY > 1) {
    return { target: PP_PI_TARGET_OVERLAP, max: PP_PI_MAX_APPROACH };
  }

  const repX = orbitalsX[0];
  const repY = orbitalsY[0];
  const tX = repX.type;
  const tY = repY.type;

  if (piMode) {
    if (tX === "p" && tY === "p") {
      return { target: PP_PI_TARGET_OVERLAP, max: PP_PI_MAX_APPROACH };
    }
  }

  if (tX === "s" && tY === "s") return { target: SS_TARGET_OVERLAP, max: SS_MAX_APPROACH };
  if (tX === "p" && tY === "p") return { target: PP_SIGMA_TARGET_OVERLAP, max: PP_SIGMA_MAX_APPROACH };
  return { target: SP_TARGET_OVERLAP, max: SP_MAX_APPROACH };
}

// ---------- Safe canvas size ----------
function getCanvasSize() {
  let parent = canvasParent;
  if (!parent) {
    parent = document.getElementById('canvas-container') || document.body;
  }
  const w = (parent && parent.clientWidth) ? parent.clientWidth : (typeof windowWidth !== 'undefined' ? windowWidth : (window.innerWidth || 800));
  const h = (parent && parent.clientHeight) ? parent.clientHeight : (typeof windowHeight !== 'undefined' ? windowHeight : (window.innerHeight || 600));
  return { w, h };
}

// ---------- Fit to view ----------
function fitToView() {
  const sz = getCanvasSize();
  const w = sz.w, h = sz.h;

  if (orbitalsX.length === 0 && orbitalsY.length === 0) {
    zoomFactor = constrain(Math.min(w, h) / 600, 0.7, 3.0);
    return;
  }

  let maxExtent = 0;
  const all = orbitalsX.concat(orbitalsY);
  for (let o of all) {
    const axisLen = computeAxisLengthForOrbital(o);
    const far = Math.abs(o.currentOffset) + axisLen;
    maxExtent = Math.max(maxExtent, far);
  }

  const targetScreenCoverage = 0.9;
  const sceneWorldWidth = maxExtent * 2;
  if (sceneWorldWidth <= 0) {
    zoomFactor = 1.0;
    return;
  }
  const desired = (Math.min(w, h) * targetScreenCoverage) / sceneWorldWidth;
  zoomFactor = constrain(desired * FIT_BOOST, 0.4, 6.0);
}

// ---------- Misc helpers ----------
function computeAxisLengthForOrbital(o) {
  if (!o) return 80;
  if (o.type === 's') return o.sRadius + 10;
  const base = o.pRadius; const long = base * o.longFactor; return Math.ceil(o.pOffset + long + 10);
}

function drawAxesAt(centerX, length = 80) {
  const L = length;
  push();
  translate(centerX, 0, 0);
  strokeWeight(2);
  stroke(255, 60, 60, 220); line(-L, 0, 0, L, 0, 0);
  stroke(60, 255, 60, 220); line(0, -L, 0, 0, L, 0);
  stroke(80, 160, 255, 220); line(0, 0, -L, 0, 0, L);
  pop();
}

function pairOrbitals(listA, listB) {
  const lenA = listA.length, lenB = listB.length;
  const partnersForA = new Array(lenA), partnersForB = new Array(lenB);
  if (lenA === 0 || lenB === 0) return { partnersForA, partnersForB };
  const minLen = Math.min(lenA, lenB);
  for (let i = 0; i < minLen; i++) { partnersForA[i] = listB[i]; partnersForB[i] = listA[i]; }
  const bFirst = listB[0];
  for (let i = minLen; i < lenA; i++) partnersForA[i] = bFirst;
  const aFirst = listA[0];
  for (let j = minLen; j < lenB; j++) partnersForB[j] = aFirst;
  return { partnersForA, partnersForB };
}

function addAxisLabelsForCenterToOverlay(centerX, length = 80, axisGroupPartnerX = null) {
  const cushion = 6;
  let targetX;
  if (axisGroupPartnerX == null) targetX = centerX - length - cushion;
  else {
    if (axisGroupPartnerX < centerX) targetX = centerX + length + cushion;
    else targetX = centerX - length - cushion;
  }
  overlayLabels.push({ pos: { x: targetX, y: 0, z: 0 }, text: 'X', color: COLOR_X_BASE });
  overlayLabels.push({ pos: { x: centerX, y: -length - cushion, z: 0 }, text: 'Y', color: COLOR_Y_BASE });
  overlayLabels.push({ pos: { x: centerX, y: 0, z: length + cushion }, text: 'Z', color: COLOR_Z_BASE });
}

function drawOverlayLabels() {
  if (!showAxisLabels) { overlayLabels = []; return; }
  if (typeof text !== 'function') { overlayLabels = []; return; } // guard
  if (arialFont) textFont(arialFont);
  textSize(16);
  textAlign(CENTER, CENTER);

  for (let l of overlayLabels) {
    push();
    translate(l.pos.x, l.pos.y, l.pos.z);
    rotateY(-angleY);
    rotateX(-angleX);
    translate(0, 0, 0.5);
    noLights();
    const [r, g, b] = l.color;
    fill(r, g, b);
    noStroke();
    text(l.text, 0, 0);
    pop();
  }

  overlayLabels = [];
}

// ---------- p5 lifecycle ----------
function setup() {
  // assign canvasParent early
  canvasParent = document.getElementById("canvas-container") || document.body;
  const sz = getCanvasSize();
  const w = sz.w, h = sz.h;

  const c = createCanvas(w, h, WEBGL);
  c.parent(canvasParent);
  perspective(PI / 3.2, w / h, 0.1, 20000);

  // mark renderer ready after creating canvas
  p5Ready = true;

  if (arialFont) textFont(arialFont);

  initUI();
  fitToView();
}

function windowResized() {
  const sz = getCanvasSize();
  const w = sz.w, h = sz.h;
  if (typeof resizeCanvas === 'function' && p5Ready) {
    resizeCanvas(w, h);
    perspective(PI / 3.2, w / h, 0.1, 20000);
  }
  fitToView();
}

function draw() {
  // Avoid running draw until we are sure canvas/renderer exists.
  if (!p5Ready) return;

  // Defensive guard: ensure canvas element exists
  const canvasEl = document.querySelector('#canvas-container canvas');
  if (!canvasEl) return;

  try {
    background(6);

    if (renderMode === "surface") {
      ambientLight(40);
      directionalLight(120, 115, 110, 0.4, -0.4, -1);
      pointLight(70, 80, 100, 0, -300, 400);
      pointLight(70, 60, 60, 300, 150, 250);
      pointLight(60, 80, 60, -300, 150, 250);
    } else {
      ambientLight(30);
      directionalLight(110, 110, 100, 0.3, -0.4, -1);
      pointLight(90, 100, 120, 0, -300, 400);
      pointLight(110, 90, 90, 300, 150, 250);
      pointLight(80, 110, 85, -300, 150, 250);
    }

    scale(zoomFactor);
    rotateX(angleX);
    rotateY(angleY);

    let piMode = false;
    if (overlapType === "pi" && hasAnyPOrbitalsBothSides()) piMode = true;

    const cfg = resolveOverlapConfig(piMode);
    const targetOverlap = cfg.target;
    const maxApproach   = cfg.max;

    const pCountX = orbitalsX.reduce((acc,o)=>acc+(o.type==='p'?1:0),0);
    const pCountY = orbitalsY.reduce((acc,o)=>acc+(o.type==='p'?1:0),0);
    const isMultiP = (pCountX > 1 && pCountY > 1);

    // approach progression: faster in points mode
    if (isPlaying) {
      animationCompletedNaturally = false;
      const step = (renderMode === "points") ? (APPROACH_STEP * POINTS_APPROACH_MULTIPLIER) : APPROACH_STEP;
      currentApproach += step;
      if (currentApproach > maxApproach) { currentApproach = maxApproach; isPlaying = false; animationCompletedNaturally = true; }
      orbitalsX.forEach(o => o.applyApproach(currentApproach));
      orbitalsY.forEach(o => o.applyApproach(currentApproach));
      if (orbitalsX.length && orbitalsY.length) {
        let ratio = computeOverlapRatio(piMode, isMultiP);
        if (ratio >= targetOverlap - OVERLAP_TOL) { isPlaying = false; animationCompletedNaturally = true; }
      }
    } else {
      orbitalsX.forEach(o => o.applyApproach(currentApproach));
      orbitalsY.forEach(o => o.applyApproach(currentApproach));
    }

    // unlock UI only when playing -> not playing transition and natural finish
    if (prevIsPlaying && !isPlaying) {
      if (animationCompletedNaturally) {
        unlockUiAfterAnimationEnd();
      } else {
        if (ui.playBtn) ui.playBtn.textContent = isPlaying ? "Stop" : "Play";
      }
    }
    prevIsPlaying = isPlaying;

    const baseSigma = COLOR_DEFAULT_BASE;
    const basePi    = [255, 220, 150];
    const baseColor = overlapType === "sigma" ? baseSigma : basePi;
    const glowColor = COLOR_DEFAULT_GLOW;

    const repX = orbitalsX[0] || null;
    const repY = orbitalsY[0] || null;
    if (repX) drawAxesAt(repX.currentOffset, computeAxisLengthForOrbital(repX));
    if (repY) drawAxesAt(repY.currentOffset, computeAxisLengthForOrbital(repY));

    if (repX) {
      const partnerXcenter = repY ? repY.currentOffset : null;
      addAxisLabelsForCenterToOverlay(repX.currentOffset, computeAxisLengthForOrbital(repX), partnerXcenter);
    }
    if (repY) {
      const partnerYcenter = repX ? repX.currentOffset : null;
      addAxisLabelsForCenterToOverlay(repY.currentOffset, computeAxisLengthForOrbital(repY), partnerYcenter);
    }

    const { partnersForA: partnersX, partnersForB: partnersY } = pairOrbitals(orbitalsX, orbitalsY);

    const grpCountX = orbitalsX.length;
    const grpCountY = orbitalsY.length;

    for (let i = 0; i < orbitalsX.length; i++) {
      const o = orbitalsX[i];
      const partner = partnersX[i] || null;
      if (renderMode === "points") o.draw(partner, piMode, isMultiP, baseColor, glowColor, i, grpCountX);
      else o.drawSurface(partner, piMode, isMultiP, baseColor, glowColor, i, grpCountX);
    }

    for (let j = 0; j < orbitalsY.length; j++) {
      const o = orbitalsY[j];
      const partner = partnersY[j] || null;
      if (renderMode === "points") o.draw(partner, piMode, isMultiP, baseColor, glowColor, j, grpCountY);
      else o.drawSurface(partner, piMode, isMultiP, baseColor, glowColor, j, grpCountY);
    }

    drawOverlayLabels();
  } catch (err) {
    // log once to avoid spamming
    if (!window.__p5_draw_error_logged) {
      console.warn('rendering error (caught):', err);
      window.__p5_draw_error_logged = true;
    }
  }
}

// ---------- UI & helpers ----------
function initUI() {
  ui.addOrbitalXsBtn = document.getElementById("addOrbitalXs");
  ui.addOrbitalXpBtn = document.getElementById("addOrbitalXp");
  ui.addOrbitalYsBtn = document.getElementById("addOrbitalYs");
  ui.addOrbitalYpBtn = document.getElementById("addOrbitalYp");
  ui.infoX = document.getElementById("infoX");
  ui.infoY = document.getElementById("infoY");
  ui.playBtn = document.getElementById("playBtn");
  ui.resetBtn = document.getElementById("resetBtn");
  ui.sigmaBtn = document.getElementById("sigmaBtn");
  ui.piBtn = document.getElementById("piBtn");
  ui.modePointsBtn = document.getElementById("modePointsBtn");
  ui.modeSurfaceBtn = document.getElementById("modeSurfaceBtn");
  ui.axisToggleBtn = document.getElementById("axisToggleBtn");
  ui.centerSlider = document.getElementById("centerSlider");
  ui.centerSliderValue = document.getElementById("centerSliderValue");

  // sidebar resizer behavior (unchanged)
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('resizer');
  if (sidebar && resizer) {
    let isResizingSidebar = false;
    resizer.addEventListener('mousedown', (e) => {
      isResizingSidebar = true;
      sidebar.classList.add('resizing');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizingSidebar) return;
      let newWidth = e.clientX;
      newWidth = Math.max(220, Math.min(500, newWidth));
      sidebar.style.width = newWidth + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (isResizingSidebar) {
        isResizingSidebar = false;
        sidebar.classList.remove('resizing');
        windowResized();
      }
    });
  }

  // add orbital buttons (unchanged)
  if (ui.addOrbitalXsBtn) ui.addOrbitalXsBtn.addEventListener("click", () => {
    addOrbital("X","s");
    applyCenterSliderBaseOffsets();
    refreshInfo(ui.infoX, orbitalsX);
    updateOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn, orbitalsX);
    updatePlayButton(ui.playBtn);
    updatePiButtonState(ui.piBtn, ui.sigmaBtn);
    fitToView();
  });
  if (ui.addOrbitalXpBtn) ui.addOrbitalXpBtn.addEventListener("click", () => {
    addOrbital("X","p");
    applyCenterSliderBaseOffsets();
    refreshInfo(ui.infoX, orbitalsX);
    updateOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn, orbitalsX);
    updatePlayButton(ui.playBtn);
    updatePiButtonState(ui.piBtn, ui.sigmaBtn);
    fitToView();
  });
  if (ui.addOrbitalYsBtn) ui.addOrbitalYsBtn.addEventListener("click", () => {
    addOrbital("Y","s");
    applyCenterSliderBaseOffsets();
    refreshInfo(ui.infoY, orbitalsY);
    updateOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn, orbitalsY);
    updatePlayButton(ui.playBtn);
    updatePiButtonState(ui.piBtn, ui.sigmaBtn);
    fitToView();
  });
  if (ui.addOrbitalYpBtn) ui.addOrbitalYpBtn.addEventListener("click", () => {
    addOrbital("Y","p");
    applyCenterSliderBaseOffsets();
    refreshInfo(ui.infoY, orbitalsY);
    updateOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn, orbitalsY);
    updatePlayButton(ui.playBtn);
    updatePiButtonState(ui.piBtn, ui.sigmaBtn);
    fitToView();
  });

  if (ui.sigmaBtn) ui.sigmaBtn.addEventListener("click", () => { overlapType = "sigma"; ui.sigmaBtn.classList.add("active"); if (ui.piBtn) ui.piBtn.classList.remove("active"); });
  if (ui.piBtn) ui.piBtn.addEventListener("click", () => { if (ui.piBtn.classList.contains("disabled")) return; overlapType = "pi"; ui.piBtn.classList.add("active"); if (ui.sigmaBtn) ui.sigmaBtn.classList.remove("active"); angleX = 0.0; angleY = 0.0; });

  if (ui.playBtn) ui.playBtn.addEventListener("click", () => {
    if (ui.playBtn.disabled) return;
    isPlaying = !isPlaying;
    ui.playBtn.textContent = isPlaying ? "Stop" : "Play";
    if (isPlaying) {
      lockUiDuringAnimation();
      animationCompletedNaturally = false;
    }
  });

  if (ui.resetBtn) ui.resetBtn.addEventListener("click", () => {
    orbitalsX = []; orbitalsY = []; isPlaying = false; currentApproach = 0; angleX = 0; angleY = 0; zoomFactor = 1.0;
    if (ui.infoX) ui.infoX.textContent = "Chưa có orbital.";
    if (ui.infoY) ui.infoY.textContent = "Chưa có orbital.";
    if (ui.playBtn) { ui.playBtn.textContent = "Play"; ui.playBtn.disabled = true; }
    overlapType = "sigma";
    if (ui.sigmaBtn) ui.sigmaBtn.classList.add("active");
    if (ui.piBtn) ui.piBtn.classList.remove("active");
    enableOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn);
    enableOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn);
    updatePiButtonState(ui.piBtn, ui.sigmaBtn);
    renderMode = "points";
    if (ui.modePointsBtn && ui.modeSurfaceBtn) { ui.modePointsBtn.classList.add("active"); ui.modeSurfaceBtn.classList.remove("active"); }
    centerSliderValue = 0;
    if (ui.centerSlider) { ui.centerSlider.value = "0"; if (ui.centerSliderValue) ui.centerSliderValue.textContent = "0"; ui.centerSlider.disabled = false; }
    animationCompletedNaturally = false;
    showAxisLabels = false;
    if (ui.axisToggleBtn) ui.axisToggleBtn.classList.remove("active");
    unlockAllUi();
    fitToView();
  });

  if (ui.modePointsBtn && ui.modeSurfaceBtn) {
    ui.modePointsBtn.addEventListener("click", () => { renderMode = "points"; ui.modePointsBtn.classList.add("active"); ui.modeSurfaceBtn.classList.remove("active"); });
    ui.modeSurfaceBtn.addEventListener("click", () => { renderMode = "surface"; ui.modeSurfaceBtn.classList.add("active"); ui.modePointsBtn.classList.remove("active"); });
  }

  if (ui.axisToggleBtn) {
    ui.axisToggleBtn.classList.toggle("active", showAxisLabels);
    ui.axisToggleBtn.addEventListener("click", () => {
      showAxisLabels = !showAxisLabels;
      ui.axisToggleBtn.classList.toggle("active", showAxisLabels);
    });
  }

  if (ui.centerSlider) {
    ui.centerSlider.disabled = !animationCompletedNaturally;
    if (ui.centerSliderValue) ui.centerSliderValue.textContent = String(centerSliderValue || 0);
    ui.centerSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      if (ui.centerSliderValue) ui.centerSliderValue.textContent = String(val);
      if (!animationCompletedNaturally || isPlaying) return;
      centerSliderValue = val;
      applyCenterSliderBaseOffsets();
      fitToView();
    });
  }

  refreshInfo(ui.infoX, orbitalsX);
  refreshInfo(ui.infoY, orbitalsY);
  updatePlayButton(ui.playBtn);
  updateOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn, orbitalsX);
  updateOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn, orbitalsY);
  updatePiButtonState(ui.piBtn, ui.sigmaBtn);
  fitToView();
}

function refreshInfo(container, list) {
  if (!container) return;
  container.innerHTML = "";
  if (list.length === 0) { container.textContent = "Chưa có orbital."; return; }

  list.forEach((o, idx) => {
    const span = document.createElement("span");
    span.textContent = `${o.type}${o.type === "p" ? o.indexP + 1 : ""}`;
    span.classList.add(`type-${o.type}`);
    span.style.cursor = "pointer";
    span.classList.toggle("hidden-orbital", !o.visible);
    span.title = "Nhấn để bật/tắt hiển thị orbital";
    span.addEventListener("click", () => {
      o.visible = !o.visible;
      span.classList.toggle("hidden-orbital", !o.visible);
    });
    container.appendChild(span);
  });
}

function countTypes(list) {
  let s=0,p=0;
  list.forEach(o=>{ if(o.type==='s') s++; if(o.type==='p') p++; });
  return { sCount: s, pCount: p };
}

function addOrbital(side,type) {
  const list = side === "X" ? orbitalsX : orbitalsY;
  const { sCount, pCount } = countTypes(list);
  if (type==='s' && sCount>=1) return;
  if (type==='p' && pCount>=3) return;
  let indexP = 0; if (type==='p') indexP = pCount % 3;
  const baseOffset = side === "X" ? -150 - centerSliderValue : 150 + centerSliderValue;
  list.push(new Orbital(side, type, indexP, baseOffset));
}

function updatePlayButton(btn) {
  if (!btn) return;
  const hasX = orbitalsX.length>0;
  const hasY = orbitalsY.length>0;
  btn.disabled = !(hasX && hasY);
}

function updateOrbitalButtons(btnS, btnP, list) {
  if (!btnS || !btnP) return;
  const { sCount, pCount } = countTypes(list);
  btnS.disabled = sCount>=1;
  btnS.classList.toggle("disabled", btnS.disabled);
  btnP.disabled = pCount>=3;
  btnP.classList.toggle("disabled", btnP.disabled);
}

function enableOrbitalButtons(btnS, btnP) {
  if (!btnS || !btnP) return;
  btnS.disabled=false; btnP.disabled=false;
  btnS.classList.remove("disabled"); btnP.classList.remove("disabled");
}

function updatePiButtonState(piBtn, sigmaBtn) {
  if (!piBtn) return;
  const repX = orbitalsX[0] || null;
  const repY = orbitalsY[0] || null;

  const pCountX = orbitalsX.reduce((acc, o) => acc + (o.type === 'p' ? 1 : 0), 0);
  const pCountY = orbitalsY.reduce((acc, o) => acc + (o.type === 'p' ? 1 : 0), 0);
  const isMultiP = (pCountX > 1 && pCountY > 1);

  let ok = repX && repY && repX.type === "p" && repY.type === "p";
  if (isMultiP) ok = false;

  if (ok) {
    piBtn.disabled = false;
    piBtn.classList.remove("disabled");
  } else {
    piBtn.disabled = true;
    piBtn.classList.remove("active");
    piBtn.classList.add("disabled");
    overlapType = "sigma";
    if (sigmaBtn) sigmaBtn.classList.add("active");
  }
}

function hasAnyPOrbitalsBothSides() {
  return orbitalsX.some(o=>o.type==='p') && orbitalsY.some(o=>o.type==='p');
}

function applyCenterSliderBaseOffsets() {
  for (let o of orbitalsX) {
    o.baseOffset = -150 - centerSliderValue;
    o.applyApproach(currentApproach);
  }
  for (let o of orbitalsY) {
    o.baseOffset = 150 + centerSliderValue;
    o.applyApproach(currentApproach);
  }
}

function lockUiDuringAnimation() {
  if (ui.addOrbitalXsBtn) { ui.addOrbitalXsBtn.disabled = true; ui.addOrbitalXsBtn.classList.add("disabled"); }
  if (ui.addOrbitalXpBtn) { ui.addOrbitalXpBtn.disabled = true; ui.addOrbitalXpBtn.classList.add("disabled"); }
  if (ui.addOrbitalYsBtn) { ui.addOrbitalYsBtn.disabled = true; ui.addOrbitalYsBtn.classList.add("disabled"); }
  if (ui.addOrbitalYpBtn) { ui.addOrbitalYpBtn.disabled = true; ui.addOrbitalYpBtn.classList.add("disabled"); }
  if (ui.centerSlider) ui.centerSlider.disabled = true;
  if (ui.piBtn) { ui.piBtn.disabled = true; ui.piBtn.classList.add("disabled"); ui.piBtn.classList.remove("active"); }
}

function unlockUiAfterAnimationEnd() {
  animationCompletedNaturally = true;
  unlockAllUi();
  if (ui.playBtn) ui.playBtn.textContent = "Play";
}

function unlockAllUi() {
  if (ui.addOrbitalXsBtn && ui.addOrbitalXpBtn) updateOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn, orbitalsX);
  if (ui.addOrbitalYsBtn && ui.addOrbitalYpBtn) updateOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn, orbitalsY);

  if (ui.addOrbitalXsBtn) ui.addOrbitalXsBtn.classList.toggle("disabled", ui.addOrbitalXsBtn.disabled);
  if (ui.addOrbitalXpBtn) ui.addOrbitalXpBtn.classList.toggle("disabled", ui.addOrbitalXpBtn.disabled);
  if (ui.addOrbitalYsBtn) ui.addOrbitalYsBtn.classList.toggle("disabled", ui.addOrbitalYsBtn.disabled);
  if (ui.addOrbitalYpBtn) ui.addOrbitalYpBtn.classList.toggle("disabled", ui.addOrbitalYpBtn.disabled);

  updatePiButtonState(ui.piBtn, ui.sigmaBtn);

  if (ui.centerSlider) {
    ui.centerSlider.disabled = !animationCompletedNaturally;
    if (ui.centerSliderValue) ui.centerSliderValue.textContent = String(centerSliderValue || 0);
  }
}

// ---------- Input handlers ----------
function mouseWheel(event) {
  if (!isPointerOverCanvas(event)) return true;
  const delta = event.delta;
  zoomFactor += -delta * 0.0025;
  zoomFactor = constrain(zoomFactor, 0.2, 6.0);
  return false;
}

function isPointerOverCanvas(event) {
  if (!event || !event.target) return false;
  const canvasEl = document.querySelector('#canvas-container canvas');
  if (!canvasEl) return false;
  const rect = canvasEl.getBoundingClientRect();
  const x = event.clientX, y = event.clientY;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function mousePressed(event) {
  if (!isPointerOverCanvas(event)) { isDragging=false; return; }
  isDragging=true; lastMouseX=mouseX; lastMouseY=mouseY;
}

function mouseReleased() { isDragging=false; }
function mouseDragged(event) {
  if (!isDragging) return;
  if (!isPointerOverCanvas(event)) return;
  const dx = mouseX - lastMouseX; const dy = mouseY - lastMouseY;
  angleY += dx*0.01; angleX -= dy*0.01;
  lastMouseX = mouseX; lastMouseY = mouseY;
}