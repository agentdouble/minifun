import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const overlay = document.getElementById("overlay");
const playButton = document.getElementById("play");
const healthEl = document.getElementById("health");
const weaponEl = document.getElementById("weapon");
const ammoEl = document.getElementById("ammo");
const scoreboardEl = document.getElementById("scoreboard");
const feedEl = document.getElementById("feed");
const hitmarkerEl = document.getElementById("hitmarker");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const canvas = renderer.domElement;
document.body.appendChild(canvas);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 15, 6);
scene.add(dirLight);

const viewModel = createViewModel();
camera.add(viewModel.group);
scene.add(camera);

const groundGeometry = new THREE.PlaneGeometry(120, 120);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x1b212e });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(120, 60, 0x3b4355, 0x222735);
scene.add(grid);

const PLAYER_RADIUS = 0.45;
const EYE_HEIGHT = 1.6;

const player = {
  position: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  pitch: 0,
  onGround: false
};

const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  firing: false
};

function resetInput() {
  input.forward = false;
  input.back = false;
  input.left = false;
  input.right = false;
  input.jump = false;
  input.sprint = false;
  input.firing = false;
}

const MOVEMENT = {
  walkSpeed: 6,
  sprintSpeed: 9,
  accel: 18,
  airAccel: 6,
  friction: 10,
  gravity: 26,
  jumpVelocity: 8.5
};

const remotePlayers = new Map();
const effects = [];
const tracerGeometry = new THREE.CylinderGeometry(0.03, 0.015, 1, 6, 1, true);
const impactGeometry = new THREE.SphereGeometry(0.12, 8, 8);
const muzzleGeometry = new THREE.SphereGeometry(0.14, 8, 8);
const upVector = new THREE.Vector3(0, 1, 0);
const targetNormalAxis = new THREE.Vector3(0, 0, 1);
const baseTargetFaceMaterial = new THREE.MeshStandardMaterial({
  color: 0xe9eef5,
  roughness: 0.4,
  metalness: 0.1,
  emissive: new THREE.Color(0x10141d),
  side: THREE.DoubleSide
});
const baseTargetCoreMaterial = new THREE.MeshStandardMaterial({
  color: 0xff6b6b,
  roughness: 0.3,
  metalness: 0.2,
  emissive: new THREE.Color(0x3a0f0f),
  side: THREE.DoubleSide
});
const baseTargetPoleMaterial = new THREE.MeshStandardMaterial({
  color: 0x2a2f3b,
  roughness: 0.8,
  metalness: 0.1
});
const VIEW_MODEL_PROFILES = {
  pistol: {
    bodyScaleZ: 0.75,
    barrelScaleZ: 0.6,
    barrelOffsetZ: -0.38,
    offset: { x: 0.42, y: -0.33, z: -0.68 }
  },
  rifle: {
    bodyScaleZ: 1.15,
    barrelScaleZ: 1.35,
    barrelOffsetZ: -0.62,
    offset: { x: 0.46, y: -0.36, z: -0.95 }
  },
  shotgun: {
    bodyScaleZ: 1.25,
    barrelScaleZ: 1.05,
    barrelOffsetZ: -0.55,
    offset: { x: 0.45, y: -0.38, z: -0.9 }
  }
};
let obstacles = [];
let targets = new Map();
let mapBounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };

let socket;
let localId = null;
let weapons = {};
let currentWeapon = "rifle";
let weaponState = {};
let lastFrame = performance.now();
let lastStateSent = 0;
let connected = false;
let localDead = false;
let hasSpawned = false;

function initSocket() {
  socket = new WebSocket(`ws://${window.location.host}`);

  socket.addEventListener("open", () => {
    connected = true;
  });

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "welcome") {
      localId = msg.id;
      weapons = msg.weapons;
      setupWeaponState();
      if (msg.map) {
        mapBounds = msg.map.bounds;
        buildMap(msg.map);
      }
      if (Array.isArray(msg.players)) {
        updatePlayers(msg.players);
      }
    }

    if (msg.type === "player_join" && msg.player) {
      if (!localId || msg.player.id === localId) {
        return;
      }
      ensureRemotePlayer(msg.player);
    }

    if (msg.type === "player_leave") {
      removeRemotePlayer(msg.id);
    }

    if (msg.type === "state" && Array.isArray(msg.players)) {
      updatePlayers(msg.players);
    }

    if (msg.type === "shot") {
      renderShot(msg);
    }

    if (msg.type === "death") {
      const killer = msg.killerId === localId ? "Toi" : `Joueur ${msg.killerId}`;
      const victim = msg.id === localId ? "Toi" : `Joueur ${msg.id}`;
      pushFeed(`${killer} a elimine ${victim}`);
    }
  });

  socket.addEventListener("close", () => {
    connected = false;
  });
}

