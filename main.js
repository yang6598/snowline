import * as THREE from 'three';

/* =========================================================
   雪线 · Snowline
   第三人称极简剪影滑雪
   —— 黄昏下滑，滑过之处开出光的花
   ========================================================= */

// ===================== 基础 =====================
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const FOG_NEAR = 210, FOG_FAR = 950;
scene.fog = new THREE.Fog(0x8a6a7a, FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 4000);
camera.position.set(-11, 6, 0);

// ===================== 世界参数 =====================
const LANE_HALF = 15;       // 雪道半宽
const X_START = -700;
const X_END = 6400;
const DIST_FULL = 2600;     // 天色走到极光所需距离

function terrainY(x) {
  return Math.sin(x * 0.0105) * 13.5
       + Math.sin(x * 0.0267 + 1.7) * 6.2
       + Math.sin(x * 0.0612 + 0.4) * 2.3
       + Math.sin(x * 0.173) * 0.62;
}
function terrainSlope(x) {
  return Math.cos(x * 0.0105) * 13.5 * 0.0105
       + Math.cos(x * 0.0267 + 1.7) * 6.2 * 0.0267
       + Math.cos(x * 0.0612 + 0.4) * 2.3 * 0.0612
       + Math.cos(x * 0.173) * 0.62 * 0.173;
}
// 雪道横向微翘（U 形槽）
function bank(z) {
  const t = Math.min(1, Math.abs(z) / LANE_HALF);
  return t * t * 1.05;
}
// 峡谷壁高度场
function canyonY(x, z) {
  const az = Math.abs(z);
  if (az <= LANE_HALF) return terrainY(x) + bank(z);
  const d = az - LANE_HALF;
  const t = Math.min(1, d / 26);
  const peak = 6.2 + Math.sin(x * 0.021 + 1.3) * 2.6 + Math.sin(x * 0.0087) * 2.0;
  return terrainY(x) + bank(LANE_HALF) + Math.pow(t, 0.85) * peak + Math.sin(x * 0.06 + az) * 0.5 * t;
}

// ===================== 程序化贴图 =====================
function glowTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,248,228,0.72)');
  g.addColorStop(0.6, 'rgba(255,216,155,0.16)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();

// ===================== 天空穹顶 =====================
const skyUniforms = {
  uTop: { value: new THREE.Color(0x3d3560) },
  uMid: { value: new THREE.Color(0x7a5270) },
  uBot: { value: new THREE.Color(0xe8a07a) },
  uNight: { value: 0 },
  uAurora: { value: 0 },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.52, 0.085, 0.85).normalize() },
  uMoonDir: { value: new THREE.Vector3(0.48, 0.56, 0.68).normalize() },
};

