/* Updated to load Arial.ttf as default font and avoid WEBGL text calls before font ready */
const FIT_BOOST = 1.35;

let canvasParent;
let arialFont = null;
let fontLoadFailed = false;

let angleY = 0, angleX = 0;
let isDragging = false, lastMouseX = 0, lastMouseY = 0;
let zoomFactor = 1.0;

let orbitalsX = [], orbitalsY = [];

let isPlaying = false;
let currentApproach = 0;
let animationCompletedNaturally = false;
let prevIsPlaying = false;

const APPROACH_STEP = 1.5;
const POINTS_APPROACH_MULTIPLIER = 1.8;

// NOTE: Cập nhật mật độ điểm mặc định để phân bố đều hơn
let POINTS_S = 350; // Tăng từ 200 lên 350
let POINTS_P = 500; // Tăng từ 325 lên 500

let overlapType = "sigma";
let renderMode = "points";
let pointSpeedMult = 1.0;

// Base Colors
const COLOR_DEFAULT_BASE = [170, 190, 255];
const COLOR_X_BASE = [230, 120, 110];
const COLOR_Y_BASE = [120, 230, 140];
const COLOR_Z_BASE = [120, 150, 255];

const SURFACE_DETAIL_X = 64;
const SURFACE_DETAIL_Y = 40;

const SS_TARGET_OVERLAP = 0.40;
const SS_MAX_APPROACH   = 120;
const SP_TARGET_OVERLAP = 0.40;
const SP_MAX_APPROACH   = 82;
const PP_SIGMA_TARGET_OVERLAP = 0.18;
const PP_SIGMA_MAX_APPROACH   = 65;
const PP_PI_TARGET_OVERLAP = 0.22;
const PP_PI_MAX_APPROACH   = 116;
const OVERLAP_TOL = 0.03;

let overlayLabels = [];
let showAxisLabels = false;
let centerSliderValue = 0;

const ui = {};

// preload: load Arial.ttf so WEBGL text works without throwing
function preload() {
  // Try to load Arial.ttf from the same directory as index.html/sketch.js
  // If the font file is present and served, this will block until loaded.
  try {
    arialFont = loadFont('Arial.ttf', 
      () => { console.log('Arial.ttf loaded'); },
      (err) => { console.warn('Failed to load Arial.ttf (error callback):', err); arialFont = null; fontLoadFailed = true; }
    );
  } catch (e) {
    console.warn('Failed to call loadFont for Arial.ttf:', e);
    arialFont = null;
    fontLoadFailed = true;
  }
}

// Safe material call
function safeCallMaterial(funcName, ...args) {
  try {
    const fn = self[funcName];
    if (typeof fn === "function") fn(...args);
    else return false;
    return true;
  } catch (e) {
    return false;
  }
}

// setPointMaterial: Đã cập nhật để tạo cảm giác cầu 3D (Yêu cầu 1) và xử lý phát sáng (Yêu cầu 3)
function setPointMaterial(r, g, b, opts = {}) {
  // Nếu overlap, thay bằng màu VÀNG SÁNG RỰC RỠ cho hiệu ứng "Spark" (YÊU CẦU 3: Phát sáng)
  if (opts.overlap) {
    // TẮT vật liệu bóng/màu nền
    safeCallMaterial('ambientMaterial', 0, 0, 0); 
    safeCallMaterial('specularMaterial', 0, 0, 0); 
    safeCallMaterial('shininess', 0);

    // BẬT vật liệu phát sáng (Vàng sáng)
    if (safeCallMaterial('emissiveMaterial', 255, 255, 0)) return; 
    fill(255, 255, 0); // Màu dự phòng
    return;
  }

  // Normal Electron: (YÊU CẦU 2: Màu sắc chính xác & YÊU CẦU 1: Cảm giác cầu)
  const brightness = (typeof opts.brightness === 'number') ? opts.brightness : 1.0;
  const rr = Math.min(255, Math.round(r * brightness));
  const gg = Math.min(255, Math.round(g * brightness));
  const bb = Math.min(255, Math.round(b * brightness));

  // TẮT vật liệu phát sáng nếu có từ lần gọi trước
  safeCallMaterial('emissiveMaterial', 0, 0, 0); 

  // 1. Dùng Ambient/Diffuse Material để set màu nền chính xác
  if (safeCallMaterial('ambientMaterial', rr, gg, bb)) {
      // 2. Dùng Specular Material để set màu điểm sáng (trắng)
      safeCallMaterial('specularMaterial', 255, 255, 255);
      // 3. Tăng độ bóng (shininess) cho điểm sáng sắc nét (cảm giác cầu)
      shininess(100); 
      return;
  }

  // Fallback
  fill(rr, gg, bb);
}

// setSurfaceMaterial: (Material bóng bẩy hơn cho chế độ Surface)
function setSurfaceMaterial(r,g,b) {
  try {
    // Sử dụng Specular Material để tạo độ bóng (giống nhựa bóng hoặc thủy tinh mờ)
    specularMaterial(255, 255, 255); 
    
    // Tăng độ bóng (Shininess) lên cao để đốm sáng sắc nét hơn
    shininess(50); 
    
    // Thêm Alpha (độ trong suốt) = 220 để nhìn xuyên thấu một chút
    fill(r, g, b, 220); 
  } catch (e) {
    fill(r,g,b);
  }
}

// Sampling helpers

// Đã SỬA ĐỔI: Lấy mẫu đồng đều thể tích hình cầu
function sampleSpherePoints(radius, count) {
  const pts = [];
  for (let i=0;i<count;i++){
    const u=Math.random(), v=Math.random(), w=Math.random(); // Lấy thêm w cho bán kính
    const theta = 2*Math.PI*u;
    const phi = Math.acos(2*v-1);
    
    // Áp dụng thuật toán lấy mẫu thể tích: r = R * (w^(1/3))
    const r = radius * Math.cbrt(w); 
    
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    pts.push({x,y,z,_lobeSign:0});
  }
  return pts;
}