function setupWeaponState() {
  weaponState = {};
  for (const [key, weapon] of Object.entries(weapons)) {
    weaponState[key] = {
      ammo: weapon.magazine,
      reloadEnd: 0,
      lastShotAt: 0
    };
  }
}

function buildMap(map) {
  obstacles.forEach((entry) => scene.remove(entry.mesh));
  obstacles = [];
  targets.forEach((entry) => {
    if (entry.hitTimer) {
      clearTimeout(entry.hitTimer);
    }
    for (const mesh of entry.meshes) {
      scene.remove(mesh);
    }
  });
  targets.clear();

  for (const obstacle of map.obstacles || []) {
    const geometry = new THREE.BoxGeometry(obstacle.size.x, obstacle.size.y, obstacle.size.z);
    const material = new THREE.MeshStandardMaterial({ color: 0x3a4252 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
    scene.add(mesh);

    const half = {
      x: obstacle.size.x / 2,
      y: obstacle.size.y / 2,
      z: obstacle.size.z / 2
    };

    obstacles.push({
      mesh,
      min: {
        x: obstacle.position.x - half.x,
        y: obstacle.position.y - half.y,
        z: obstacle.position.z - half.z
      },
      max: {
        x: obstacle.position.x + half.x,
        y: obstacle.position.y + half.y,
        z: obstacle.position.z + half.z
      }
    });
  }

  for (const target of map.targets || []) {
    const entry = createTargetMesh(target);
    for (const mesh of entry.meshes) {
      scene.add(mesh);
    }
    targets.set(target.id, entry);
  }
}

function createTargetMesh(target) {
  const radius = typeof target.radius === "number" ? target.radius : 0.5;
  const position = new THREE.Vector3(target.position.x, target.position.y, target.position.z);
  const center = new THREE.Vector3(0, target.position.y, 0);
  const normal = new THREE.Vector3().subVectors(center, position);
  if (normal.lengthSq() < 1e-6) {
    normal.set(0, 0, 1);
  } else {
    normal.normalize();
  }
  const orientation = new THREE.Quaternion().setFromUnitVectors(targetNormalAxis, normal);

  const faceMaterial = baseTargetFaceMaterial.clone();
  const coreMaterial = baseTargetCoreMaterial.clone();
  const poleMaterial = baseTargetPoleMaterial.clone();

  const face = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), faceMaterial);
  face.position.copy(position);
  face.quaternion.copy(orientation);

  const core = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.45, 20), coreMaterial);
  core.position.copy(position).add(normal.clone().multiplyScalar(0.02));
  core.quaternion.copy(orientation);

  const poleHeight = Math.max(0.25, target.position.y - radius);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, poleHeight, 10), poleMaterial);
  pole.position.set(target.position.x, poleHeight / 2, target.position.z);

  return {
    meshes: [pole, face, core],
    faceMaterial,
    coreMaterial,
    baseFaceColor: faceMaterial.color.clone(),
    baseCoreColor: coreMaterial.color.clone(),
    hitTimer: null
  };
}

function ensureRemotePlayer(data) {
  if (remotePlayers.has(data.id)) {
    return;
  }
  const color = new THREE.Color().setHSL((Number(data.id) * 0.17) % 1, 0.6, 0.5);
  const mesh = createPlayerMesh(color);
  scene.add(mesh);
  remotePlayers.set(data.id, {
    mesh,
    targetPosition: new THREE.Vector3(),
    targetYaw: 0,
    health: data.health || 100,
    dead: false,
    name: data.name || `Joueur ${data.id}`
  });
}

function removeRemotePlayer(id) {
  const entry = remotePlayers.get(id);
  if (!entry) {
    return;
  }
  scene.remove(entry.mesh);
  remotePlayers.delete(id);
}

function updatePlayers(players) {
  const activeIds = new Set();
  for (const p of players) {
    activeIds.add(p.id);
    if (p.id === localId) {
      updateLocalState(p);
      continue;
    }
    ensureRemotePlayer(p);
    const entry = remotePlayers.get(p.id);
    entry.targetPosition.set(p.position.x, p.position.y, p.position.z);
    entry.targetYaw = p.yaw || 0;
    entry.health = p.health;
    entry.dead = p.dead;
    entry.mesh.visible = !p.dead;
  }

  for (const [id] of remotePlayers.entries()) {
    if (!activeIds.has(id)) {
      removeRemotePlayer(id);
    }
  }

  updateScoreboard(players);
}