const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 40, 28),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uBot;
      uniform vec3 uSunDir, uMoonDir;
      uniform float uNight, uAurora, uTime;

      float band(vec3 d) {
        float t = uTime * 0.11;
        float a = sin(d.z * 4.6 + t * 1.7) * 0.5 + sin(d.z * 1.9 - t * 1.1) * 0.5;
        float b = sin(d.x * 7.2 + t * 2.3) * 0.42 + sin(d.x * 3.1 + t * 1.5) * 0.58;
        return a * 0.62 + b * 0.38;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;

        vec3 col = mix(uBot, uMid, smoothstep(-0.06, 0.44, h));
        col = mix(col, uTop, smoothstep(0.30, 0.88, h));

        // 地平线暖光
        float hor = exp(-pow((h - 0.02) * 6.0, 2.0));
        col += vec3(1.0, 0.58, 0.34) * hor * 0.10 * (1.0 - uNight);

        // 低空云带
        float cl = exp(-pow((h - 0.085) * 13.0, 2.0));
        float cw = 0.45 + 0.55 * sin(d.z * 2.6 + uTime * 0.06) * sin(d.x * 1.4 - uTime * 0.04);
        vec3 cloudCol = mix(vec3(0.95, 0.80, 0.78), vec3(0.28, 0.33, 0.52), uNight);
        col = mix(col, cloudCol, cl * 0.30 * (0.4 + 0.6 * cw));

        // 太阳
        float sd = max(0.0, dot(d, uSunDir));
        float disk = smoothstep(0.9992, 0.99965, sd);
        float halo = pow(sd, 42.0) * 1.1 + pow(sd, 8.0) * 0.34 + pow(sd, 2.2) * 0.10;
        vec3 sunCol = mix(vec3(1.0, 0.88, 0.66), vec3(1.0, 0.52, 0.30), 0.45);
        float sunI = 1.0 - smoothstep(0.05, 0.5, uNight);
        col += sunCol * halo * sunI;
        col += vec3(1.0, 0.96, 0.86) * disk * 2.4 * sunI;

        // 月亮
        float md = max(0.0, dot(d, uMoonDir));
        float mdisk = smoothstep(0.99955, 0.99985, md);
        col += vec3(0.94, 0.96, 1.0) * mdisk * 2.6 * uNight;
        col += vec3(0.55, 0.68, 1.0) * pow(md, 90.0) * 0.9 * uNight;
        col += vec3(0.32, 0.44, 0.85) * pow(md, 10.0) * 0.10 * uNight;

        // 极光帷幕
        if (uAurora > 0.001) {
          float yBand = smoothstep(0.04, 0.26, h) * (1.0 - smoothstep(0.40, 0.82, h));
          float b = band(d);
          float curtain = pow(0.5 + 0.5 * b, 1.6);
          float rays = 0.55 + 0.45 * sin(d.z * 34.0 + uTime * 1.1 + b * 3.0);
          vec3 ac = mix(vec3(0.16, 0.92, 0.62), vec3(0.42, 0.52, 1.0), 0.5 + 0.5 * b);
          col += ac * yBand * curtain * rays * uAurora * 0.95;
          // 极光在地平线的反光
          float low = exp(-pow((h + 0.02) * 9.0, 2.0));
          col += vec3(0.20, 0.75, 0.60) * low * uAurora * 0.31 * (0.5 + 0.5 * b);
        }

        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
skyDome.renderOrder = -10;
skyDome.frustumCulled = false;
scene.add(skyDome);

// ===================== 星 =====================
const STAR_N = 420;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_N * 3);
const starCol = new Float32Array(STAR_N * 3);
for (let i = 0; i < STAR_N; i++) {
  // 上半球随机
  const u = Math.random() * Math.PI * 2;
  const v = Math.random() * 0.85 + 0.06;
  const r = 1300;
  const y = v;
  const rr = Math.sqrt(Math.max(0, 1 - y * y));
  starPos[i * 3] = Math.cos(u) * rr * r;
  starPos[i * 3 + 1] = y * r;
  starPos[i * 3 + 2] = Math.sin(u) * rr * r;
  const b = 0.4 + Math.random() * 0.6;
  starCol[i * 3] = b;
  starCol[i * 3 + 1] = b;
  starCol[i * 3 + 2] = b * 1.08;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
const starMat = new THREE.PointsMaterial({
  size: 5.5, vertexColors: true, transparent: true, opacity: 0,
  depthWrite: false, sizeAttenuation: true, fog: false, map: GLOW,
  blending: THREE.AdditiveBlending,
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
stars.renderOrder = -9;
scene.add(stars);

// ===================== 远山（正前方多层剪影墙） =====================
function makeRidgeLayer(opts) {
  const { dist, width, step, freqs, cols, alpha } = opts;
  const pts = [];
  for (let z = -width / 2; z <= width / 2 + 0.01; z += step) {
    let h = 0;
    for (const [f, a, p] of freqs) h += Math.sin(z * f + p) * a;
    h = Math.abs(h);
    pts.push([z, h]);
  }
  const verts = [], idx = [];
  pts.forEach(([z, h], i) => {
    verts.push(0, h, z);
    verts.push(0, -900, z);
    if (i > 0) {
      const a = (i - 1) * 2, b = (i - 1) * 2 + 1, c = i * 2, d = i * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color: cols[0], depthWrite: false, fog: false, side: THREE.DoubleSide });
  if (alpha < 1) { mat.transparent = true; mat.opacity = alpha; }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0;
  mesh.userData = { dist, cols, base: -30 };
  mesh.frustumCulled = false;
  mesh.renderOrder = -8;
  return mesh;
}

const ridgeLayers = [];
ridgeLayers.push(makeRidgeLayer({
  dist: 2050, width: 7200, step: 30,
  freqs: [[0.0021, 130, 0.4], [0.0052, 62, 2.0], [0.0117, 22, 1.1]],
  cols: [0xb08f9e, 0x2c3358, 0x2a5560], alpha: 1,
}));
ridgeLayers.push(makeRidgeLayer({
  dist: 1420, width: 5200, step: 24,
  freqs: [[0.0027, 96, 1.2], [0.0066, 46, 0.4], [0.0148, 16, 2.4]],
  cols: [0x8f7285, 0x222a4c, 0x1f4550], alpha: 1,
}));
ridgeLayers.push(makeRidgeLayer({
  dist: 950, width: 3800, step: 18,
  freqs: [[0.0036, 66, 2.6], [0.0088, 30, 1.3], [0.0192, 11, 0.7]],
  cols: [0x6e5876, 0x1a2240, 0x173a44], alpha: 1,
}));
ridgeLayers.forEach((r) => scene.add(r));

// ===================== 雪道 =====================
let snowTintMat = null;

function buildTrack() {
  const dx = 4;
  const zSeg = 14;
  const dz = (LANE_HALF * 2) / zSeg;
  const pos = [], col = [], idx = [];

  const cCenter = new THREE.Color(0xe9f1fd);
  const cEdge = new THREE.Color(0xffffff);
  const cGroove = new THREE.Color(0xccdcf2);
  const tmp = new THREE.Color();

  let row = 0;
  for (let x = X_START; x <= X_END; x += dx, row++) {
    // 雪面明暗褶皱
    const fold = 0.5 + 0.5 * Math.sin(x * 0.052 + Math.sin(x * 0.013) * 2.0);
    for (let j = 0; j <= zSeg; j++) {
      const z = -LANE_HALF + j * dz;
      const e = Math.abs(z) / LANE_HALF;
      const y = terrainY(x) + bank(z);
      pos.push(x, y, z);

      // 中间被压过的雪道略灰，两侧新雪更白
      tmp.copy(cGroove).lerp(cCenter, 0.5 + 0.5 * e);
      if (e > 0.86) tmp.lerp(cEdge, (e - 0.86) / 0.14 * 0.9);
      const k = 0.90 + fold * 0.10;
      col.push(tmp.r * k, tmp.g * k, tmp.b * k);
    }
    if (row > 0) {
      const base = (row - 1) * (zSeg + 1);
      const cur = row * (zSeg + 1);
      for (let j = 0; j < zSeg; j++) {
        const a = base + j, b = base + j + 1, c = cur + j, d = cur + j + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  snowTintMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, snowTintMat);
  scene.add(mesh);
}
buildTrack();

// ===================== 峡谷两壁 =====================
function buildCanyonWall(sign) {
  const dx = 8;
  const zs = [0, 5, 12, 22, 40];
  const pos = [], col = [], idx = [];
  const cSnow = new THREE.Color(0xf2f7ff);
  const cMid = new THREE.Color(0x9aa9c9);
  const cDeep = new THREE.Color(0x2a2f52);
  const tmp = new THREE.Color();

  let row = 0;
  for (let x = X_START; x <= X_END; x += dx, row++) {
    for (let j = 0; j < zs.length; j++) {
      const z = sign * (LANE_HALF + zs[j]);
      const y = canyonY(x, z);
      pos.push(x, y, z);
      const t = j / (zs.length - 1);
      tmp.copy(cSnow).lerp(cMid, Math.min(1, t * 1.8));
      if (t > 0.5) tmp.lerp(cDeep, (t - 0.5) / 0.5);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    if (row > 0) {
      const base = (row - 1) * zs.length;
      const cur = row * zs.length;
      for (let j = 0; j < zs.length - 1; j++) {
        const a = base + j, b = base + j + 1, c = cur + j, d = cur + j + 1;
        if (sign > 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  scene.add(mesh);
}
buildCanyonWall(1);
buildCanyonWall(-1);

// ===================== 路边剪影树 =====================
(function buildTrees() {
  const count = 420;
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.16, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  crownGeo.translate(0, 0.5, 0);

  const mat = new THREE.MeshBasicMaterial({ color: 0x151a2e });
  const trunks = new THREE.InstancedMesh(trunkGeo, mat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, mat, count);

  const dummy = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = X_START + Math.random() * (X_END - X_START);
    const sign = Math.random() < 0.5 ? 1 : -1;
    const off = 4 + Math.random() * 15;
    const z = sign * (LANE_HALF + off);
    const y = canyonY(x, z);
    const h = 3.4 + Math.random() * 3.6;

    dummy.position.set(x, y - 0.3, z);
    dummy.rotation.set(0, Math.random() * 6.28, 0);
    dummy.scale.set(1, h * 0.42, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(n, dummy.matrix);

    dummy.position.set(x, y - 0.3 + h * 0.30, z);
    dummy.scale.set(h * 0.30, h * 0.82, h * 0.30);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(n, dummy.matrix);
    n++;
  }
  trunks.count = n;
  crowns.count = n;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns);
})();

// ===================== 主角：小雪团（可爱向） =====================
const skier = new THREE.Group();

const creamMat = new THREE.MeshBasicMaterial({ color: 0xfff6ea });   // 雪白
const coatMat = new THREE.MeshBasicMaterial({ color: 0xff9d76 });    // 珊瑚外套
const coatDarkMat = new THREE.MeshBasicMaterial({ color: 0xf5805e });// 暗一档
const hatMat = new THREE.MeshBasicMaterial({ color: 0x7ad4c5 });     // 薄荷帽
const scarfMat = new THREE.MeshBasicMaterial({ color: 0xffd071, side: THREE.DoubleSide });
const boardMat = new THREE.MeshBasicMaterial({ color: 0xffb27a });
const boardUnderMat = new THREE.MeshBasicMaterial({ color: 0xd9744f });
const mittenMat = new THREE.MeshBasicMaterial({ color: 0x8ee6d4 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x33263c });
const blushMat = new THREE.MeshBasicMaterial({ color: 0xffab9a, transparent: true, opacity: 0.85 });

// 板：圆头圆尾的胖板
const boardGeo = new THREE.CapsuleGeometry(0.30, 1.35, 4, 12);
boardGeo.rotateZ(Math.PI / 2);
const board = new THREE.Mesh(boardGeo, boardMat);
board.scale.set(1.02, 0.40, 1.45);
board.position.set(0.06, 0.11, 0);
skier.add(board);

const boardUnder = new THREE.Mesh(boardGeo, boardUnderMat);
boardUnder.scale.set(1.04, 0.20, 1.15);
boardUnder.position.set(0.06, 0.035, 0);
skier.add(boardUnder);

// 腿：短短的
const legGeo = new THREE.CapsuleGeometry(0.155, 0.16, 3, 8);
for (const s of [-1, 1]) {
  const leg = new THREE.Mesh(legGeo, coatDarkMat);
  leg.position.set(0.02, 0.36, s * 0.20);
  skier.add(leg);
}

// 身体：圆滚滚
const body = new THREE.Mesh(new THREE.SphereGeometry(0.43, 18, 16), coatMat);
body.position.set(0.0, 0.85, 0);
body.scale.set(1.0, 1.04, 0.95);
skier.add(body);

// 身体前襟（浅色肚皮）
const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 14), creamMat);
belly.position.set(0.18, 0.80, 0);
belly.scale.set(0.85, 0.95, 0.86);
skier.add(belly);

// 手臂 + 连指手套
const armGeo = new THREE.CapsuleGeometry(0.105, 0.26, 3, 8);
for (const s of [-1, 1]) {
  const arm = new THREE.Mesh(armGeo, coatMat);
  arm.position.set(0.04, 0.90, s * 0.40);
  arm.rotation.set(s * 0.35, 0, -0.55);
  skier.add(arm);

  const mitten = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 10), mittenMat);
  mitten.position.set(0.24, 0.70, s * 0.50);
  mitten.scale.set(1, 0.92, 1);
  skier.add(mitten);
}

// 围脖
const collar = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.115, 9, 20), scarfMat);
collar.position.set(0.0, 1.20, 0);
collar.rotation.x = Math.PI / 2;
skier.add(collar);

// 大头
const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 18), creamMat);
head.position.set(0.02, 1.56, 0);
head.scale.set(1, 0.98, 0.97);
skier.add(head);

// 腮红 + 眼睛（正面，转身/落地时能看到）
for (const s of [-1, 1]) {
  const blush = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), blushMat);
  blush.position.set(0.38, 1.47, s * 0.245);
  blush.scale.set(0.55, 0.7, 1);
  skier.add(blush);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), eyeMat);
  eye.position.set(0.415, 1.615, s * 0.155);
  skier.add(eye);
}