// Đã SỬA ĐỔI: Lấy mẫu đồng đều thể tích hình elip (lobe)
function sampleEllipsoidLobes(long, short, offset, axisChar, count) {
  const pts=[];
  const half=Math.floor(count/2);
  for (let sign of [1,-1]) {
    for (let i=0;i<half;i++){
      const u=Math.random(), v=Math.random(), w=Math.random(); // Lấy thêm w cho tỷ lệ
      const theta = 2*Math.PI*u;
      const phi = Math.acos(2*v-1);
      
      // Áp dụng thuật toán lấy mẫu thể tích hình elip: scale = (w^(1/3))
      const r_scale = Math.cbrt(w); 
      
      const X = (long * Math.sin(phi) * Math.cos(theta)) * r_scale; 
      const Y = (short * Math.sin(phi) * Math.sin(theta)) * r_scale; 
      const Z = (short * Math.cos(phi)) * r_scale; 
      
      let x=0,y=0,z=0;
      if (axisChar==="x") { x = X + sign*offset; y = Y; z = Z; }
      else if (axisChar==="y") { x = Y; y = X + sign*offset; z = Z; }
      else { x = Y; y = Z; z = X + sign*offset; }
      pts.push({x,y,z,_lobeSign:sign});
    }
  }
  return pts;
}

// pairOrbitals
function pairOrbitals(listA, listB) {
  const lenA=listA.length, lenB=listB.length;
  const partnersForA = new Array(lenA), partnersForB = new Array(lenB);
  if (lenA===0 || lenB===0) return {partnersForA, partnersForB};
  const minLen = Math.min(lenA, lenB);
  for (let i=0;i<minLen;i++){ partnersForA[i]=listB[i]; partnersForB[i]=listA[i]; }
  const bFirst = listB[0];
  for (let i=minLen;i<lenA;i++) partnersForA[i]=bFirst;
  const aFirst = listA[0];
  for (let j=minLen;j<lenB;j++) partnersForB[j]=aFirst;
  return {partnersForA, partnersForB};
}