function updateLocalState(state) {
  if (typeof state.health === "number") {
    healthEl.textContent = `${Math.max(0, Math.round(state.health))} PV`;
  }
  if (typeof state.dead === "boolean") {
    if (state.dead && !localDead) {
      localDead = true;
    }
    if (!state.dead && localDead) {
      localDead = false;
      if (state.position) {
        player.position.set(state.position.x, state.position.y, state.position.z);
        player.velocity.set(0, 0, 0);
      }
    }
  }
  if (!hasSpawned && state.position) {
    player.position.set(state.position.x, state.position.y, state.position.z);
    hasSpawned = true;
  }
}

function updateScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  scoreboardEl.innerHTML = "";
  for (const playerEntry of sorted) {
    const row = document.createElement("div");
    const name = playerEntry.id === localId ? "Toi" : playerEntry.name;
    row.innerHTML = `<span>${name}</span><span>${playerEntry.kills} / ${playerEntry.deaths}</span>`;
    scoreboardEl.appendChild(row);
  }
}

function createViewModel() {
  const group = new THREE.Group();
  group.position.set(0.46, -0.36, -0.95);
  group.rotation.set(-0.08, 0.05, 0);

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d3446,
    roughness: 0.4,
    metalness: 0.4,
    emissive: new THREE.Color(0x0c101a)
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0xf7c944,
    roughness: 0.3,
    metalness: 0.7,
    emissive: new THREE.Color(0x1e1606)
  });
  baseMaterial.depthTest = false;
  baseMaterial.depthWrite = false;
  accentMaterial.depthTest = false;
  accentMaterial.depthWrite = false;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.5), baseMaterial);
  body.position.set(0, 0, -0.1);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), accentMaterial);
  barrel.position.set(0, 0.02, -0.45);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.16), baseMaterial);
  grip.position.set(0, -0.15, 0.06);

  group.add(body, barrel, grip);
  group.renderOrder = 10;

  const light = new THREE.PointLight(0xfff1b2, 0.6, 2);
  light.position.set(0.2, 0.1, 0.2);
  group.add(light);

  return { group, body, barrel, grip };
}

function updateViewModelForWeapon(weaponKey) {
  const profile = VIEW_MODEL_PROFILES[weaponKey] || VIEW_MODEL_PROFILES.rifle;
  viewModel.group.position.set(profile.offset.x, profile.offset.y, profile.offset.z);
  viewModel.body.scale.set(1, 1, profile.bodyScaleZ);
  viewModel.barrel.scale.set(1, 1, profile.barrelScaleZ);
  viewModel.barrel.position.z = profile.barrelOffsetZ;
}

function createPlayerMesh(color) {
  const group = new THREE.Group();

  const bodyGeometry = new THREE.CylinderGeometry(0.45, 0.45, 1.3, 12);
  const headGeometry = new THREE.SphereGeometry(0.25, 14, 14);
  const accentGeometry = new THREE.BoxGeometry(0.18, 0.18, 0.4);

  const bodyMaterial = new THREE.MeshStandardMaterial({ color });
  const headMaterial = new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, -0.1, 0.2) });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x131722 });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.65;
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 1.55;
  const accent = new THREE.Mesh(accentGeometry, accentMaterial);
  accent.position.set(0, 1.4, 0.45);

  group.add(body, head, accent);
  return group;
}

function pushFeed(text) {
  const line = document.createElement("div");
  line.textContent = text;
  feedEl.appendChild(line);
  setTimeout(() => {
    line.remove();
  }, 4000);
}

function showHitmarker() {
  hitmarkerEl.classList.add("active");
  setTimeout(() => hitmarkerEl.classList.remove("active"), 150);
}

function flashTarget(targetId) {
  const entry = targets.get(targetId);
  if (!entry) {
    return;
  }
  entry.faceMaterial.color.set(0xfff1b2);
  entry.coreMaterial.color.set(0xffffff);
  if (entry.hitTimer) {
    clearTimeout(entry.hitTimer);
  }
  entry.hitTimer = setTimeout(() => {
    entry.faceMaterial.color.copy(entry.baseFaceColor);
    entry.coreMaterial.color.copy(entry.baseCoreColor);
    entry.hitTimer = null;
  }, 160);
}