// 薄荷毛线帽
const hat = new THREE.Mesh(new THREE.SphereGeometry(0.475, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), hatMat);
hat.position.set(0.01, 1.55, 0);
skier.add(hat);

const hatBrim = new THREE.Mesh(new THREE.TorusGeometry(0.455, 0.062, 9, 22), hatMat);
hatBrim.position.set(0.01, 1.58, 0);
hatBrim.rotation.x = Math.PI / 2;
skier.add(hatBrim);

// 帽顶绒球
const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), creamMat);
pompom.position.set(-0.02, 2.05, 0);
skier.add(pompom);
const pompom2 = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), creamMat);
pompom2.position.set(-0.05, 2.10, 0.02);
skier.add(pompom2);

// 围巾尾巴（向后飘）
const scarfGeo = new THREE.PlaneGeometry(0.85, 0.26, 12, 2);
scarfGeo.translate(-0.42, 0, 0);
const scarf = new THREE.Mesh(scarfGeo, scarfMat);
scarf.position.set(-0.10, 1.20, 0);
scarf.rotation.z = 0.06;
skier.add(scarf);
const scarfBase = scarfGeo.attributes.position.array.slice();

// 角色柔光（从暗背景里浮出来）
const skierGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: GLOW, color: 0xffe6c2, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22, fog: false,
}));
skierGlow.scale.setScalar(2.6);
skierGlow.position.set(-0.1, 1.0, 0);
skier.add(skierGlow);

// 脚下投影
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x33456b, transparent: true, opacity: 0.20, depthWrite: false });
const shadowMesh = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), shadowMat);
shadowMesh.rotation.x = -Math.PI / 2;
scene.add(shadowMesh);

skier.scale.setScalar(1.06);
skier.position.set(0, terrainY(0), 0);
scene.add(skier);

// ===================== 雪雾拖尾 =====================
const TRAIL_N = 46;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
for (let i = 0; i < TRAIL_N; i++) {
  const k = Math.pow(1 - i / TRAIL_N, 1.4);
  trailCol[i * 3] = 0.95 * k;
  trailCol[i * 3 + 1] = 0.97 * k;
  trailCol[i * 3 + 2] = 1.0 * k;
}
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
  size: 0.5, map: GLOW, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45, fog: false,
}));
trail.frustumCulled = false;
scene.add(trail);

// ===================== 小动物（碰到就有不同的祝福） =====================
const ANIMAL_INFO = {
  rabbit:  { name: '雪兔', note: '超级弹跳', tint: '#ffd9e2', glow: 0xffd9e2 },
  penguin: { name: '企鹅', note: '冲刺加速', tint: '#ffc98a', glow: 0xffc98a },
  owl:     { name: '雪鸮', note: '空中滑翔', tint: '#c2e6ff', glow: 0xc2e6ff },
  fox:     { name: '小狐', note: '拾光磁吸', tint: '#ffb27a', glow: 0xffb27a },
};

const mCream = new THREE.MeshBasicMaterial({ color: 0xfffaf2 });
const mSnow = new THREE.MeshBasicMaterial({ color: 0xeef4ff });
const mNavy = new THREE.MeshBasicMaterial({ color: 0x2c3350 });
const mOrange = new THREE.MeshBasicMaterial({ color: 0xff9a4d });
const mFox = new THREE.MeshBasicMaterial({ color: 0xf08a4e });
const mPink = new THREE.MeshBasicMaterial({ color: 0xffb4b4 });
const mDark = new THREE.MeshBasicMaterial({ color: 0x2b2438 });

function addEye(parent, x, y, z, r = 0.055) {
  const e = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 8), mDark);
  e.position.set(x, y, z);
  parent.add(e);
}

function buildRabbit() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.40, 14, 12), mCream);
  body.position.set(0, 0.46, 0);
  body.scale.set(1.06, 1, 0.94);
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 14, 12), mCream);
  head.position.set(-0.28, 0.82, 0);
  g.add(head);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.36, 3, 8), mCream);
    ear.position.set(-0.30, 1.12, s * 0.135);
    ear.rotation.set(s * 0.13, 0, 0.14);
    g.add(ear);
    const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.26, 3, 6), mPink);
    inner.position.set(-0.335, 1.13, s * 0.135);
    inner.rotation.set(s * 0.13, 0, 0.14);
    g.add(inner);
    addEye(g, -0.505, 0.86, s * 0.115);
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mPink);
    blush.position.set(-0.46, 0.76, s * 0.19);
    blush.scale.set(0.5, 0.6, 1);
    g.add(blush);
  }

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 8), mCream);
  tail.position.set(0.40, 0.40, 0);
  g.add(tail);
  return g;
}

function buildPenguin() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.41, 14, 12), mNavy);
  body.position.set(0, 0.50, 0);
  body.scale.set(0.98, 1.06, 0.92);
  g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 12), mSnow);
  belly.position.set(-0.14, 0.44, 0);
  belly.scale.set(0.78, 1.02, 0.86);
  g.add(belly);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.22, 10), mOrange);
  beak.position.set(-0.46, 0.72, 0);
  beak.rotation.z = Math.PI / 2;
  g.add(beak);

  for (const s of [-1, 1]) {
    addEye(g, -0.34, 0.86, s * 0.15, 0.05);
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), mNavy);
    wing.position.set(0.02, 0.54, s * 0.36);
    wing.scale.set(0.7, 1.05, 0.45);
    wing.rotation.z = -0.25;
    g.add(wing);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mOrange);
    foot.position.set(-0.10, 0.06, s * 0.17);
    foot.scale.set(1.2, 0.4, 1);
    g.add(foot);
  }
  return g;
}

function buildOwl() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), mCream);
  body.position.set(0, 0.52, 0);
  body.scale.set(1, 1.08, 0.95);
  g.add(body);

  for (const s of [-1, 1]) {
    const disc = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 10), mSnow);
    disc.position.set(-0.33, 0.78, s * 0.18);
    disc.scale.set(0.7, 1, 1);
    g.add(disc);
    addEye(g, -0.43, 0.78, s * 0.18, 0.075);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.24, 8), mCream);
    tuft.position.set(-0.14, 1.02, s * 0.24);
    tuft.rotation.set(s * 0.28, 0, 0.18);
    g.add(tuft);
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mSnow);
    wing.position.set(0.06, 0.54, s * 0.36);
    wing.scale.set(0.85, 1.15, 0.34);
    wing.rotation.z = -0.18;
    g.add(wing);
  }

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 9), mOrange);
  beak.position.set(-0.44, 0.66, 0);
  beak.rotation.z = Math.PI / 2;
  g.add(beak);
  return g;
}