// Overlap helpers
function overlapRatioOneSide(oA, oB, piMode, sampleStep, isMultiP) {
  if (!oA || !oB || !oA.points || oA.points.length===0) return 0;
  const pts = oA.points;
  let count=0, inside=0;
  const isP = (oA.type === 'p');
  const idx = oA.indexP;
  const c1 = oA.currentOffset, c2 = oB.currentOffset;
  const GLOW_MARGIN = 10;
  const clipMin = Math.min(c1,c2)+GLOW_MARGIN;
  const clipMax = Math.max(c1,c2)-GLOW_MARGIN;
  const SAFE_DISTANCE_FROM_NUCLEUS = 25;
  for (let i=0;i<pts.length;i+=sampleStep) { // Đã điều chỉnh bước nhảy i+=sampleStep
    let {x:lx,y:ly,z:lz} = pts[i];
    if (isP && piMode) {
      if (idx===0) { const tx=-ly, ty=lx; lx=tx; ly=ty; }
      else if (idx===2) { const ty=lz, tz=-ly; ly=ty; lz=tz; }
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
  return count>0 ? inside/count : 0;
}
function computeOverlapRatio(piMode, isMultiP){
  if (!orbitalsX.length || !orbitalsY.length) return 0;
  let repX = orbitalsX[0], repY = orbitalsY[0];
  const pCountX = orbitalsX.reduce((acc,o)=>acc+(o.type==='p'?1:0),0);
  const pCountY = orbitalsY.reduce((acc,o)=>acc+(o.type==='p'?1:0),0);
  const hasMultipleP = pCountX>1 && pCountY>1;
  if (piMode || hasMultipleP) {
    const pyX = orbitalsX.find(o=>o.type==='p' && o.indexP!==0);
    const pyY = orbitalsY.find(o=>o.type==='p' && o.indexP!==0);
    if (pyX && pyY) { repX=pyX; repY=pyY; }
  }
  // Tối ưu hóa: Tăng step để giảm tải tính toán trong overlapRatioOneSide
  const stepX = repX.type === "s" ? 4 : 8; // Tăng từ 2 lên 4 (s), từ 4 lên 8 (p)
  const stepY = repY.type === "s" ? 4 : 8; // Tăng từ 2 lên 4 (s), từ 4 lên 8 (p)
  const rXY = overlapRatioOneSide(repX, repY, piMode, stepX, hasMultipleP);
  const rYX = overlapRatioOneSide(repY, repX, piMode, stepY, hasMultipleP);
  return (rXY + rYX)/2;
}
function resolveOverlapConfig(piMode) {
  if (!orbitalsX.length || !orbitalsY.length) { return { target: SP_TARGET_OVERLAP, max: SP_MAX_APPROACH }; }
  const pCountX = orbitalsX.reduce((acc,o)=>acc+(o.type==='p'?1:0),0);
  const pCountY = orbitalsY.reduce((acc,o)=>acc+(o.type==='p'?1:0),0);
  if (pCountX > 1 && pCountY > 1) return { target: PP_PI_TARGET_OVERLAP, max: PP_PI_MAX_APPROACH };
  const repX = orbitalsX[0], repY = orbitalsY[0];
  const tX = repX.type, tY = repY.type;
  if (tX==="s" && tY==="s") return { target: SS_TARGET_OVERLAP, max: SS_MAX_APPROACH };
  if (tX==="p" && tY==="p") return { target: PP_SIGMA_TARGET_OVERLAP, max: PP_SIGMA_MAX_APPROACH };
  return { target: SP_TARGET_OVERLAP, max: SP_MAX_APPROACH };
}

// Canvas helpers
function getCanvasSize() {
  let parent = canvasParent || document.getElementById('canvas-container') || document.body;
  const w = (parent && parent.clientWidth) ? parent.clientWidth : (window.innerWidth || 800);
  const h = (parent && parent.clientHeight) ? parent.clientHeight : (window.innerHeight || 600);
  return { w, h };
}
function computeAxisLengthForOrbital(o) {
  if (!o) return 80;
  if (o.type==='s') return o.sRadius + 10;
  const base = o.pRadius; const long = base * o.longFactor; return Math.ceil(o.pOffset + long + 10);
}
function fitToView() {
  const sz = getCanvasSize(); const w=sz.w, h=sz.h;
  if (orbitalsX.length===0 && orbitalsY.length===0) { zoomFactor = constrain(Math.min(w,h)/600, 0.7, 3.0); return; }
  let maxExtent=0; const all = orbitalsX.concat(orbitalsY);
  for (let o of all) { const axisLen = computeAxisLengthForOrbital(o); const far=Math.abs(o.currentOffset)+axisLen; maxExtent=Math.max(maxExtent, far); }
  const sceneWorldWidth = maxExtent*2;
  if (sceneWorldWidth<=0) { zoomFactor=1.0; return; }
  const desired = (Math.min(w,h) * 0.9) / sceneWorldWidth;
  zoomFactor = constrain(desired * FIT_BOOST, 0.4, 6.0);
}

function drawAxesAt(centerX, length=80) {
  const L=length; push(); translate(centerX,0,0);
  strokeWeight(2);
  stroke(255,60,60,220); line(-L,0,0,L,0,0);
  stroke(60,255,60,220); line(0,-L,0,0,L,0);
  stroke(80,160,255,220); line(0,0,-L,0,0,L);
  pop();
}
function addAxisLabelsForCenterToOverlay(centerX, length=80, partnerX=null) {
  const cushion=6;
  let targetX = (partnerX==null) ? centerX - length - cushion : ((partnerX < centerX) ? centerX + length + cushion : centerX - length - cushion);
  overlayLabels.push({ pos:{x: targetX, y:0, z:0}, text:'X', color: COLOR_X_BASE });
  overlayLabels.push({ pos:{x: centerX, y: -length - cushion, z:0}, text:'Y', color: COLOR_Y_BASE });
  overlayLabels.push({ pos:{x: centerX, y:0, z: length + cushion}, text:'Z', color: COLOR_Z_BASE });
}
function drawOverlayLabels() {
  // Avoid drawing p5 WEBGL text unless font has been successfully loaded.
  if (!showAxisLabels) { overlayLabels=[]; return; }
  if (!arialFont) { 
    // Font not loaded — skip overlay labels to avoid WEBGL text error.
    overlayLabels=[]; 
    return; 
  }
  if (typeof text !== 'function') { overlayLabels=[]; return; }
  if (arialFont) textFont(arialFont);
  textSize(16); textAlign(CENTER, CENTER);
  for (let l of overlayLabels) {
    push(); translate(l.pos.x, l.pos.y, l.pos.z); rotateY(-angleY); rotateX(-angleX);
    noLights(); const [r,g,b]=l.color; fill(r,g,b); noStroke(); text(l.text,0,0);
    pop();
  }
  overlayLabels=[];
}

// Orbital class
class Orbital {
  constructor(side, type, indexP, baseOffset) {
    this.side = side; this.type = type; this.indexP = indexP || 0;
    this.baseOffset = baseOffset; this.currentOffset = baseOffset;
    this.sRadius = 35; this.pRadius = 42; this.pOffset = 59; this.longFactor = 1.4;
    this.visible = true;
    this.points = []; this.currentPoints = []; this.pointParams = [];
    this.canonicalAxis = (this.type==='p') ? (this.indexP===0?'x':this.indexP===1?'y':'z') : 'y';
    if (this.type==='s') this.maxRadiusSq = this.sRadius * this.sRadius;
    else { const maxDist = this.pOffset + (this.pRadius * this.longFactor); this.maxRadiusSq = (maxDist+5)*(maxDist+5); }
    this._generatePoints();
  }

  _generatePoints() {
    if (this.type==='s') this.points = sampleSpherePoints(this.sRadius, POINTS_S);
    else {
      const base = this.pRadius; const long = base * this.longFactor; const short = base * 0.9; const d = this.pOffset;
      const axis = (this.indexP===0?'x':this.indexP===1?'y':'z');
      this.points = sampleEllipsoidLobes(long, short, d, axis, POINTS_P);
    }
    this.pointParams = new Array(this.points.length);
    for (let i=0;i<this.points.length;i++){
      const p=this.points[i];
      let lobeCenter={x:0,y:0,z:0};
      if (this.type==='p') {
        const d=this.pOffset, sign=(typeof p._lobeSign!=='undefined'?p._lobeSign:1);
        if (this.indexP===0) lobeCenter={x:sign*d,y:0,z:0};
        else if (this.indexP===1) lobeCenter={x:0,y:sign*d,z:0};
        else lobeCenter={x:0,y:0,z:sign*d};
      }
      const rel={x:p.x - lobeCenter.x, y:p.y - lobeCenter.y, z:p.z - lobeCenter.z};
      const baseR = Math.sqrt(rel.x*rel.x + rel.y*rel.y + rel.z*rel.z) || 1e-6;
      
      const rotSpeed = 0.2; // Fixed speed as requested
      
      const radialJitter = random(0.0,1.2); const phase=random(0,TWO_PI);
      this.pointParams[i] = { lobeCenter, relBase:rel, baseR, rotSpeed, radialJitter, phase };
    }
  }

  applyApproach(amount) { this.currentOffset = (this.side==='X') ? (this.baseOffset + amount) : (this.baseOffset - amount); }

  applyRotation() {
    this.currentPoints=[];
    const perpMap = { x:'y', y:'z', z:'x' };
    const canonical = this.canonicalAxis || 'y';
    const perpAxis = perpMap[canonical] || 'y';
    const base = this.pRadius, long = base*this.longFactor, short = base*0.9;
    const t = frameCount;
    for (let i=0;i<this.points.length;i++){
      const params = this.pointParams[i]; const lc = params.lobeCenter;
      let rx = params.relBase.x, ry = params.relBase.y, rz = params.relBase.z;
      if (params.radialJitter) {
        const jitter = params.radialJitter * Math.sin(t*0.02 + params.phase) * 0.35;
        const len = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1e-6;
        rx += (rx/len)*jitter; ry += (ry/len)*jitter; rz += (rz/len)*jitter;
      }
      const angle = t * params.rotSpeed * pointSpeedMult + params.phase;
      const cosA=Math.cos(angle), sinA=Math.sin(angle);
      let rrx=rx, rry=ry, rrz=rz;
      if (perpAxis==='x') { rry = ry * cosA - rz * sinA; rrz = ry * sinA + rz * cosA; }
      else if (perpAxis==='y') { rrx = rx * cosA + rz * sinA; rrz = rz * cosA - rx * sinA; }
      else { rrx = rx * cosA - ry * sinA; rry = rx * sinA + ry * cosA; }
      if (this.type === 's') {
        const distSq = rrx*rrx + rry*rry + rrz*rrz; const rMaxSq = this.sRadius * this.sRadius;
        if (distSq > rMaxSq) { const scale = Math.sqrt(rMaxSq / distSq); rrx *= scale; rry *= scale; rrz *= scale; }
      } else {
        let X=rrx,Y=rry,Z=rrz; let val;
        if (this.canonicalAxis==='x') val=(X*X)/(long*long)+(Y*Y)/(short*short)+(Z*Z)/(short*short);
        else if (this.canonicalAxis==='y') val=(Y*Y)/(long*long)+(X*X)/(short*short)+(Z*Z)/(short*short);
        else val=(Z*Z)/(long*long)+(X*X)/(short*short)+(Y*Y)/(short*short);
        if (val>1.0) { const scale = 1.0/Math.sqrt(val); rrx*=scale; rry*=scale; rrz*=scale; }
      }
      this.currentPoints.push({ x: lc.x + rrx, y: lc.y + rry, z: lc.z + rrz });
    }
  }

  containsPointWorld(gx, gy, gz, piMode=false) {
    const dx = gx - this.currentOffset, dy = gy, dz = gz;
    const distSq = dx*dx + dy*dy + dz*dz;
    if (distSq > this.maxRadiusSq) return false;
    if (this.type === 's') return distSq <= (this.sRadius * this.sRadius);
    let lx = dx, ly = dy, lz = dz;
    if (piMode) {
      if (this.indexP===0) { const tx=-ly, ty=lx; lx=tx; ly=ty; }
      else if (this.indexP===2) { const ty=lz, tz=-ly; ly=ty; lz=tz; }
    }
    const base=this.pRadius, long=base*this.longFactor, short=base*0.9, d=this.pOffset;
    const longSqInv = 1/(long*long), shortSqInv = 1/(short*short);
    let axis;
    if (!piMode) axis = (this.indexP===1) ? 'y' : (this.indexP===2 ? 'z' : 'x'); else axis='x';
    const checkLobe = (sign)=> {
      let X,Y,Z;
      if (axis==='x') { X = lx - sign*d; Y=ly; Z=lz; }
      else if (axis==='y') { X = ly - sign*d; Y = lx; Z = lz; }
      else { X = lz - sign*d; Y = lx; Z = ly; }
      return (X*X)*longSqInv + (Y*Y)*shortSqInv + (Z*Z)*shortSqInv <= 1;
    };
    return checkLobe(1) || checkLobe(-1);
  }

  draw(partnerOrbital, piMode=false, isMultiP=false, defaultBaseColor=[200,200,255], defaultGlowColor=[255,255,200], groupIndex=0, groupCount=1) {
    if (!this.visible) return;
    this.applyRotation();
    push(); translate(this.currentOffset,0,0);
    const isP = (this.type==='p'); const idx = this.indexP;
    let myBase = defaultBaseColor;
    if (groupCount>1) { const palette=[COLOR_X_BASE,COLOR_Y_BASE,COLOR_Z_BASE]; myBase=palette[groupIndex%palette.length]; }
    else if (isMultiP && isP) { if (idx===0) myBase=COLOR_X_BASE; else if (idx===1) myBase=COLOR_Y_BASE; else myBase=COLOR_Z_BASE; }
    const [br,bg,bb] = myBase;

    const POINT_SPHERE_RADIUS = 1.4;
    // Tăng chi tiết để tạo hình cầu mặt trơn hơn
    const SPHERE_DETAIL_X = 24; 
    const SPHERE_DETAIL_Y = 16;

    let shrinkScale=1.0, isShrinkTarget=false;
    if (isMultiP && isP && idx===0 && partnerOrbital) {
      const dist = Math.abs(this.currentOffset - partnerOrbital.currentOffset);
      const shrinkStart = 150, shrinkEnd=60;
      if (dist < shrinkStart) { shrinkScale = map(dist, shrinkStart, shrinkEnd, 1.0, 0.3, true); isShrinkTarget = true; }
    }

    let clipMin=-99999, clipMax=99999;
    let center1=this.currentOffset, center2=99999;
    const GLOW_MARGIN=10, SAFE_DISTANCE_FROM_NUCLEUS=25;
    if (partnerOrbital) { center2 = partnerOrbital.currentOffset; clipMin = Math.min(center1,center2) + GLOW_MARGIN; clipMax = Math.max(center1,center2) - GLOW_MARGIN; }

    for (let i=0;i<this.currentPoints.length;i++){
      const p = this.currentPoints[i];
      let lx = p.x, ly = p.y, lz = p.z;
      if (isShrinkTarget) { if (this.side==='X' && lx>0) lx *= shrinkScale; else if (this.side==='Y' && lx<0) lx *= shrinkScale; }
      if (isP && piMode) { if (idx===0) { const tx=-ly, ty=lx; lx=tx; ly=ty; } else if (idx===2) { const ty=lz, tz=-ly; ly=ty; lz=tz; } }
      const gx = this.currentOffset + lx;
      
      let isOverlapHere = false;
      if (partnerOrbital && partnerOrbital.containsPointWorld(gx, ly, lz, piMode)) {
        if (gx > clipMin && gx < clipMax) {
          let isSafe = true;
          if (groupCount > 1) {
            const d1 = Math.abs(gx - center1), d2 = Math.abs(gx - center2);
            if (d1 < SAFE_DISTANCE_FROM_NUCLEUS || d2 < SAFE_DISTANCE_FROM_NUCLEUS) isSafe = false;
          }
          if (isSafe) isOverlapHere = true;
        }
      }

      push();
      translate(lx, ly, lz);
      noStroke();

      if (isOverlapHere) {
        // --- OVERLAP: PURE BRIGHT YELLOW SPARK (Glow) ---
        setPointMaterial(255, 255, 255, { overlap: true }); 
      } else {
        // --- NORMAL: MATCHES SURFACE COLOR (Correct color + 3D look) ---
        setPointMaterial(br, bg, bb, { brightness: 1.0, overlap: false });
      }
      
      sphere(POINT_SPHERE_RADIUS, SPHERE_DETAIL_X, SPHERE_DETAIL_Y);
      pop();
    }

    pop();
  }

  drawSurface(partnerOrbital, piMode=false, isMultiP=false, defaultBaseColor=[200,200,255], defaultGlowColor=[255,255,200], groupIndex=0, groupCount=1) {
    if (!this.visible) return;
    push(); translate(this.currentOffset,0,0);
    const isP = (this.type==='p'); const idx = this.indexP;
    let myBase = defaultBaseColor;
    if (groupCount>1) { const palette=[COLOR_X_BASE,COLOR_Y_BASE,COLOR_Z_BASE]; myBase = palette[groupIndex%palette.length]; }
    else if (isMultiP && isP) { if (idx===0) myBase=COLOR_X_BASE; else if (idx===1) myBase=COLOR_Y_BASE; else myBase=COLOR_Z_BASE; }
    const [br,bg,bb] = myBase;
    setSurfaceMaterial(br,bg,bb);
    noStroke();
    let shrinkScale=1.0, doShrink=false;
    if (isMultiP && isP && idx===0 && partnerOrbital) {
      const dist = Math.abs(this.currentOffset - partnerOrbital.currentOffset);
      const shrinkStart=150, shrinkEnd=60;
      if (dist < shrinkStart) { shrinkScale = map(dist, shrinkStart, shrinkEnd, 1.0, 0.35, true); doShrink=true; }
    }
    if (this.type==='s') sphere(this.sRadius, SURFACE_DETAIL_X, SURFACE_DETAIL_Y);
    else {
      const base = this.pRadius, long = base * this.longFactor, short = base * 0.9, d = this.pOffset;
      for (let sign of [1,-1]) {
        push();
        let localD=d, localLong=long;
        if (doShrink) { const facing = (this.side==='X' && sign===1) || (this.side==='Y' && sign===-1); if (facing) { localD = d*shrinkScale; localLong = long*shrinkScale; } }
        if (!piMode) {
          if (idx===0) translate(sign * localD, 0, 0);
          else if (idx===1) { translate(0, sign*localD, 0); rotateZ(HALF_PI); }
          else { translate(0, 0, sign*localD); rotateY(HALF_PI); }
        } else {
          if (idx===0) { rotateZ(HALF_PI); translate(sign * localD, 0, 0); }
          else if (idx===1) { translate(0, sign*localD, 0); rotateZ(HALF_PI); }
          else { rotateX(HALF_PI); translate(sign * localD, 0, 0); }
        }
        ellipsoid(localLong, short, short, SURFACE_DETAIL_X, SURFACE_DETAIL_Y);
        pop();
      }
    }
    pop();
  }
}

// UI helpers
function refreshInfo(container, list) {
  if (!container) return;
  container.innerHTML = "";
  if (list.length === 0) { container.textContent = "Chưa có orbital."; return; }
  list.forEach(o=>{
    const span = document.createElement("span");
    span.textContent = `${o.type}${o.type==="p"?o.indexP+1:""}`;
    span.classList.add(`type-${o.type}`);
    span.style.cursor = "pointer";
    span.classList.toggle("hidden-orbital", !o.visible);
    span.title = "Nhấn để bật/tắt hiển thị orbital";
    span.addEventListener("click", ()=>{ o.visible = !o.visible; span.classList.toggle("hidden-orbital", !o.visible); });
    container.appendChild(span);
  });
}
function countTypes(list) { let s=0,p=0; list.forEach(o=>{ if (o.type==='s') s++; if (o.type==='p') p++; }); return { sCount: s, pCount: p }; }

// Modified: decide base offset magnitude by global X-Y center policy for p-p & pi only
function addOrbital(side,type) {
  const list = side==="X"?orbitalsX:orbitalsY;
  const { sCount, pCount } = countTypes(list);
  if (type==='s' && sCount>=1) return;
  if (type==='p' && pCount>=3) return;
  let indexP = 0; if (type==='p') indexP = pCount % 3;
  // Use default magnitude (150) on creation; we'll recompute offsets globally after adding
  const defaultMag = 150;
  const baseOffset = side==="X" ? -defaultMag - centerSliderValue : defaultMag + centerSliderValue;
  list.push(new Orbital(side, type, indexP, baseOffset));
  // Recompute base offsets for all orbitals so p-p π case is handled immediately if present
  applyCenterSliderBaseOffsets();
  fitToView();
}
function updatePlayButton(btn) { if (!btn) return; btn.disabled = !(orbitalsX.length>0 && orbitalsY.length>0); }
function updateOrbitalButtons(btnS, btnP, list) { if (!btnS||!btnP) return; const { sCount, pCount } = countTypes(list); btnS.disabled = sCount>=1; btnS.classList.toggle("disabled", btnS.disabled); btnP.disabled = pCount>=3; btnP.classList.toggle("disabled", btnP.disabled); }
function enableOrbitalButtons(btnS, btnP) { if (!btnS||!btnP) return; btnS.disabled=false; btnP.disabled=false; btnS.classList.remove("disabled"); btnP.classList.remove("disabled"); }
function updatePiButtonState(piBtn, sigmaBtn) { if (!piBtn) return; const repX=orbitalsX[0]||null, repY=orbitalsY[0]||null; const pCountX=orbitalsX.reduce((a,o)=>a+(o.type==='p'?1:0),0), pCountY=orbitalsY.reduce((a,o)=>a+(o.type==='p'?1:0),0); const isMultiP = (pCountX>1 && pCountY>1); let ok = repX && repY && repX.type==='p' && repY.type==='p'; if (isMultiP) ok=false; if (ok) { piBtn.disabled=false; piBtn.classList.remove("disabled"); } else { piBtn.disabled=true; piBtn.classList.remove("active"); piBtn.classList.add("disabled"); overlapType="sigma"; if (sigmaBtn) sigmaBtn.classList.add("active"); } }
function hasAnyPOrbitalsBothSides() { return orbitalsX.some(o=>o.type==='p') && orbitalsY.some(o=>o.type==='p'); }

// Modified: apply center offsets so that when overlapType==='pi' AND both sides have at least one p, two centers X and Y move closer by 6px more (relative previous change)
function applyCenterSliderBaseOffsets() { 
  const bothHaveP = orbitalsX.some(o=>o.type==='p') && orbitalsY.some(o=>o.type==='p');
  // ONLY compact centers when we're in p-p & pi mode
  const compactCentersForPPPi = (overlapType === 'pi' && bothHaveP);
  // previous compact center was 100 (after earlier change). Move them 6px closer -> 94
  const centerMag = compactCentersForPPPi ? 94 : 150; // 94 when compact (6px closer than 100), else default 150
  for (let o of orbitalsX) { 
    o.baseOffset = -centerMag - centerSliderValue; 
    o.applyApproach(currentApproach); 
  } 
  for (let o of orbitalsY) { 
    o.baseOffset = centerMag + centerSliderValue; 
    o.applyApproach(currentApproach); 
  } 
}

function lockUiDuringAnimation() { if (ui.addOrbitalXsBtn) { ui.addOrbitalXsBtn.disabled=true; ui.addOrbitalXsBtn.classList.add("disabled"); } if (ui.addOrbitalXpBtn) { ui.addOrbitalXpBtn.disabled=true; ui.addOrbitalXpBtn.classList.add("disabled"); } if (ui.addOrbitalYsBtn) { ui.addOrbitalYsBtn.disabled=true; ui.addOrbitalYsBtn.classList.add("disabled"); } if (ui.addOrbitalYpBtn) { ui.addOrbitalYpBtn.disabled=true; ui.addOrbitalYpBtn.classList.add("disabled"); } if (ui.centerSlider) ui.centerSlider.disabled=true; if (ui.piBtn) { ui.piBtn.disabled=true; ui.piBtn.classList.add("disabled"); ui.piBtn.classList.remove("active"); } }
function unlockUiAfterAnimationEnd() { animationCompletedNaturally=true; unlockAllUi(); if (ui.playBtn) ui.playBtn.textContent="Play"; }
function unlockAllUi() { if (ui.addOrbitalXsBtn && ui.addOrbitalXpBtn) updateOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn, orbitalsX); if (ui.addOrbitalYsBtn && ui.addOrbitalYpBtn) updateOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn, orbitalsY); if (ui.addOrbitalXsBtn) ui.addOrbitalXsBtn.classList.toggle("disabled", ui.addOrbitalXsBtn.disabled); if (ui.addOrbitalXpBtn) ui.addOrbitalXpBtn.classList.toggle("disabled", ui.addOrbitalXpBtn.disabled); if (ui.addOrbitalYsBtn) ui.addOrbitalYsBtn.classList.toggle("disabled", ui.addOrbitalYsBtn.disabled); if (ui.addOrbitalYpBtn) ui.addOrbitalYpBtn.classList.toggle("disabled", ui.addOrbitalYpBtn.disabled); updatePiButtonState(ui.piBtn, ui.sigmaBtn); if (ui.centerSlider) { ui.centerSlider.disabled = !animationCompletedNaturally; if (ui.centerSliderValue) ui.centerSliderValue.textContent = String(centerSliderValue||0); } }