function getRightVector(direction) {
  const right = new THREE.Vector3().crossVectors(direction, upVector);
  if (right.lengthSq() < 1e-6) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }
  return right;
}

function spawnMuzzleFlash(origin, dir, options = {}) {
  const normalized = dir.clone();
  if (normalized.lengthSq() < 1e-6) {
    return;
  }
  normalized.normalize();
  const right = getRightVector(normalized);
  const sideOffset = options.sideOffset || 0;
  const muzzleOffset = options.muzzleOffset || 0.35;
  const position = origin
    .clone()
    .add(right.multiplyScalar(sideOffset))
    .add(normalized.clone().multiplyScalar(muzzleOffset));
  const material = new THREE.MeshBasicMaterial({
    color: 0xfff1b2,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(muzzleGeometry, material);
  mesh.position.copy(position);
  scene.add(mesh);
  effects.push({ object: mesh, life: 0.08, maxLife: 0.08, shrink: true });
}

function renderShot(msg) {
  const origin = new THREE.Vector3(msg.origin.x, msg.origin.y, msg.origin.z);
  const isLocal = msg.shooterId === localId;
  const traces = msg.traces || [];
  if (traces.length > 0) {
    const baseDir = new THREE.Vector3(
      traces[0].dir.x,
      traces[0].dir.y,
      traces[0].dir.z
    );
    spawnMuzzleFlash(origin, baseDir, {
      muzzleOffset: 0.35,
      sideOffset: isLocal ? 0.06 : 0
    });
  }
  for (const trace of traces) {
    const dir = new THREE.Vector3(trace.dir.x, trace.dir.y, trace.dir.z);
    const distance = typeof trace.distance === "number" ? trace.distance : 0;
    spawnTracer(origin, dir, distance, {
      muzzleOffset: 0.35,
      sideOffset: isLocal ? 0.06 : 0,
      maxLength: isLocal ? 8 : distance
    });
    if (trace.impact) {
      const end = origin.clone().add(dir.clone().multiplyScalar(distance));
      spawnImpact(end, trace.impact.type);
      if (trace.impact.type === "target" && trace.impact.targetId) {
        flashTarget(trace.impact.targetId);
      }
    }
  }

  if (msg.shooterId === localId && msg.hits && msg.hits.length > 0) {
    showHitmarker();
  }
}

function spawnTracer(origin, dir, distance, options = {}) {
  const normalized = dir.clone();
  if (normalized.lengthSq() < 1e-6) {
    return;
  }
  normalized.normalize();
  const muzzleOffset = options.muzzleOffset || 0.35;
  const maxLength = typeof options.maxLength === "number" ? options.maxLength : distance;
  const available = Math.max(0.05, distance - muzzleOffset);
  const length = Math.max(0.3, Math.min(available, maxLength));
  const right = getRightVector(normalized);
  const sideOffset = options.sideOffset || 0;
  const offsetOrigin = origin.clone().add(right.multiplyScalar(sideOffset));
  const start = offsetOrigin.clone().add(normalized.clone().multiplyScalar(muzzleOffset));
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd28a,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(tracerGeometry, material);
  mesh.scale.set(1, length, 1);
  const midpoint = start.clone().add(normalized.clone().multiplyScalar(length / 2));
  mesh.position.copy(midpoint);
  mesh.quaternion.setFromUnitVectors(upVector, normalized);
  scene.add(mesh);
  effects.push({ object: mesh, life: 0.2, maxLife: 0.2 });
}

function spawnImpact(position, type) {
  const color =
    type === "player" ? 0xff6b6b : type === "target" ? 0x7ce7ff : 0xf7c944;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(impactGeometry, material);
  mesh.position.copy(position);
  scene.add(mesh);
  effects.push({ object: mesh, life: 0.2, maxLife: 0.2, shrink: true });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    effect.life -= dt;
    if (effect.shrink) {
      const scale = Math.max(0.2, effect.life / effect.maxLife);
      effect.object.scale.setScalar(scale);
    }
    if (effect.object.material) {
      effect.object.material.opacity = Math.max(0, effect.life / effect.maxLife);
    }
    if (effect.life <= 0) {
      scene.remove(effect.object);
      if (effect.object.material) {
        effect.object.material.dispose();
      }
      effects.splice(i, 1);
    }
  }
}

function applyFriction(dt) {
  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  if (speed < 0.001) {
    return;
  }
  const drop = speed * MOVEMENT.friction * dt;
  const newSpeed = Math.max(0, speed - drop);
  const ratio = newSpeed / speed;
  player.velocity.x *= ratio;
  player.velocity.z *= ratio;
}

function accelerate(wishDir, wishSpeed, accel, dt) {
  const currentSpeed = player.velocity.dot(wishDir);
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) {
    return;
  }
  const accelSpeed = Math.min(addSpeed, accel * wishSpeed * dt);
  player.velocity.addScaledVector(wishDir, accelSpeed);
}