function buildFox() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 12), mFox);
  body.position.set(0, 0.44, 0);
  body.scale.set(1.12, 1, 0.94);
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), mFox);
  head.position.set(-0.32, 0.78, 0);
  g.add(head);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), mCream);
  muzzle.position.set(-0.50, 0.72, 0);
  muzzle.scale.set(1.25, 0.78, 0.86);
  g.add(muzzle);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mDark);
  nose.position.set(-0.63, 0.75, 0);
  g.add(nose);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.26, 8), mFox);
    ear.position.set(-0.30, 1.02, s * 0.145);
    ear.rotation.set(s * 0.2, 0, 0.1);
    g.add(ear);
    addEye(g, -0.55, 0.84, s * 0.12);
  }

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.42, 4, 10), mFox);
  tail.position.set(0.48, 0.52, 0);
  tail.rotation.z = -0.55;
  g.add(tail);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), mCream);
  tip.position.set(0.68, 0.72, 0);
  g.add(tip);
  return g;
}

const ANIMAL_BUILDERS = { rabbit: buildRabbit, penguin: buildPenguin, owl: buildOwl, fox: buildFox };

const animals = [];
const animalGroup = new THREE.Group();
scene.add(animalGroup);

(function spawnAnimals() {
  const order = ['rabbit', 'penguin', 'owl', 'fox'];
  let x = 105;
  let k = 0;
  while (x < X_END - 700) {
    const type = order[k % order.length];
    k++;
    const z = (Math.random() - 0.5) * (LANE_HALF * 1.35);
    const g = ANIMAL_BUILDERS[type]();
    const baseY = terrainY(x) + bank(z);
    g.position.set(x, baseY, z);
    g.rotation.y = (Math.random() - 0.5) * 0.3;
    g.userData = { type, taken: false, fade: 0, phase: Math.random() * 6.28, baseY };
    animalGroup.add(g);
    animals.push(g);
    x += 92 + Math.random() * 58;
  }
})();

function pickAnimal(a) {
  if (a.userData.taken || state.dead) return;
  a.userData.taken = true;
  a.userData.fade = 0.75;
  const info = ANIMAL_INFO[a.userData.type];
  state.buddies++;

  sfxAnimal();
  spawnBurst(a.position.x, a.position.y + 0.7, a.position.z, info.glow, 12);

  switch (a.userData.type) {
    case 'rabbit':                       // 雪兔：一跳飞天
      state.air = true;
      state.vy = 19;
      state.spin = 0;
      state.fx.invuln = 1.4;
      showChip('雪兔 · 超级弹跳', info.tint, 2200);
      break;
    case 'penguin':                      // 企鹅：肚皮冲刺
      state.fx.boost = 3.6;
      state.fx.invuln = 1.8;
      showChip('企鹅 · 冲刺加速', info.tint, 3600);
      break;
    case 'owl':                          // 雪鸮：滑翔一段
      state.fx.glide = 3.4;
      state.air = true;
      state.vy = 7.2;
      state.spin = 0;
      state.fx.invuln = 3.4;
      showChip('雪鸮 · 空中滑翔', info.tint, 3400);
      break;
    case 'fox':                          // 小狐：把光都叼过来
      state.fx.magnet = 9;
      showChip('小狐 · 拾光磁吸', info.tint, 9000);
      break;
  }
  showPop(info.name + '　' + info.note);
}

function updateAnimals(dt, t) {
  for (const a of animals) {
    const u = a.userData;
    if (u.taken) {
      if (u.fade > 0) {
        u.fade -= dt;
        const k = Math.max(0, u.fade / 0.75);
        a.scale.setScalar(1 + (1 - k) * 0.5);
        a.position.y = u.baseY + (1 - k) * 2.4;
        a.rotation.z += dt * 3.0;
        a.visible = u.fade > 0;
      }
      continue;
    }

    // 呼吸 + 摇摆
    a.position.y = u.baseY + Math.sin(t * 2.1 + u.phase) * 0.07;
    a.rotation.z = Math.sin(t * 1.5 + u.phase) * 0.05;
    a.rotation.y = Math.sin(t * 0.6 + u.phase) * 0.12;

    if (!state.started || state.dead) continue;

    const dx = a.position.x - state.x;
    if (dx > 60 || dx < -10) continue;
    const dz = a.position.z - state.z;
    const reached = a.position.x >= state.prevX - 1.2 && a.position.x <= state.x + 1.4;
    if (reached && Math.abs(dz) < 2.0) pickAnimal(a);
  }
}

// ===================== 收集光点 =====================
const ORB_GAP = 35;
const ORB_COUNT = Math.floor((X_END - X_START - 120) / ORB_GAP);
const orbs = [];
const orbGroup = new THREE.Group();
scene.add(orbGroup);

for (let i = 0; i < ORB_COUNT; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xfff2d2, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1, fog: false,
  }));
  const x = 60 + i * ORB_GAP + Math.random() * 10;
  const z = (Math.random() - 0.5) * (LANE_HALF * 1.55);
  s.position.set(x, terrainY(x) + bank(z) + 2.0 + Math.random() * 1.9, z);
  const sc = 1.7 + Math.random() * 0.5;
  s.scale.setScalar(sc);
  s.userData = { taken: false, baseY: s.position.y, phase: Math.random() * 6.28, baseScale: sc, ix: s.position.x, iy: s.position.y, iz: s.position.z };
  orbGroup.add(s);
  orbs.push(s);
}
document.getElementById('orbs').parentElement.querySelector('em').textContent = '/ ' + ORB_COUNT;

// ===================== 飘雪 =====================
const SNOW_N = 520;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) {
  snowPos[i * 3] = -30 + Math.random() * 90;
  snowPos[i * 3 + 1] = -8 + Math.random() * 34;
  snowPos[i * 3 + 2] = (Math.random() - 0.5) * 64;
}
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowMat = new THREE.PointsMaterial({
  size: 0.30, color: 0xffffff, transparent: true, opacity: 0.6,
  map: GLOW, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});
const snowPts = new THREE.Points(snowGeo, snowMat);
snowPts.frustumCulled = false;
scene.add(snowPts);

// ===================== 状态 =====================
const state = {
  x: 0,
  prevX: 0,
  z: 0,
  y: terrainY(0),
  vz: 0,
  speed: 10,
  vy: 0,
  air: false,
  started: false,
  score: 0,
  buddies: 0,
  best: 0,
  distance: 0,
  spin: 0,
  flipAngle: 0,
  boosting: false,
  boost: 1,
  steer: 0,
  dead: false,
  deadT: 0,
  squash: 0,
  fx: { boost: 0, glide: 0, magnet: 0, invuln: 0 },
};

const camPos = new THREE.Vector3(-11, terrainY(0) + 6, 0);
const camLook = new THREE.Vector3(14, terrainY(0) + 2, 0);

// ===================== 输入 =====================
const keys = { left: false, right: false, boost: false, flip: false };
let touchHold = false;

function syncFlip() {
  keys.flip = keys.flipKey || touchHold;
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.boost = true;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') {
    if (!keys.flipKey && state.dead) return;
    keys.flipKey = true;
    syncFlip();
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (state.started && !state.dead) jump();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.boost = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') {
    keys.flipKey = false;
    syncFlip();
  }
});