// New: update point counts and regenerate existing orbitals' points
function updatePointCounts(newS, newP) {
  const s = parseInt(newS, 10);
  const p = parseInt(newP, 10);
  if (!isNaN(s) && s>=10) POINTS_S = Math.min(5000, s);
  if (!isNaN(p) && p>=10) POINTS_P = Math.min(5000, p);
  // Regenerate points for existing orbitals
  for (let o of orbitalsX) { try { o._generatePoints(); } catch(e){/* ignore */} }
  for (let o of orbitalsY) { try { o._generatePoints(); } catch(e){/* ignore */} }
  fitToView();
}

// Input handlers (attach to p5)
function isPointerOverCanvas(event) { if (!event || !event.target) return false; const canvasEl=document.querySelector('#canvas-container canvas'); if (!canvasEl) return false; const rect=canvasEl.getBoundingClientRect(); const x=event.clientX, y=event.clientY; return x>=rect.left && x<=rect.right && y>=rect.top && y<=rect.bottom; }
function mouseWheelHandler(event) { if (!isPointerOverCanvas(event)) return true; const delta=event.delta; zoomFactor += -delta * 0.0025; zoomFactor = constrain(zoomFactor, 0.2, 6.0); return false; }
function mousePressedHandler(event) { if (!isPointerOverCanvas(event)) { isDragging=false; return; } isDragging=true; lastMouseX=mouseX; lastMouseY=mouseY; }
function mouseReleasedHandler() { isDragging=false; }
function mouseDraggedHandler(event) { if (!isDragging) return; if (!isPointerOverCanvas(event)) return; const dx = mouseX - lastMouseX, dy = mouseY - lastMouseY; angleY += dx * 0.01; angleX -= dy * 0.01; lastMouseX = mouseX; lastMouseY = mouseY; }
try { window.mousePressed = mousePressedHandler; window.mouseReleased = mouseReleasedHandler; window.mouseDragged = mouseDraggedHandler; window.mouseWheel = mouseWheelHandler; } catch (e) { /* ignore */ }