function resolveCollisions() {
  for (const obstacle of obstacles) {
    if (player.position.y > obstacle.max.y + 0.5) {
      continue;
    }
    const nearestX = Math.max(obstacle.min.x, Math.min(player.position.x, obstacle.max.x));
    const nearestZ = Math.max(obstacle.min.z, Math.min(player.position.z, obstacle.max.z));
    const dx = player.position.x - nearestX;
    const dz = player.position.z - nearestZ;
    const distSq = dx * dx + dz * dz;
    const radiusSq = PLAYER_RADIUS * PLAYER_RADIUS;

    if (distSq < radiusSq) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const push = PLAYER_RADIUS - dist;
      const nx = dx / dist;
      const nz = dz / dist;
      player.position.x += nx * push;
      player.position.z += nz * push;

      const dot = player.velocity.x * nx + player.velocity.z * nz;
      if (dot < 0) {
        player.velocity.x -= dot * nx;
        player.velocity.z -= dot * nz;
      }
    }
  }
}

function clampPositionToBounds() {
  player.position.x = Math.max(mapBounds.minX, Math.min(mapBounds.maxX, player.position.x));
  player.position.z = Math.max(mapBounds.minZ, Math.min(mapBounds.maxZ, player.position.z));
}

function updateMovement(dt) {
  if (localDead) {
    player.velocity.set(0, 0, 0);
    camera.position.set(
      player.position.x,
      player.position.y + EYE_HEIGHT,
      player.position.z
    );
    camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
    return;
  }
  if (document.pointerLockElement !== canvas) {
    player.velocity.set(0, 0, 0);
    camera.position.set(
      player.position.x,
      player.position.y + EYE_HEIGHT,
      player.position.z
    );
    camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
    return;
  }
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const wishDir = new THREE.Vector3();

  if (input.forward) wishDir.add(forward);
  if (input.back) wishDir.sub(forward);
  if (input.right) wishDir.add(right);
  if (input.left) wishDir.sub(right);

  if (wishDir.lengthSq() > 0) {
    wishDir.normalize();
  }

  const maxSpeed = input.sprint ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed;

  if (player.onGround) {
    applyFriction(dt);
    accelerate(wishDir, maxSpeed, MOVEMENT.accel, dt);
  } else {
    accelerate(wishDir, maxSpeed, MOVEMENT.airAccel, dt);
  }

  player.velocity.y -= MOVEMENT.gravity * dt;

  if (input.jump && player.onGround) {
    player.velocity.y = MOVEMENT.jumpVelocity;
    player.onGround = false;
  }

  player.position.addScaledVector(player.velocity, dt);

  if (player.position.y <= 0) {
    player.position.y = 0;
    player.velocity.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  resolveCollisions();
  clampPositionToBounds();

  camera.position.set(
    player.position.x,
    player.position.y + EYE_HEIGHT,
    player.position.z
  );
  camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
}

function updateRemotePlayers(dt) {
  for (const entry of remotePlayers.values()) {
    entry.mesh.position.lerp(entry.targetPosition, 0.2);
    entry.mesh.rotation.y = entry.targetYaw;
  }
}

function updateWeaponHUD() {
  const weapon = weapons[currentWeapon];
  if (!weapon) {
    return;
  }
  const state = weaponState[currentWeapon];
  weaponEl.textContent = weapon.label.toUpperCase();
  const reloading = state.reloadEnd > performance.now();
  ammoEl.textContent = reloading
    ? "RECHARGEMENT"
    : `${state.ammo} / ${weapon.magazine}`;
}

function beginReload(now) {
  const weapon = weapons[currentWeapon];
  const state = weaponState[currentWeapon];
  if (!weapon || !state) {
    return;
  }
  if (state.reloadEnd > now || state.ammo === weapon.magazine) {
    return;
  }
  state.reloadEnd = now + weapon.reloadTime * 1000;
}

function updateWeapon(now) {
  const weapon = weapons[currentWeapon];
  const state = weaponState[currentWeapon];
  if (!weapon || !state) {
    return;
  }
  if (document.pointerLockElement !== canvas) {
    updateWeaponHUD();
    return;
  }
  if (localDead) {
    updateWeaponHUD();
    return;
  }

  if (state.reloadEnd && now >= state.reloadEnd) {
    state.ammo = weapon.magazine;
    state.reloadEnd = 0;
  }

  if (input.firing) {
    tryShoot(now);
  }

  updateWeaponHUD();
}

function tryShoot(now) {
  const weapon = weapons[currentWeapon];
  const state = weaponState[currentWeapon];
  if (!weapon || !state || state.reloadEnd) {
    return;
  }

  if (state.ammo <= 0) {
    beginReload(now);
    return;
  }

  const fireInterval = weapon.fireRate * 1000;
  if (now - state.lastShotAt < fireInterval) {
    return;
  }

  state.lastShotAt = now;
  state.ammo -= 1;

  if (connected) {
    socket.send(JSON.stringify({ type: "shoot" }));
  }
}

function sendState(now) {
  if (!connected || !localId || localDead) {
    return;
  }
  if (now - lastStateSent < 50) {
    return;
  }
  lastStateSent = now;
  socket.send(
    JSON.stringify({
      type: "state",
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      yaw: player.yaw,
      pitch: player.pitch,
      weapon: currentWeapon
    })
  );
}

function animate(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  updateMovement(dt);
  updateWeapon(now);
  updateRemotePlayers(dt);
  updateEffects(dt);
  sendState(now);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function handlePointerLockChange() {
  const locked = document.pointerLockElement === canvas;
  overlay.classList.toggle("hidden", locked);
  if (!locked) {
    resetInput();
  }
}

function matchesKey(event, keys, codes) {
  const key = event.key ? event.key.toLowerCase() : "";
  return keys.includes(key) || codes.includes(event.code);
}

function connectControls() {
  playButton.addEventListener("click", () => {
    canvas.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", handlePointerLockChange);

  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas) {
      return;
    }
    player.yaw -= event.movementX * 0.002;
    player.pitch -= event.movementY * 0.002;
    player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch));
  });

  window.addEventListener("mousedown", (event) => {
    if (event.button === 0 && document.pointerLockElement === canvas) {
      input.firing = true;
    }
  });

  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      input.firing = false;
    }
  });

  window.addEventListener("keydown", (event) => {
    if (matchesKey(event, ["w", "z"], ["KeyW", "KeyZ"])) {
      input.forward = true;
    } else if (matchesKey(event, ["s"], ["KeyS"])) {
      input.back = true;
    } else if (matchesKey(event, ["a", "q"], ["KeyA", "KeyQ"])) {
      input.left = true;
    } else if (matchesKey(event, ["d"], ["KeyD"])) {
      input.right = true;
    }

    switch (event.code) {
      case "ShiftLeft":
      case "ShiftRight":
        input.sprint = true;
        break;
      case "Space":
        input.jump = true;
        break;
      case "Digit1":
        switchWeapon("pistol");
        break;
      case "Digit2":
        switchWeapon("rifle");
        break;
      case "Digit3":
        switchWeapon("shotgun");
        break;
      case "KeyR":
        beginReload(performance.now());
        break;
      default:
        break;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (matchesKey(event, ["w", "z"], ["KeyW", "KeyZ"])) {
      input.forward = false;
    } else if (matchesKey(event, ["s"], ["KeyS"])) {
      input.back = false;
    } else if (matchesKey(event, ["a", "q"], ["KeyA", "KeyQ"])) {
      input.left = false;
    } else if (matchesKey(event, ["d"], ["KeyD"])) {
      input.right = false;
    }

    switch (event.code) {
      case "ShiftLeft":
      case "ShiftRight":
        input.sprint = false;
        break;
      case "Space":
        input.jump = false;
        break;
      default:
        break;
    }
  });
}

function switchWeapon(weaponKey) {
  if (!weapons[weaponKey]) {
    return;
  }
  currentWeapon = weaponKey;
  updateWeaponHUD();
  updateViewModelForWeapon(weaponKey);
  if (connected) {
    socket.send(JSON.stringify({ type: "switch_weapon", weapon: weaponKey }));
  }
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", handleResize);

initSocket();
connectControls();
updateWeaponHUD();
updateViewModelForWeapon(currentWeapon);
requestAnimationFrame(animate);