let touchX = null;
window.addEventListener('pointerdown', (e) => {
  if (!state.started || state.dead) return;
  if (e.pointerType === 'touch') {
    touchX = e.clientX;
    touchHold = true;
    syncFlip();
    return;
  }
  jump();
});
window.addEventListener('pointermove', (e) => {
  if (touchX !== null) {
    const dx = e.clientX - touchX;
    if (Math.abs(dx) > 6) {
      keys.left = dx < 0;
      keys.right = dx > 0;
    }
  }
});
window.addEventListener('pointerup', () => {
  touchX = null; touchHold = false; syncFlip();
  keys.left = false; keys.right = false;
});
window.addEventListener('pointercancel', () => {
  touchX = null; touchHold = false; syncFlip();
  keys.left = false; keys.right = false;
});

function jump() {
  if (state.air || state.dead) return;
  state.air = true;
  state.vy = 11 + state.speed * 0.20;
  state.spin = 0;
  sfxJump();
}

// ===================== 音频引擎 =====================
const audio = {
  ctx: null,
  master: null,
  musicBus: null,
  windGain: null,
  delay: null,
  ready: false,
};

function initAudio() {
  if (audio.ready) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  audio.ctx = ctx;

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  audio.master = master;

  // 混响（用程序化脉冲响应的简化版：多抽头延时）
  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.0001;
  musicBus.connect(master);
  audio.musicBus = musicBus;
  musicBus.gain.exponentialRampToValueAtTime(0.30, ctx.currentTime + 4);

  // 立体延时
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.34;
  const fb = ctx.createGain();
  fb.gain.value = 0.34;
  const wet = ctx.createGain();
  wet.gain.value = 0.30;
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(master);
  audio.delay = delay;

  // 风
  const len = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 0.7;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.0001;
  noise.connect(bp);
  bp.connect(windGain);
  windGain.connect(master);
  noise.start();
  windGain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 3);
  audio.windGain = windGain;

  audio.ready = true;
  startMusic();
}

/* ---------- 治愈系 lo-fi 音轨 ---------- */
const BPM = 92;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;        // 十六分音符
const BAR = 16;               // 每小节 16 步
// Am7 – Fmaj7 – Cmaj7 – G(add9)
const CHORDS = [
  { root: 55.00, notes: [220.00, 261.63, 329.63, 392.00] },
  { root: 43.65, notes: [174.61, 220.00, 261.63, 329.63] },
  { root: 65.41, notes: [261.63, 329.63, 392.00, 493.88] },
  { root: 49.00, notes: [196.00, 246.94, 293.66, 392.00] },
];
const ARP_ORDER = [0, 2, 1, 3, 2, 1, 3, 2];

let musicTimer = null;
let nextStepTime = 0;
let stepIdx = 0;
let arpPtr = 0;
let melodyPtr = 0;

function startMusic() {
  const ctx = audio.ctx;
  nextStepTime = ctx.currentTime + 0.15;
  stepIdx = 0;
  musicTimer = setInterval(scheduleAhead, 25);
  scheduleAhead();
}

function scheduleAhead() {
  const ctx = audio.ctx;
  if (!ctx) return;
  while (nextStepTime < ctx.currentTime + 0.22) {
    playStep(stepIdx, nextStepTime);
    nextStepTime += STEP;
    stepIdx = (stepIdx + 1) % (BAR * 4);
  }
}

function playStep(s, t) {
  const bar = Math.floor(s / BAR);
  const pos = s % BAR;
  const chord = CHORDS[bar];
  const ctx = audio.ctx;

  // 和弦垫：每小节起点
  if (pos === 0) {
    playPad(chord, t, BEAT * 4 * 0.98);
    playBass(chord.root, t, BEAT * 1.6);
  }

  // 贝斯：第 3 拍再补一下
  if (pos === 8) playBass(chord.root * 1.5, t, BEAT * 0.9);

  // 轻鼓
  if (pos === 0 || pos === 7 || pos === 10) playKick(t, pos === 0 ? 0.55 : 0.34);
  if (pos % 2 === 0) playHat(t, pos % 4 === 0 ? 0.10 : 0.06);

  // 琶音：八分音符
  if (pos % 2 === 0) {
    const n = chord.notes[ARP_ORDER[arpPtr % ARP_ORDER.length]] * 2;
    arpPtr++;
    playArp(n, t, 0.055);
  }

  // 高处风铃：每两小节一次，制造治愈留白
  if (bar % 2 === 1 && pos === 12) {
    const n = chord.notes[3] * 4;
    playBell(n, t);
  }
  // 小旋律动机：第 2、4 小节
  if (bar === 1 || bar === 3) {
    const mel = [chord.notes[1] * 2, chord.notes[2] * 2, chord.notes[3] * 2, chord.notes[2] * 2];
    if (pos === 4 || pos === 6 || pos === 9 || pos === 13) {
      playLead(mel[melodyPtr % 4], t);
      melodyPtr++;
    }
  }
}

function playPad(chord, t, dur) {
  const ctx = audio.ctx;
  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.connect(audio.musicBus);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(620, t);
  lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.6);
  lp.frequency.linearRampToValueAtTime(700, t + dur);
  lp.Q.value = 0.6;
  lp.connect(bus);

  chord.notes.forEach((f, i) => {
    for (let d = 0; d < 2; d++) {
      const o = ctx.createOscillator();
      o.type = d === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * (d === 0 ? 1 : 2.002);
      const g = ctx.createGain();
      g.gain.value = (d === 0 ? 0.22 : 0.07) / (1 + i * 0.35);
      o.connect(g);
      g.connect(lp);
      o.start(t);
      o.stop(t + dur + 1.6);
    }
  });

  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(0.10, t + 0.75);
  bus.gain.exponentialRampToValueAtTime(0.070, t + dur * 0.8);
  bus.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
}

function playBass(f, t, dur) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(audio.musicBus);
  o.start(t);
  o.stop(t + dur + 0.1);
}

function playArp(f, t, vol) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * 2.2, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = (Math.random() - 0.5) * 0.6; o.connect(g); g.connect(p); p.connect(audio.musicBus); p.connect(audio.delay); }
  else { o.connect(g); g.connect(audio.musicBus); g.connect(audio.delay); }
  o.start(t);
  o.stop(t + 0.4);
}

function playLead(f, t) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(f * 2.001, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.045, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  o.connect(g); g.connect(audio.musicBus); g.connect(audio.delay);
  o2.connect(g2); g2.connect(g);
  o.start(t); o.stop(t + 0.85);
  o2.start(t); o2.stop(t + 0.85);
}

function playBell(f, t) {
  const ctx = audio.ctx;
  [1, 2.76, 5.4].forEach((mul, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const g = ctx.createGain();
    const v = 0.05 / (i + 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 / (i + 1));
    o.connect(g);
    g.connect(audio.musicBus);
    g.connect(audio.delay);
    o.start(t);
    o.stop(t + 1.8);
  });
}

function playKick(t, vol) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(118, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.10);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
  o.connect(g);
  g.connect(audio.musicBus);
  o.start(t);
  o.stop(t + 0.34);
}

let hatBuffer = null;
function playHat(t, vol) {
  const ctx = audio.ctx;
  if (!hatBuffer) {
    const len = Math.floor(ctx.sampleRate * 0.08);
    hatBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = hatBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const s = ctx.createBufferSource();
  s.buffer = hatBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6800;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(hp);
  hp.connect(g);
  g.connect(audio.musicBus);
  s.start(t);
}

// ---------- 音效 ----------
function sfxJump() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(420, t);
  o.frequency.exponentialRampToValueAtTime(760, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + 0.3);
}

function sfxPickup() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const base = 740 * Math.pow(2, (state.score % 8) / 12);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.13);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.055, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + 0.34);
}

function sfxLand() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + 0.3);
}

// 碰到小动物：两声上扬的可爱“啾”
function sfxAnimal() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t0 = ctx.currentTime;
  [[784, 0], [1175, 0.09]].forEach(([f, d]) => {
    const t = t0 + d;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(audio.master); g.connect(audio.delay);
    o.start(t); o.stop(t + 0.34);
  });
}