// p5 lifecycle
function setup() {
  canvasParent = document.getElementById("canvas-container") || document.body;
  const sz = getCanvasSize(); const w=sz.w, h=sz.h;
  const c = createCanvas(w,h, WEBGL); if (c && canvasParent && c.parent) c.parent(canvasParent);
  perspective(PI/3.2, w/h, 0.1, 20000);

  // Ensure we set the p5 font if it was loaded in preload
  if (arialFont) {
    try { textFont(arialFont); } catch (e) { console.warn('Failed to set loaded font via textFont:', e); }
  } else {
    if (fontLoadFailed) {
      console.warn('Arial.ttf failed to load in preload. WEBGL text drawing will be disabled.');
    } else {
      // In typical usage preload will have loaded the font. If not yet available, we skip setting font here.
      console.log('Arial.ttf not available at setup time; labels will be skipped until font is loaded.');
    }
  }

  p5Ready = true;
  if (arialFont) textFont(arialFont);
  initUI();
  fitToView();
}
function windowResized() { const sz=getCanvasSize(); const w=sz.w, h=sz.h; if (typeof resizeCanvas==='function' && p5Ready) { resizeCanvas(w,h); perspective(PI/3.2, w/h, 0.1, 20000); } fitToView(); }

function draw() {
  if (!p5Ready) return;
  const canvasEl = document.querySelector('#canvas-container canvas'); if (!canvasEl) return;
  try {
    background(6);
    // camera transforms
    scale(zoomFactor);
    rotateX(angleX);
    rotateY(angleY);

    const baseSigma = COLOR_DEFAULT_BASE, basePi = [255,220,150];
    const baseColor = overlapType === "sigma" ? baseSigma : basePi;
    const glowColor = [255, 230, 140];

    // --- CẬP NHẬT: HỆ THỐNG ÁNH SÁNG MỚI ---
    if (renderMode === "surface") {
      // Giảm ánh sáng môi trường để tăng độ sâu của bóng tối
      ambientLight(60, 60, 60);

      // Đèn chính (Key Light) mạnh, màu trắng để tạo điểm phản chiếu (Highlight) rõ ràng
      directionalLight(255, 255, 255, 0.5, 0.5, -1);

      // --- NGUỒN SÁNG ĐIỂM XOAY (Dynamic Point Light) ---
      const lightRadius = 350; // Bán kính quỹ đạo
      const lightSpeed = 0.02; // Tốc độ xoay
      // Tính toán vị trí X và Z dựa trên góc xoay
      const lightX = lightRadius * cos(frameCount * lightSpeed);
      const lightZ = lightRadius * sin(frameCount * lightSpeed); 
      
      // Ánh sáng điểm màu trắng sáng, quét ngang qua các orbital
      pointLight(180, 180, 180, lightX, 0, lightZ);

    } else {
      // Chế độ Points: Ánh sáng mạnh hơn để tạo highlight/shadow rõ rệt (Hỗ trợ cảm giác cầu 3D)
      ambientLight(100, 100, 100); 
      directionalLight(150, 150, 150, 0.5, -0.5, -1);
    }

    const piMode = (overlapType === "pi" && hasAnyPOrbitalsBothSides());
    const cfg = resolveOverlapConfig(piMode);
    const targetOverlap = cfg.target, maxApproach = cfg.max;

    const pCountX = orbitalsX.reduce((a,o)=>a+(o.type==='p'?1:0),0);
    const pCountY = orbitalsY.reduce((a,o)=>a+(o.type==='p'?1:0),0);
    const isMultiP = (pCountX>1 && pCountY>1);

    // animation approach
    if (isPlaying) {
      animationCompletedNaturally = false;
      const step = (renderMode === "points") ? (APPROACH_STEP * POINTS_APPROACH_MULTIPLIER) : APPROACH_STEP;
      currentApproach += step;
      if (currentApproach > maxApproach) { currentApproach = maxApproach; isPlaying = false; animationCompletedNaturally = true; }
      orbitalsX.forEach(o=>o.applyApproach(currentApproach));
      orbitalsY.forEach(o=>o.applyApproach(currentApproach));
      if (orbitalsX.length && orbitalsY.length) {
        let ratio = computeOverlapRatio(piMode, isMultiP);
        if (ratio >= targetOverlap - OVERLAP_TOL) { isPlaying=false; animationCompletedNaturally=true; }
      }
    } else {
      orbitalsX.forEach(o=>o.applyApproach(currentApproach));
      orbitalsY.forEach(o=>o.applyApproach(currentApproach));
    }

    if (prevIsPlaying && !isPlaying) {
      if (animationCompletedNaturally) unlockUiAfterAnimationEnd();
      else if (ui.playBtn) ui.playBtn.textContent = isPlaying ? "Stop" : "Play";
    }
    prevIsPlaying = isPlaying;

    const repX = orbitalsX[0]||null, repY = orbitalsY[0]||null;
    if (repX) drawAxesAt(repX.currentOffset, computeAxisLengthForOrbital(repX));
    if (repY) drawAxesAt(repY.currentOffset, computeAxisLengthForOrbital(repY));
    if (repX) addAxisLabelsForCenterToOverlay(repX.currentOffset, computeAxisLengthForOrbital(repX), repY?repY.currentOffset:null);
    if (repY) addAxisLabelsForCenterToOverlay(repY.currentOffset, computeAxisLengthForOrbital(repY), repX?repX.currentOffset:null);

    const { partnersForA: partnersX, partnersForB: partnersY } = pairOrbitals(orbitalsX, orbitalsY);
    const grpCountX = orbitalsX.length, grpCountY = orbitalsY.length;

    for (let i=0;i<orbitalsX.length;i++){
      const o = orbitalsX[i]; const partner = partnersX[i] || null;
      if (renderMode === "points") o.draw(partner, piMode, isMultiP, baseColor, glowColor, i, grpCountX);
      else o.drawSurface(partner, piMode, isMultiP, baseColor, glowColor, i, grpCountX);
    }
    for (let j=0;j<orbitalsY.length;j++){
      const o = orbitalsY[j]; const partner = partnersY[j] || null;
      if (renderMode === "points") o.draw(partner, piMode, isMultiP, baseColor, glowColor, j, grpCountY);
      else o.drawSurface(partner, piMode, isMultiP, baseColor, glowColor, j, grpCountY);
    }

    drawOverlayLabels();
  } catch (err) {
    let msg;
    try { msg = (err && err.stack) ? err.stack : JSON.stringify(err); } catch (e) { msg = String(err); }
    console.error('rendering error:', err, '\n', msg);
    // Only draw overlay text if we have a loaded font (WEBGL requirement)
    try { 
      if (arialFont) {
        push(); resetMatrix(); translate(-width/2, -height/2); noLights(); fill(220,80,80); noStroke(); textSize(13); textAlign(LEFT, TOP); if (arialFont) textFont(arialFont); const shortMsg = (typeof msg==='string' && msg.length>400) ? msg.slice(0,400)+'…' : msg; text('Rendering error (see console):\n' + shortMsg, 8,8); pop();
      } else {
        // Can't draw text in WEBGL without a loaded p5.Font; skip overlay text.
      }
    } catch(e2){ console.error('overlay failed', e2); }
  }
}

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
  ui.pointSpeedSlider = document.getElementById("pointSpeedSlider");
  ui.pointSpeedValue = document.getElementById("pointSpeedValue");

  // New UI elements for point counts
  ui.pointsSInput = document.getElementById("pointsSInput");
  ui.pointsPInput = document.getElementById("pointsPInput");
  ui.pointsSValue = document.getElementById("pointsSValue");
  ui.pointsPValue = document.getElementById("pointsPValue");

  // Initialize displays from current variables
  if (ui.pointsSInput) ui.pointsSInput.value = POINTS_S;
  if (ui.pointsPInput) ui.pointsPInput.value = POINTS_P;
  if (ui.pointsSValue) ui.pointsSValue.textContent = String(POINTS_S);
  if (ui.pointsPValue) ui.pointsPValue.textContent = String(POINTS_P);

  if (ui.addOrbitalXsBtn) ui.addOrbitalXsBtn.addEventListener("click", ()=>{ addOrbital("X","s"); refreshInfo(ui.infoX, orbitalsX); updatePlayButton(ui.playBtn); updateOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn, orbitalsX); updatePiButtonState(ui.piBtn, ui.sigmaBtn); fitToView(); });
  if (ui.addOrbitalXpBtn) ui.addOrbitalXpBtn.addEventListener("click", ()=>{ addOrbital("X","p"); refreshInfo(ui.infoX, orbitalsX); updatePlayButton(ui.playBtn); updateOrbitalButtons(ui.addOrbitalXsBtn, ui.addOrbitalXpBtn, orbitalsX); updatePiButtonState(ui.piBtn, ui.sigmaBtn); fitToView(); });
  if (ui.addOrbitalYsBtn) ui.addOrbitalYsBtn.addEventListener("click", ()=>{ addOrbital("Y","s"); refreshInfo(ui.infoY, orbitalsY); updatePlayButton(ui.playBtn); updateOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn, orbitalsY); updatePiButtonState(ui.piBtn, ui.sigmaBtn); fitToView(); });
  if (ui.addOrbitalYpBtn) ui.addOrbitalYpBtn.addEventListener("click", ()=>{ addOrbital("Y","p"); refreshInfo(ui.infoY, orbitalsY); updatePlayButton(ui.playBtn); updateOrbitalButtons(ui.addOrbitalYsBtn, ui.addOrbitalYpBtn, orbitalsY); updatePiButtonState(ui.piBtn, ui.sigmaBtn); fitToView(); });

  if (ui.playBtn) ui.playBtn.addEventListener("click", ()=>{
    if (isPlaying) { isPlaying=false; ui.playBtn.textContent="Play"; }
    else {
      if (orbitalsX.length===0 || orbitalsY.length===0) return;
      isPlaying=true; ui.playBtn.textContent="Stop";
      lockUiDuringAnimation();
    }
  });

  if (ui.resetBtn) ui.resetBtn.addEventListener("click", ()=>{
    isPlaying=false; animationCompletedNaturally=false;
    currentApproach=0; centerSliderValue=0;
    if (ui.centerSlider) { ui.centerSlider.value=0; ui.centerSlider.disabled=false; }
    if (ui.centerSliderValue) ui.centerSliderValue.textContent="0";
    if (ui.playBtn) { ui.playBtn.textContent="Play"; updatePlayButton(ui.playBtn); }
    orbitalsX=[]; orbitalsY=[];
    refreshInfo(ui.infoX, orbitalsX); refreshInfo(ui.infoY, orbitalsY);
    unlockAllUi();
    zoomFactor=1.0; angleY=0; angleX=0; fitToView();
  });

  if (ui.sigmaBtn) ui.sigmaBtn.addEventListener("click", ()=>{
    overlapType="sigma"; ui.sigmaBtn.classList.add("active"); if (ui.piBtn) ui.piBtn.classList.remove("active");
    // recompute offsets because we may have been in compact p-p π mode before
    applyCenterSliderBaseOffsets();
    fitToView();
  });
  if (ui.piBtn) ui.piBtn.addEventListener("click", ()=>{
    if (ui.piBtn.classList.contains("disabled")) return;
    overlapType="pi"; ui.piBtn.classList.add("active"); if (ui.sigmaBtn) ui.sigmaBtn.classList.remove("active");
    // recompute offsets so that p-p π case uses compact spacing
    applyCenterSliderBaseOffsets();
    fitToView();
  });

  if (ui.modePointsBtn) ui.modePointsBtn.addEventListener("click", ()=>{ renderMode="points"; ui.modePointsBtn.classList.add("active"); if (ui.modeSurfaceBtn) ui.modeSurfaceBtn.classList.remove("active"); });
  if (ui.modeSurfaceBtn) ui.modeSurfaceBtn.addEventListener("click", ()=>{ renderMode="surface"; ui.modeSurfaceBtn.classList.add("active"); if (ui.modePointsBtn) ui.modePointsBtn.classList.remove("active"); });

  if (ui.axisToggleBtn) ui.axisToggleBtn.addEventListener("click", ()=>{ showAxisLabels = !showAxisLabels; ui.axisToggleBtn.textContent = showAxisLabels ? "Tắt nhãn trục" : "Bật nhãn trục"; });
  
  if (ui.centerSlider) ui.centerSlider.addEventListener("input", (e)=>{ centerSliderValue = parseInt(e.target.value,10); if (ui.centerSliderValue) ui.centerSliderValue.textContent=centerSliderValue; applyCenterSliderBaseOffsets(); });

  if (ui.pointSpeedSlider) ui.pointSpeedSlider.addEventListener("input", (e)=>{ pointSpeedMult = parseFloat(e.target.value); if (ui.pointSpeedValue) ui.pointSpeedValue.textContent=pointSpeedMult.toFixed(1)+"x"; });

  // Listeners for new point-count inputs
  if (ui.pointsSInput) {
    ui.pointsSInput.addEventListener("input", (e) => {
      const val = Math.max(10, Math.min(5000, parseInt(e.target.value, 10) || 10));
      if (ui.pointsSValue) ui.pointsSValue.textContent = String(val);
      updatePointCounts(val, POINTS_P);
    });
  }
  if (ui.pointsPInput) {
    ui.pointsPInput.addEventListener("input", (e) => {
      const val = Math.max(10, Math.min(5000, parseInt(e.target.value, 10) || 10));
      if (ui.pointsPValue) ui.pointsPValue.textContent = String(val);
      updatePointCounts(POINTS_S, val);
    });
  }
}