// 摔倒：一声闷响 + 雪块散落
function sfxCrash() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;

  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(190, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.32);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + 0.55);

  const len = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
  const n = ctx.createBufferSource();
  n.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1600;
  const ng = ctx.createGain();
  ng.gain.value = 0.16;
  n.connect(lp); lp.connect(ng); ng.connect(audio.master);
  n.start(t);

  // 背景音乐短暂压低
  if (audio.musicBus) {
    const now = ctx.currentTime;
    audio.musicBus.gain.cancelScheduledValues(now);
    audio.musicBus.gain.setValueAtTime(audio.musicBus.gain.value, now);
    audio.musicBus.gain.exponentialRampToValueAtTime(0.03, now + 0.35);
    audio.musicBus.gain.exponentialRampToValueAtTime(0.22, now + 3.0);
  }
}

// ===================== UI 引用 =====================
const bootEl = document.getElementById('boot');
const introEl = document.getElementById('intro');
const uiEl = document.getElementById('ui');
const keysHintEl = document.getElementById('keysHint');
const distEl = document.getElementById('dist');
const speedEl = document.getElementById('speedVal');
const speedFillEl = document.getElementById('speedFill');
const orbsEl = document.getElementById('orbs');
const scoreEl = document.getElementById('score');
const phaseFillEl = document.getElementById('phaseFill');
const boostFillEl = document.getElementById('boostFill');
const boostWrapEl = document.getElementById('boostWrap');
const chipEl = document.getElementById('chip');
const popEl = document.getElementById('pop');
const deadEl = document.getElementById('dead');
const flashEl = document.getElementById('flash');
const dDistEl = document.getElementById('dDist');
const dOrbsEl = document.getElementById('dOrbs');
const dBuddiesEl = document.getElementById('dBuddies');
const dBestEl = document.getElementById('dBest');

// ---------- 效果提示条 ----------
let chipTimer = null;
function showChip(text, tint, ms) {
  chipEl.textContent = text;
  chipEl.style.borderColor = tint;
  chipEl.style.color = '#fff';
  chipEl.style.boxShadow = '0 0 22px ' + tint + '55';
  chipEl.classList.add('on');
  if (chipTimer) clearTimeout(chipTimer);
  chipTimer = setTimeout(hideChip, ms || 2200);
}
function hideChip() {
  chipEl.classList.remove('on');
  if (chipTimer) { clearTimeout(chipTimer); chipTimer = null; }
}

// ---------- 屏幕中央飘字 ----------
let popTimer = null;
function showPop(text) {
  popEl.textContent = text;
  popEl.classList.remove('go');
  void popEl.offsetWidth;
  popEl.classList.add('go');
  if (popTimer) clearTimeout(popTimer);
  popTimer = setTimeout(() => popEl.classList.remove('go'), 1400);
}

const isTest = new URLSearchParams(location.search).get('auto') === '1';

requestAnimationFrame(() => {
  setTimeout(() => {
    if (isTest) { bootEl.remove(); }
    else bootEl.classList.add('gone');
  }, 120);
});

function begin() {
  if (state.started) return;
  state.started = true;
  if (isTest) {
    introEl.remove();
    bootEl.remove();
  } else {
    introEl.classList.add('gone');
  }
  uiEl.classList.add('show');
  initAudio();
  setTimeout(() => keysHintEl.classList.add('fade'), 11000);
}
introEl.addEventListener('click', begin);
if (isTest) setTimeout(begin, 300);

// 调试：?d=1500 直接跳到指定距离
{
  const d = parseFloat(new URLSearchParams(location.search).get('d') || '0');
  if (d > 0) {
    state.x = d;
    state.prevX = d;
    state.y = terrainY(d);
    state.distance = d;
    camPos.set(d - 11, terrainY(d) + 6, 0);
    camLook.set(d + 14, terrainY(d) + 2, 0);
  }
}

// 重新开始
document.getElementById('againBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  restart();
});

// 调试：?crash=1 开局 1 秒后模拟摔倒
if (new URLSearchParams(location.search).get('crash') === '1') {
  setTimeout(() => { if (!state.dead) crash(); }, 1000 + (parseFloat(new URLSearchParams(location.search).get('d') || '0') > 0 ? 1500 : 0));
}

// ===================== 更新：角色 =====================
function updateSkier(dt, t) {
  const slope = terrainSlope(state.x);
  const ang = Math.atan(slope);

  // 效果计时
  for (const k in state.fx) state.fx[k] = Math.max(0, state.fx[k] - dt);
  const gliding = state.fx.glide > 0;
  const boosted = state.fx.boost > 0;

  state.prevX = state.x;

  // ---- 转向 ----
  const steerIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  state.steer += (steerIn - state.steer) * Math.min(1, dt * 9);
  const targetVz = state.steer * (state.air ? 9 : 15);
  state.vz += (targetVz - state.vz) * Math.min(1, dt * 7);
  state.z += state.vz * dt;
  const ZLIM = LANE_HALF - 1.6;
  if (state.z > ZLIM) { state.z = ZLIM; state.vz *= 0.3; }
  if (state.z < -ZLIM) { state.z = -ZLIM; state.vz *= 0.3; }

  // ---- 冲刺 ----
  const wantBoost = (keys.boost || boosted) && (boosted || state.boost > 0.02) && !state.air;
  if (wantBoost && !boosted) state.boost = Math.max(0, state.boost - dt * 0.30);
  else if (!boosted) state.boost = Math.min(1, state.boost + dt * 0.13);

  if (!state.air) {
    const accel = -slope * 40;
    state.speed += (accel - 2.6) * dt;
    if (wantBoost) state.speed += (boosted ? 32 : 17) * dt;
    state.speed = Math.max(6, Math.min(boosted ? 62 : 48, state.speed));

    state.x += Math.cos(ang) * state.speed * dt;
    state.y = terrainY(state.x) + bank(state.z);

    if (slope > 0.22 && state.speed > 15) jump();
  } else {
    // ---- 空中 ----
    state.vy -= (gliding ? 8.5 : 36) * dt;
    if (gliding) {
      state.vy = Math.max(state.vy, -3.0);
      state.speed = Math.max(state.speed, 26);
    }
    state.x += Math.cos(ang * 0.4) * state.speed * dt;
    state.y += state.vy * dt;

    // 按住 W/↑ 翻转
    if (!gliding && keys.flip) state.spin += dt * 6.2;

    const gy = terrainY(state.x) + bank(state.z);
    if (state.y <= gy) {
      state.y = gy;

      if (gliding) {
        // 雪鸮托着，轻轻放下
        state.air = false;
        state.vy = 0;
        state.spin = 0;
        state.squash = 0.12;
        sfxLand();
        for (let i = 0; i < 6; i++) spawnPuff(state.x, gy, state.z);
      } else if (Math.cos(state.spin) < 0.25 && state.fx.invuln <= 0) {
        // 头朝地 —— 摔倒
        crash();
        return;
      } else {
        const flips = Math.floor((state.spin + 0.55) / (Math.PI * 2));
        state.air = false;
        state.vy = 0;
        state.spin = 0;
        state.squash = 0.22;
        sfxLand();
        for (let i = 0; i < 8; i++) spawnPuff(state.x, gy, state.z);
        if (flips > 0) {
          state.boost = Math.min(1, state.boost + 0.3 * flips);
          state.score += 0;
          showPop(flips > 1 ? '连续翻转 ×' + flips + '　漂亮！' : '完 美 落 地');
          spawnBurst(state.x, gy + 0.8, state.z, 0xffe0b0, 10);
          sfxAnimal();
        }
      }
    }
  }

  state.x = Math.min(state.x, X_END - 400);

  // ---- 位姿 ----
  if (state.squash > 0) state.squash = Math.max(0, state.squash - dt * 0.9);
  const sq = state.squash;
  skier.scale.set(1.06 * (1 + sq * 0.55), 1.06 * (1 - sq * 1.1), 1.06 * (1 + sq * 0.55));
  skier.position.set(state.x, state.y, state.z);
  skier.rotation.z = state.air || state.dead ? state.spin : -ang * 0.9;
  skier.rotation.x = -state.steer * 0.30;
  skier.rotation.y = -state.steer * 0.16;

  // 投影
  {
    const gy = terrainY(state.x) + bank(state.z) + 0.03;
    shadowMesh.position.set(state.x, gy, state.z);
    const hAbove = Math.max(0, state.y - gy);
    const sc = Math.max(0.35, 1 - hAbove * 0.09);
    shadowMesh.scale.setScalar(sc);
    shadowMat.opacity = Math.max(0.04, 0.22 - hAbove * 0.028);
  }

  // 围巾飘动
  const arr = scarfGeo.attributes.position.array;
  const total = 13;
  for (let i = 0; i < arr.length; i += 3) {
    const col = i / 3;
    const u = (col % total) / (total - 1);
    const amp = (0.05 + state.speed * 0.010) * u * u;
    arr[i + 1] = scarfBase[i + 1] + Math.sin(t * 13 - u * 7) * amp;
    arr[i] = scarfBase[i] + Math.cos(t * 9 - u * 5) * amp * 0.6;
  }
  scarfGeo.attributes.position.needsUpdate = true;

  // 拖尾
  for (let i = TRAIL_N - 1; i > 0; i--) {
    trailPos[i * 3] = trailPos[(i - 1) * 3];
    trailPos[i * 3 + 1] = trailPos[(i - 1) * 3 + 1];
    trailPos[i * 3 + 2] = trailPos[(i - 1) * 3 + 2];
  }
  trailPos[0] = state.x - 1.0;
  trailPos[1] = state.y + 0.10;
  trailPos[2] = state.z;
  trailGeo.attributes.position.needsUpdate = true;

  state.distance = Math.max(state.distance, state.x);
}

// ===================== 摔倒 =====================
function crash() {
  if (state.dead) return;
  state.dead = true;
  state.deadT = 0;
  state.air = false;
  state.spin = 0;
  state.speed *= 0.45;
  state.best = Math.max(state.best, Math.floor(state.distance));

  sfxCrash();
  flashScreen();
  for (let i = 0; i < 26; i++) {
    spawnPuff(state.x + (Math.random() - 0.5) * 2.4, state.y + Math.random() * 1.6, state.z + (Math.random() - 0.5) * 2.4);
  }

  setTimeout(() => {
    dDistEl.textContent = String(Math.floor(state.distance));
    dOrbsEl.textContent = String(state.score);
    dBuddiesEl.textContent = String(state.buddies);
    dBestEl.textContent = String(state.best);
    deadEl.classList.add('on');
  }, 950);
}

function flashScreen() {
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 130);
}

function updateDead(dt, t) {
  state.deadT += dt;
  // 惯性往前蹭一小段，然后翻滚
  state.x += state.speed * dt * 0.3;
  state.speed *= Math.pow(0.02, dt);
  state.y = terrainY(state.x) + bank(state.z) - 0.25;
  skier.position.set(state.x, state.y, state.z);
  skier.rotation.z += dt * 4.6;
  skier.rotation.x += dt * 1.1;
  if (state.deadT < 0.8 && Math.random() < 0.5) {
    spawnPuff(state.x, state.y + 0.3, state.z);
  }
}

function restart() {
  deadEl.classList.remove('on');
  for (const o of orbs) {
    o.userData.taken = false;
    o.visible = true;
    o.position.set(o.userData.ix, o.userData.iy, o.userData.iz);
    o.userData.baseY = o.userData.iy;
  }
  for (const a of animals) {
    a.userData.taken = false;
    a.userData.fade = 0;
    a.visible = true;
    a.scale.setScalar(1);
    a.rotation.set(0, a.rotation.y, 0);
    a.position.set(a.position.x, a.userData.baseY, a.position.z);
  }
  state.x = 0;
  state.prevX = 0;
  state.z = 0;
  state.y = terrainY(0);
  state.vz = 0;
  state.speed = 10;
  state.vy = 0;
  state.air = false;
  state.score = 0;
  state.buddies = 0;
  state.distance = 0;
  state.spin = 0;
  state.boost = 1;
  state.steer = 0;
  state.dead = false;
  state.deadT = 0;
  state.squash = 0;
  state.fx.boost = 0;
  state.fx.glide = 0;
  state.fx.magnet = 0;
  state.fx.invuln = 0;

  keys.left = keys.right = keys.boost = false;
  keys.flipKey = false;
  touchHold = false;
  syncFlip();

  skier.scale.setScalar(1.06);
  skier.rotation.set(0, 0, 0);
  skier.position.set(0, terrainY(0), 0);
  camPos.set(-11, terrainY(0) + 6, 0);
  camLook.set(14, terrainY(0) + 2, 0);
  hideChip();
}

// ===================== 更新：粒子 =====================
const puffs = [];
function spawnPuff(x, y, z) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xffffff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85, fog: false,
  }));
  s.position.set(x + (Math.random() - 0.5) * 1.2, y + 0.2, z + (Math.random() - 0.5) * 1.2);
  s.scale.setScalar(1);
  s.userData.life = 0.55;
  scene.add(s);
  puffs.push(s);
}
function updatePuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.userData.life -= dt;
    p.position.y += dt * 1.4;
    p.position.x -= dt * 2.4;
    p.material.opacity = Math.max(0, p.userData.life * 1.5);
    p.scale.setScalar(1 + (0.55 - p.userData.life) * 5.5);
    if (p.userData.life <= 0) {
      scene.remove(p);
      p.material.dispose();
      puffs.splice(i, 1);
    }
  }
}

// ===================== 彩色光点爆发（碰到小动物 / 完美落地） =====================
const sparks = [];
function spawnBurst(x, y, z, color, n) {
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95, fog: false,
    }));
    s.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2;
    const r = 2.4 + Math.random() * 4.2;
    s.scale.setScalar(0.5 + Math.random() * 0.5);
    s.userData = {
      life: 0.75 + Math.random() * 0.35,
      max: 1.1,
      vx: Math.cos(a) * r,
      vy: 1.6 + Math.random() * 3.6,
      vz: Math.sin(a) * r,
    };
    scene.add(s);
    sparks.push(s);
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    const u = s.userData;
    u.life -= dt;
    u.vy -= 6 * dt;
    s.position.x += u.vx * dt;
    s.position.y += u.vy * dt;
    s.position.z += u.vz * dt;
    u.vx *= Math.pow(0.12, dt);
    u.vz *= Math.pow(0.12, dt);
    s.material.opacity = Math.max(0, u.life / u.max) * 0.95;
    s.scale.setScalar(0.4 + (1 - u.life / u.max) * 0.9);
    if (u.life <= 0) {
      scene.remove(s);
      s.material.dispose();
      sparks.splice(i, 1);
    }
  }
}

// ===================== 收集光点 =====================
function updateOrbs(dt, t) {
  const magnet = state.fx.magnet > 0;
  for (const o of orbs) {
    if (o.userData.taken) continue;
    o.position.y = o.userData.baseY + Math.sin(t * 1.8 + o.userData.phase) * 0.38;

    if (magnet && state.started) {
      const dx = state.x - o.position.x;
      const dz = state.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 900) {
        // 被小狐叼着往身边飞
        const k = Math.min(1, dt * 4.5);
        o.position.x += dx * k;
        o.position.z += dz * k;
        o.userData.baseY += ((state.y + 1.2) - o.userData.baseY) * k;
      }
    }

    const pulse = 1 + Math.sin(t * 2.6 + o.userData.phase) * 0.11;
    o.scale.setScalar(o.userData.baseScale * pulse);

    if (!state.started || state.dead) continue;
    const dx = o.position.x - state.x;
    const dy = o.position.y - (state.y + 1.1);
    const dz = o.position.z - state.z;
    if (dx * dx + dy * dy + dz * dz < (magnet ? 14 : 7.5)) {
      o.userData.taken = true;
      o.visible = false;
      state.score++;
      sfxPickup();
      spawnBurst(o.position.x, o.position.y, o.position.z, 0xfff2d2, 4);
    }
  }
}

function updateSnow(dt) {
  const arr = snowGeo.attributes.position.array;
  const cx = camPos.x, cy = camPos.y, cz = camPos.z;
  const flow = state.started ? state.speed * 0.42 + 4 : 2;
  for (let i = 0; i < SNOW_N; i++) {
    arr[i * 3] -= flow * dt;
    arr[i * 3 + 1] -= dt * (1.2 + (i % 7) * 0.2);
    if (arr[i * 3] < cx - 34 || arr[i * 3 + 1] < cy - 14) {
      arr[i * 3] = cx + 20 + Math.random() * 65;
      arr[i * 3 + 1] = cy - 8 + Math.random() * 30;
      arr[i * 3 + 2] = cz + (Math.random() - 0.5) * 66;
    }
    if (Math.abs(arr[i * 3 + 2] - cz) > 34) arr[i * 3 + 2] = cz + (Math.random() - 0.5) * 66;
  }
  snowGeo.attributes.position.needsUpdate = true;
}

// ===================== 更新：相机（第三人称越肩） =====================
function updateCamera(dt) {
  const camClose = location.search.includes('cam=close');
  const spd = state.started && !state.dead ? state.speed : 8;
  const deadK = state.dead ? Math.min(1, state.deadT * 1.1) : 0;
  const back = (camClose ? 3.6 : 9.2 + spd * 0.070) + (state.air ? 0.8 : 0) + deadK * 3.4;
  const up = (camClose ? 1.9 : 4.9 + spd * 0.030) + deadK * 1.5;

  const tx = state.x - back;
  const ty = state.y + up;
  const tz = state.z * 0.62;

  const k = 1 - Math.pow(0.0015, dt);
  camPos.x += (tx - camPos.x) * k;
  camPos.y += (ty - camPos.y) * k;
  camPos.z += (tz - camPos.z) * k;

  // 视线目标：角色前方，稍微高一点看路
  const lx = state.x + 14 + spd * 0.20;
  const ly = state.y + 0.8 - deadK * 0.5;
  const lz = state.z * 0.85;
  const lk = 1 - Math.pow(0.004, dt);
  camLook.x += (lx - camLook.x) * lk;
  camLook.y += (ly - camLook.y) * lk;
  camLook.z += (lz - camLook.z) * lk;

  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // 速度带来的视野扩张（摔倒时轻轻收窄）
  const targetFov = 60 + Math.min(14, spd * 0.26) - deadK * 4;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 1.6);
  camera.updateProjectionMatrix();

  // 天空/星跟随
  skyDome.position.copy(camPos);
  stars.position.copy(camPos);

  // 远山跟随（保持永远在正前方）
  for (const r of ridgeLayers) {
    r.position.x = camPos.x + r.userData.dist;
    r.position.y = camPos.y * 0.72 - 34;
  }
}

// ===================== 天色 =====================
const PHASES = [
  { t: 0.00, top: 0x3b3768, mid: 0x8a5c72, bot: 0xf0a877 },
  { t: 0.42, top: 0x232a5c, mid: 0x4a3a6a, bot: 0xa06a80 },
  { t: 0.72, top: 0x0e1533, mid: 0x1b2b52, bot: 0x40547e },
  { t: 1.00, top: 0x081f33, mid: 0x0d4450, bot: 0x2f6d66 },
];
const cA = new THREE.Color();
const cB = new THREE.Color();
const cC = new THREE.Color();
const cD = new THREE.Color();

function updateSky(t) {
  const p = Math.min(1, state.distance / DIST_FULL);
  let i = 0;
  while (i < PHASES.length - 2 && p > PHASES[i + 1].t) i++;
  const a = PHASES[i], b = PHASES[i + 1] || PHASES[i];
  const span = Math.max(0.0001, b.t - a.t);
  const f = Math.min(1, Math.max(0, (p - a.t) / span));

  skyUniforms.uTop.value.copy(cA.setHex(a.top)).lerp(cB.setHex(b.top), f);
  skyUniforms.uMid.value.copy(cA.setHex(a.mid)).lerp(cB.setHex(b.mid), f);
  skyUniforms.uBot.value.copy(cA.setHex(a.bot)).lerp(cB.setHex(b.bot), f);

  const night = Math.min(1, Math.max(0, (p - 0.22) / 0.46));
  const aurora = Math.min(1, Math.max(0, (p - 0.72) / 0.28));
  skyUniforms.uNight.value = night;
  skyUniforms.uAurora.value = aurora;
  skyUniforms.uTime.value = t;
  starMat.opacity = Math.pow(night, 0.8) * 0.95;

  // 雾色跟天空下缘同步
  scene.fog.color.copy(cC.copy(skyUniforms.uBot.value).lerp(skyUniforms.uMid.value, 0.35));

  // 远山
  for (const r of ridgeLayers) {
    const cols = r.userData.cols;
    cC.copy(cA.setHex(cols[0])).lerp(cB.setHex(cols[1]), night);
    if (aurora > 0) cC.lerp(cD.setHex(cols[2]), aurora * 0.85);
    r.material.color.copy(cC);
  }

  // 雪
  cC.copy(cA.setHex(0xffffff)).lerp(cB.setHex(0xb2c6ec), night);
  if (aurora > 0) cC.lerp(cD.setHex(0xaddfd6), aurora * 0.75);
  if (snowTintMat) snowTintMat.color.copy(cC);

  // 星与雪粒在夜里更亮
  snowMat.opacity = 0.42 + night * 0.28;
}

// ===================== UI =====================
let uiAcc = 0;
function updateUI(dt) {
  uiAcc += dt;
  if (uiAcc < 0.07) return;
  uiAcc = 0;

  distEl.textContent = String(Math.max(0, Math.floor(state.distance)));
  const kmh = Math.round(state.speed * 3.6);
  speedEl.textContent = String(kmh);
  speedFillEl.style.height = Math.min(100, (state.speed / 62) * 100) + '%';
  orbsEl.textContent = String(state.score);
  scoreEl.textContent = String(state.buddies);
  phaseFillEl.style.width = (Math.min(1, state.distance / DIST_FULL) * 100) + '%';
  boostFillEl.style.width = (state.boost * 100) + '%';
  boostWrapEl.classList.toggle('low', state.boost < 0.25);
}

// ===================== 主循环 =====================
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (state.dead) {
    updateDead(dt, elapsed);
  } else if (state.started) {
    updateSkier(dt, elapsed);
    updateOrbs(dt, elapsed);
    updateAnimals(dt, elapsed);
    if (audio.ready && audio.windGain) {
      const target = 0.010 + Math.min(0.055, state.speed * 0.0016);
      audio.windGain.gain.value += (target - audio.windGain.gain.value) * Math.min(1, dt * 2);
    }
  } else {
    skier.position.y = terrainY(0) + Math.sin(elapsed * 1.1) * 0.05;
    skier.rotation.z = Math.sin(elapsed * 0.7) * 0.02;
    updateAnimals(dt, elapsed);
  }

  updatePuffs(dt);
  updateSparks(dt);
  updateSnow(dt);
  updateCamera(dt);
  updateSky(elapsed);
  updateUI(dt);

  renderer.render(scene, camera);
}
animate();

// ===================== 自适应 =====================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
