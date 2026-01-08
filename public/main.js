import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const overlay = document.getElementById("overlay");
const playButton = document.getElementById("play");
const healthEl = document.getElementById("health");
const weaponEl = document.getElementById("weapon");
const ammoEl = document.getElementById("ammo");
const scoreboardEl = document.getElementById("scoreboard");
const feedEl = document.getElementById("feed");
const hitmarkerEl = document.getElementById("hitmarker");
const crosshairEl = document.getElementById("crosshair");
const scopeEl = document.getElementById("scope");
const flashEl = document.getElementById("flash");
const flashStatusEl = document.getElementById("flash-status");
const nameInput = document.getElementById("player-name");
const sensitivityInput = document.getElementById("sensitivity");
const sensitivityValueEl = document.getElementById("sensitivity-value");
const resetSettingsButton = document.getElementById("reset-settings");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250);
const DEFAULT_FOV = camera.fov;
const SCOPE_FOV = 28;
const NAME_STORAGE_KEY = "vz_player_name";
const SENSITIVITY_STORAGE_KEY = "vz_sensitivity";

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

function dampValue(value, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  return THREE.MathUtils.lerp(value, target, t);
}

function applyViewModelTransform() {
  viewModel.group.position.set(
    viewModelBaseOffset.x + recoilState.x,
    viewModelBaseOffset.y + recoilState.y,
    viewModelBaseOffset.z + recoilState.z
  );
}

function addRecoilImpulse(weaponKey) {
  const profile = RECOIL_PROFILES[weaponKey] || RECOIL_PROFILES.rifle;
  recoilState.z = Math.min(profile.maxBack ?? profile.back * 2, recoilState.z + profile.back);
  recoilState.y = Math.min(profile.up * 2.2, recoilState.y + profile.up);
  recoilState.x = THREE.MathUtils.clamp(
    recoilState.x + (Math.random() - 0.5) * profile.side * 2,
    -0.05,
    0.05
  );
  applyViewModelTransform();
}

function updateRecoil(dt) {
  recoilState.x = dampValue(recoilState.x, 0, 22, dt);
  recoilState.y = dampValue(recoilState.y, 0, 22, dt);
  recoilState.z = dampValue(recoilState.z, 0, 18, dt);
  applyViewModelTransform();
}

function getViewModelMuzzleWorldPosition(out) {
  if (!out) {
    out = new THREE.Vector3();
  }
  viewModel.barrel.updateWorldMatrix(true, false);
  return out.copy(viewModelMuzzleLocal).applyMatrix4(viewModel.barrel.matrixWorld);
}

const groundGeometry = new THREE.PlaneGeometry(120, 120);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x1b212e });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(120, 60, 0x3b4355, 0x222735);
scene.add(grid);

const PLAYER_RADIUS = 0.45;
const STEP_HEIGHT = 0.55;
const PLAYER_STANCES = {
  stand: {
    height: 1.8,
    eyeHeight: 1.6,
    speedMultiplier: 1,
    bodyCenter: 0.95,
    headCenter: 1.65
  },
  crouch: {
    height: 1.2,
    eyeHeight: 1.05,
    speedMultiplier: 0.65,
    bodyCenter: 0.8,
    headCenter: 1.25
  },
  prone: {
    height: 0.6,
    eyeHeight: 0.55,
    speedMultiplier: 0.4,
    bodyCenter: 0.45,
    headCenter: 0.65
  }
};
const DEFAULT_STANCE = "stand";
const BASE_PLAYER_HEIGHT = PLAYER_STANCES.stand.height;

const player = {
  position: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  pitch: 0,
  onGround: false,
  stance: DEFAULT_STANCE
};

const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  firing: false,
  crouch: false,
  prone: false
};

function resetInput() {
  input.forward = false;
  input.back = false;
  input.left = false;
  input.right = false;
  input.jump = false;
  input.sprint = false;
  input.firing = false;
  input.crouch = false;
  input.prone = false;
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
const grenades = [];
const tracerGeometry = new THREE.CylinderGeometry(0.03, 0.015, 1, 6, 1, true);
const impactGeometry = new THREE.SphereGeometry(0.12, 8, 8);
const muzzleGeometry = new THREE.SphereGeometry(0.14, 8, 8);
const projectileGeometry = new THREE.SphereGeometry(0.055, 10, 10);
const grenadeGeometry = new THREE.SphereGeometry(0.12, 12, 12);
const grenadeMaterial = new THREE.MeshStandardMaterial({
  color: 0xf7c944,
  roughness: 0.4,
  metalness: 0.15,
  emissive: new THREE.Color(0x2a2108)
});
const upVector = new THREE.Vector3(0, 1, 0);
const targetNormalAxis = new THREE.Vector3(0, 0, 1);
const VIEW_MODEL_RENDER_ORDER = 10;
const EFFECT_RENDER_ORDER = 11;
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
const VIEW_MODEL_DEFAULT_COLORS = {
  base: 0x2d3446,
  accent: 0xf7c944,
  detail: 0xd6dbe6
};

const VIEW_MODEL_PART_DEFAULTS = {
  body: { scale: [1, 1, 1], position: [0, 0, -0.12], rotation: [0, 0, 0] },
  barrel: { scale: [1, 1, 1], position: [0, 0.03, -0.6], rotation: [0, 0, 0] },
  grip: { scale: [1, 1, 1], position: [0, -0.18, 0.08], rotation: [0, 0, 0] },
  stock: { scale: [1, 1, 1], position: [0, -0.02, 0.32], rotation: [0, 0, 0] },
  magazine: { scale: [1, 1, 1], position: [0, -0.26, -0.08], rotation: [0, 0, 0] },
  scope: { scale: [1, 1, 1], position: [0, 0.14, -0.25], rotation: [Math.PI / 2, 0, 0] },
  pump: { scale: [1, 1, 1], position: [0, -0.04, -0.5], rotation: [0, 0, 0] }
};

const VIEW_MODEL_PROFILES = {
  pistol: {
    offset: { x: 0.42, y: -0.33, z: -0.68 },
    colors: { base: 0x323a4d, accent: 0xf7c944, detail: 0xe6e9ef },
    parts: {
      body: { scale: [0.85, 0.85, 0.65], position: [0, 0, -0.06] },
      barrel: { scale: [0.6, 0.6, 0.45], position: [0, 0.03, -0.32] },
      grip: { scale: [0.85, 1.1, 0.9], position: [0, -0.18, 0.1] },
      stock: { visible: false },
      magazine: { visible: false },
      scope: { visible: false },
      pump: { visible: false }
    }
  },
  deagle: {
    offset: { x: 0.43, y: -0.34, z: -0.72 },
    colors: { base: 0x3a2f2a, accent: 0xffb347, detail: 0xd0b49f },
    parts: {
      body: { scale: [1, 0.9, 0.75], position: [0, 0, -0.08] },
      barrel: { scale: [0.75, 0.75, 0.6], position: [0, 0.04, -0.38] },
      grip: { scale: [0.9, 1.15, 0.95], position: [0, -0.19, 0.08] },
      stock: { visible: false },
      magazine: { scale: [0.7, 0.8, 0.6], position: [0, -0.2, 0.02] },
      scope: { visible: false },
      pump: { visible: false }
    }
  },
  rifle: {
    offset: { x: 0.46, y: -0.36, z: -0.95 },
    colors: { base: 0x2d3446, accent: 0x7ce7ff, detail: 0xf7c944 },
    parts: {
      body: { scale: [1.05, 0.95, 1.1] },
      barrel: { scale: [1, 1, 1.35], position: [0, 0.03, -0.7] },
      grip: { scale: [1, 1, 1] },
      stock: { scale: [1, 1, 1], position: [0, -0.04, 0.36] },
      magazine: { scale: [1, 1.2, 1], position: [0, -0.26, -0.08] },
      scope: { scale: [0.8, 0.8, 0.7], position: [0, 0.14, -0.18] },
      pump: { visible: false }
    }
  },
  sniper: {
    offset: { x: 0.5, y: -0.37, z: -1.22 },
    colors: { base: 0x1f2a34, accent: 0x7ddc9d, detail: 0xe0f0ff },
    parts: {
      body: { scale: [1.1, 0.95, 1.2] },
      barrel: { scale: [1.1, 1.1, 2], position: [0, 0.03, -1.0] },
      grip: { scale: [0.95, 1, 1] },
      stock: { scale: [1.2, 1, 1.3], position: [0, -0.05, 0.45] },
      magazine: { scale: [0.9, 1.1, 0.8], position: [0, -0.24, -0.16] },
      scope: { scale: [1.2, 1.2, 1.4], position: [0, 0.16, -0.38] },
      pump: { visible: false }
    }
  },
  shotgun: {
    offset: { x: 0.45, y: -0.38, z: -0.9 },
    colors: { base: 0x3b2f1f, accent: 0xf26d5b, detail: 0xf7c944 },
    parts: {
      body: { scale: [1.05, 1.05, 1] },
      barrel: { scale: [1.2, 1.2, 1.5], position: [0, 0.03, -0.82] },
      grip: { scale: [0.95, 1.1, 0.9] },
      stock: { scale: [1.05, 1.05, 1.1], position: [0, -0.06, 0.36] },
      magazine: { visible: false },
      scope: { visible: false },
      pump: { scale: [1.3, 1, 1.2], position: [0, -0.06, -0.58] }
    }
  }
};
const VIEW_MODEL_BARREL_LENGTH = 0.6;
const viewModelMuzzleLocal = new THREE.Vector3(0, 0, -VIEW_MODEL_BARREL_LENGTH * 0.5);

const viewModel = createViewModel();
camera.add(viewModel.group);
scene.add(camera);

const viewModelBaseOffset = new THREE.Vector3().copy(viewModel.group.position);
const recoilState = { x: 0, y: 0, z: 0 };
const RECOIL_PROFILES = {
  pistol: { back: 0.07, up: 0.025, side: 0.01, maxBack: 0.14 },
  deagle: { back: 0.11, up: 0.04, side: 0.014, maxBack: 0.18 },
  rifle: { back: 0.05, up: 0.018, side: 0.008, maxBack: 0.12 },
  sniper: { back: 0.09, up: 0.03, side: 0.01, maxBack: 0.16 },
  shotgun: { back: 0.12, up: 0.045, side: 0.016, maxBack: 0.2 }
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
let aimHeld = false;
let aiming = false;
let leaderboardHeld = false;
let lastSentName = null;

const LOOK_SENSITIVITY = {
  normal: 0.002,
  scoped: 0.0007
};
const DEFAULT_SENSITIVITY_MULTIPLIER = 1;
let sensitivityMultiplier = 1;

function getDefaultSensitivity() {
  if (!sensitivityInput) {
    return DEFAULT_SENSITIVITY_MULTIPLIER;
  }
  const parsed = parseFloat(sensitivityInput.defaultValue);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SENSITIVITY_MULTIPLIER;
}

function clampSensitivity(value) {
  if (!Number.isFinite(value)) {
    return getDefaultSensitivity();
  }
  const min = sensitivityInput ? parseFloat(sensitivityInput.min) : 0.4;
  const max = sensitivityInput ? parseFloat(sensitivityInput.max) : 3;
  const resolvedMin = Number.isFinite(min) ? min : 0.4;
  const resolvedMax = Number.isFinite(max) ? max : 3;
  return Math.min(resolvedMax, Math.max(resolvedMin, value));
}

function updateSensitivityUI(value) {
  if (sensitivityInput) {
    sensitivityInput.value = value.toFixed(2);
  }
  if (sensitivityValueEl) {
    sensitivityValueEl.textContent = `${value.toFixed(2)}x`;
  }
}

function setSensitivityMultiplier(value, persist = true) {
  const clamped = clampSensitivity(value);
  sensitivityMultiplier = clamped;
  updateSensitivityUI(clamped);
  if (persist) {
    localStorage.setItem(SENSITIVITY_STORAGE_KEY, clamped.toFixed(2));
  }
}

function initSensitivityControls() {
  const stored = parseFloat(localStorage.getItem(SENSITIVITY_STORAGE_KEY));
  if (Number.isFinite(stored)) {
    setSensitivityMultiplier(stored, false);
  } else {
    setSensitivityMultiplier(getDefaultSensitivity(), false);
  }

  if (!sensitivityInput) {
    return;
  }

  sensitivityInput.addEventListener("input", () => {
    setSensitivityMultiplier(parseFloat(sensitivityInput.value));
  });

  if (resetSettingsButton) {
    resetSettingsButton.addEventListener("click", () => {
      setSensitivityMultiplier(getDefaultSensitivity());
    });
  }
}
const FLASH_SETTINGS = {
  maxRadius: 150,
  minHold: 0.15,
  maxHold: 0.8,
  minFade: 0.6,
  maxFade: 2.0,
  throwCooldown: 4500,
  gravity: 26,
  maxChargeMs: 700
};

const flashState = {
  peak: 0,
  holdUntil: 0,
  fadeEnd: 0
};
let lastFlashThrowAt = 0;
const flashThrowState = {
  holding: false,
  holdStart: 0
};

function setAiming(enabled) {
  aiming = enabled;
  if (scopeEl) {
    scopeEl.classList.toggle("active", aiming);
  }
  if (crosshairEl) {
    crosshairEl.classList.toggle("hidden", aiming);
  }
  viewModel.group.visible = !aiming;
  camera.fov = aiming ? SCOPE_FOV : DEFAULT_FOV;
  camera.updateProjectionMatrix();
}

function setLeaderboardVisible(visible) {
  leaderboardHeld = visible;
  if (scoreboardEl) {
    scoreboardEl.classList.toggle("visible", visible);
  }
}

function sanitizePlayerName(raw) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

function getDesiredName() {
  if (!nameInput) {
    return "";
  }
  return sanitizePlayerName(nameInput.value);
}

function persistDesiredName(name) {
  if (!nameInput) {
    return;
  }
  if (name) {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } else {
    localStorage.removeItem(NAME_STORAGE_KEY);
  }
}

function sendNameIfPossible() {
  if (!connected || !socket || socket.readyState !== 1 || !localId) {
    persistDesiredName(getDesiredName());
    return;
  }
  const name = getDesiredName();
  persistDesiredName(name);
  if (name === lastSentName) {
    return;
  }
  socket.send(JSON.stringify({ type: "set_name", name }));
  lastSentName = name;
  if (nameInput) {
    nameInput.value = name;
  }
}

function refreshAiming() {
  const shouldAim =
    aimHeld &&
    currentWeapon === "sniper" &&
    document.pointerLockElement === canvas &&
    !localDead;
  if (shouldAim !== aiming) {
    setAiming(shouldAim);
  }
}

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
      sendNameIfPossible();
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

    if (msg.type === "flash" && msg.origin) {
      const origin = new THREE.Vector3(msg.origin.x, msg.origin.y, msg.origin.z);
      const radius = typeof msg.radius === "number" ? msg.radius : FLASH_SETTINGS.maxRadius;
      const strength = computeFlashStrength(origin, radius);
      triggerFlash(strength);
    }

    if (msg.type === "flash_throw" && msg.origin && msg.velocity) {
      const fuseMs = typeof msg.fuseMs === "number" ? msg.fuseMs : 1200;
      spawnFlashGrenade(msg.origin, msg.velocity, fuseMs);
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

function getSkinKeyFromName(name) {
  if (typeof name !== "string") {
    return "default";
  }
  return name.trim().toLowerCase() === "trebla" ? "diamond" : "default";
}

function ensureRemotePlayer(data) {
  if (!data || typeof data.id !== "string") {
    return null;
  }
  const skinKey = getSkinKeyFromName(data.name);
  const color = new THREE.Color().setHSL((Number(data.id) * 0.17) % 1, 0.6, 0.5);
  let entry = remotePlayers.get(data.id);

  if (entry) {
    if (entry.skinKey !== skinKey) {
      const replacement = createPlayerMesh(color, { diamond: skinKey === "diamond" });
      replacement.position.copy(entry.mesh.position);
      replacement.rotation.copy(entry.mesh.rotation);
      scene.remove(entry.mesh);
      scene.add(replacement);
      entry.mesh = replacement;
      entry.skinKey = skinKey;
    }
    return entry;
  }

  const mesh = createPlayerMesh(color, { diamond: skinKey === "diamond" });
  const targetPosition = new THREE.Vector3();
  if (data.position) {
    targetPosition.set(data.position.x, data.position.y, data.position.z);
    mesh.position.copy(targetPosition);
  }
  entry = {
    mesh,
    targetPosition,
    targetYaw: 0,
    health: data.health || 100,
    dead: false,
    name: data.name || `Joueur ${data.id}`,
    skinKey,
    stance: DEFAULT_STANCE,
    stanceScale: 1
  };
  scene.add(mesh);
  remotePlayers.set(data.id, entry);
  return entry;
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
    const entry = ensureRemotePlayer(p);
    if (!entry) {
      continue;
    }
    if (p.position) {
      entry.targetPosition.set(p.position.x, p.position.y, p.position.z);
    }
    entry.targetYaw = p.yaw || 0;
    entry.health = p.health;
    entry.name = p.name || entry.name;
    entry.dead = p.dead;
    if (typeof p.stance === "string") {
      entry.stance = normalizeStance(p.stance);
    }
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
      aimHeld = false;
      setAiming(false);
    }
    if (!state.dead && localDead) {
      localDead = false;
      if (state.position) {
        player.position.set(state.position.x, state.position.y, state.position.z);
        player.velocity.set(0, 0, 0);
      }
      refreshAiming();
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
  const header = document.createElement("div");
  header.className = "scoreboard-header";
  const headerName = document.createElement("span");
  headerName.textContent = "JOUEUR";
  const headerScore = document.createElement("span");
  headerScore.textContent = "K / D";
  header.append(headerName, headerScore);
  scoreboardEl.appendChild(header);

  for (const playerEntry of sorted) {
    const row = document.createElement("div");
    row.className = "scoreboard-row";
    const nameSpan = document.createElement("span");
    const baseName = playerEntry.name || `Joueur ${playerEntry.id}`;
    nameSpan.textContent =
      playerEntry.id === localId ? `${baseName} (TOI)` : baseName;
    const scoreSpan = document.createElement("span");
    scoreSpan.textContent = `${playerEntry.kills} / ${playerEntry.deaths}`;
    row.append(nameSpan, scoreSpan);
    if (playerEntry.id === localId) {
      row.classList.add("local");
    }
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
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6dbe6,
    roughness: 0.25,
    metalness: 0.5,
    emissive: new THREE.Color(0x0f131c)
  });
  baseMaterial.depthTest = false;
  baseMaterial.depthWrite = false;
  accentMaterial.depthTest = false;
  accentMaterial.depthWrite = false;
  detailMaterial.depthTest = false;
  detailMaterial.depthWrite = false;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.6), baseMaterial);
  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, VIEW_MODEL_BARREL_LENGTH),
    accentMaterial
  );
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.18), baseMaterial);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.3), baseMaterial);
  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.18), detailMaterial);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 12), detailMaterial);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.22), baseMaterial);

  body.position.set(...VIEW_MODEL_PART_DEFAULTS.body.position);
  barrel.position.set(...VIEW_MODEL_PART_DEFAULTS.barrel.position);
  grip.position.set(...VIEW_MODEL_PART_DEFAULTS.grip.position);
  stock.position.set(...VIEW_MODEL_PART_DEFAULTS.stock.position);
  magazine.position.set(...VIEW_MODEL_PART_DEFAULTS.magazine.position);
  scope.position.set(...VIEW_MODEL_PART_DEFAULTS.scope.position);
  scope.rotation.set(...VIEW_MODEL_PART_DEFAULTS.scope.rotation);
  pump.position.set(...VIEW_MODEL_PART_DEFAULTS.pump.position);

  group.add(body, barrel, grip, stock, magazine, scope, pump);
  const viewMeshes = [body, barrel, grip, stock, magazine, scope, pump];
  for (const mesh of viewMeshes) {
    mesh.renderOrder = VIEW_MODEL_RENDER_ORDER;
  }

  const light = new THREE.PointLight(0xfff1b2, 0.6, 2);
  light.position.set(0.2, 0.1, 0.2);
  group.add(light);

  return {
    group,
    body,
    barrel,
    grip,
    stock,
    magazine,
    scope,
    pump,
    materials: { base: baseMaterial, accent: accentMaterial, detail: detailMaterial }
  };
}

function setMaterialTint(material, colorHex, emissiveScale = 0.18) {
  if (!material) {
    return;
  }
  material.color.setHex(colorHex);
  material.emissive.copy(material.color).multiplyScalar(emissiveScale);
}

function applyViewModelPart(mesh, config, defaults) {
  if (!mesh) {
    return;
  }
  const resolved = config || {};
  const visible = resolved.visible !== false;
  mesh.visible = visible;
  if (!visible) {
    return;
  }
  const scale = resolved.scale || defaults.scale;
  mesh.scale.set(scale[0], scale[1], scale[2]);
  const position = resolved.position || defaults.position;
  mesh.position.set(position[0], position[1], position[2]);
  const rotation = resolved.rotation || defaults.rotation;
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
}

function updateViewModelForWeapon(weaponKey) {
  const profile = VIEW_MODEL_PROFILES[weaponKey] || VIEW_MODEL_PROFILES.rifle;
  const colors = profile.colors || VIEW_MODEL_DEFAULT_COLORS;
  const parts = profile.parts || {};
  setMaterialTint(viewModel.materials.base, colors.base);
  setMaterialTint(viewModel.materials.accent, colors.accent);
  setMaterialTint(viewModel.materials.detail, colors.detail);

  applyViewModelPart(viewModel.body, parts.body, VIEW_MODEL_PART_DEFAULTS.body);
  applyViewModelPart(viewModel.barrel, parts.barrel, VIEW_MODEL_PART_DEFAULTS.barrel);
  applyViewModelPart(viewModel.grip, parts.grip, VIEW_MODEL_PART_DEFAULTS.grip);
  applyViewModelPart(viewModel.stock, parts.stock, VIEW_MODEL_PART_DEFAULTS.stock);
  applyViewModelPart(viewModel.magazine, parts.magazine, VIEW_MODEL_PART_DEFAULTS.magazine);
  applyViewModelPart(viewModel.scope, parts.scope, VIEW_MODEL_PART_DEFAULTS.scope);
  applyViewModelPart(viewModel.pump, parts.pump, VIEW_MODEL_PART_DEFAULTS.pump);

  viewModelBaseOffset.set(profile.offset.x, profile.offset.y, profile.offset.z);
  recoilState.x = 0;
  recoilState.y = 0;
  recoilState.z = 0;
  const barrelScaleZ = viewModel.barrel.scale.z || 1;
  viewModelMuzzleLocal.set(0, 0, -VIEW_MODEL_BARREL_LENGTH * 0.5 * barrelScaleZ);
  applyViewModelTransform();
}

function createPlayerMesh(color, options = {}) {
  const group = new THREE.Group();
  const diamond = Boolean(options.diamond);

  const bodyGeometry = new THREE.CylinderGeometry(0.45, 0.45, 1.3, 12);
  const headGeometry = new THREE.SphereGeometry(0.25, 14, 14);
  const accentGeometry = new THREE.BoxGeometry(0.18, 0.18, 0.4);

  const bodyMaterial = diamond
    ? new THREE.MeshStandardMaterial({
        color: 0xcff5ff,
        emissive: new THREE.Color(0x6edbff),
        emissiveIntensity: 0.55,
        metalness: 1,
        roughness: 0.04,
        envMapIntensity: 1.3
      })
    : new THREE.MeshStandardMaterial({ color });
  const headMaterial = diamond
    ? new THREE.MeshStandardMaterial({
        color: 0xe1fbff,
        emissive: new THREE.Color(0x8be9ff),
        emissiveIntensity: 0.5,
        metalness: 0.96,
        roughness: 0.05,
        envMapIntensity: 1.2
      })
    : new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, -0.1, 0.2) });
  const accentMaterial = diamond
    ? new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(0x9bf0ff),
        emissiveIntensity: 0.45,
        metalness: 0.9,
        roughness: 0.02,
        envMapIntensity: 1.2
      })
    : new THREE.MeshStandardMaterial({ color: 0x131722 });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.65;
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 1.55;
  const accent = new THREE.Mesh(accentGeometry, accentMaterial);
  accent.position.set(0, 1.4, 0.45);

  if (diamond) {
    const sparkle = new THREE.PointLight(0x9bf0ff, 1.2, 7);
    sparkle.position.set(0, 1.2, 0);
    group.add(sparkle);
  }
  group.userData.diamond = Boolean(diamond);

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

let hitmarkerTimer = null;

function showHitmarker(kind = "player") {
  if (!hitmarkerEl) {
    return;
  }
  const resolvedKind = kind === "target" ? "target" : "player";
  hitmarkerEl.classList.remove("player", "target");
  hitmarkerEl.classList.add("active", resolvedKind);
  hitmarkerEl.dataset.label = resolvedKind === "target" ? "CIBLE" : "TOUCHE";
  if (hitmarkerTimer) {
    clearTimeout(hitmarkerTimer);
  }
  hitmarkerTimer = setTimeout(() => {
    hitmarkerEl.classList.remove("active", "player", "target");
    hitmarkerEl.dataset.label = "";
    hitmarkerTimer = null;
  }, 160);
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

function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return new THREE.Vector3(
    -Math.sin(yaw) * cp,
    Math.sin(pitch),
    -Math.cos(yaw) * cp
  );
}

function rayAABB(origin, dir, box) {
  let tmin = -Infinity;
  let tmax = Infinity;

  const axes = ["x", "y", "z"];
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    const min = box.min[axis];
    const max = box.max[axis];

    if (Math.abs(d) < 1e-6) {
      if (o < min || o > max) {
        return null;
      }
      continue;
    }

    const t1 = (min - o) / d;
    const t2 = (max - o) / d;
    const tNear = Math.min(t1, t2);
    const tFar = Math.max(t1, t2);
    tmin = Math.max(tmin, tNear);
    tmax = Math.min(tmax, tFar);

    if (tmin > tmax) {
      return null;
    }
  }

  if (tmax < 0) {
    return null;
  }

  return tmin >= 0 ? tmin : tmax;
}

function isFlashOccluded(origin, target, distance) {
  const dir = target.clone().sub(origin);
  if (dir.lengthSq() < 1e-6) {
    return false;
  }
  dir.normalize();
  for (const obstacle of obstacles) {
    const hit = rayAABB(origin, dir, obstacle);
    if (hit !== null && hit < distance - 0.2) {
      return true;
    }
  }
  return false;
}

function computeFlashStrength(origin, radius) {
  const eye = new THREE.Vector3(
    player.position.x,
    player.position.y + EYE_HEIGHT,
    player.position.z
  );
  const toFlash = new THREE.Vector3().subVectors(origin, eye);
  const distance = toFlash.length();
  if (distance < 0.01 || distance > radius) {
    return 0;
  }

  const dirToFlash = toFlash.clone().normalize();
  const viewDir = dirFromYawPitch(player.yaw, player.pitch).normalize();
  const cosHalfFov = Math.cos(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const dot = viewDir.dot(dirToFlash);
  const inView = dot >= cosHalfFov;
  const blocked = isFlashOccluded(eye, origin, distance);

  let distanceFactor = Math.max(0, 1 - distance / radius);
  distanceFactor *= distanceFactor;

  const angleBack = THREE.MathUtils.clamp(dot + 1, 0, 1);
  let angleFactor = dot >= 0 ? 1 : Math.pow(angleBack, 0.35);
  if (inView) {
    angleFactor = 1;
  }

  if (blocked) {
    angleFactor *= 0.25;
  }

  let strength = distanceFactor * angleFactor;
  if (inView && !blocked) {
    strength = Math.max(strength, 0.95);
  }

  return THREE.MathUtils.clamp(strength, 0, 1);
}

function triggerFlash(strength) {
  if (!flashEl || strength <= 0) {
    return;
  }
  const now = performance.now();
  if (strength < flashState.peak && now < flashState.fadeEnd) {
    return;
  }

  flashState.peak = strength;
  const hold = THREE.MathUtils.lerp(FLASH_SETTINGS.minHold, FLASH_SETTINGS.maxHold, strength);
  const fade = THREE.MathUtils.lerp(FLASH_SETTINGS.minFade, FLASH_SETTINGS.maxFade, strength);
  flashState.holdUntil = now + hold * 1000;
  flashState.fadeEnd = flashState.holdUntil + fade * 1000;
}

function updateFlash(now) {
  if (!flashEl) {
    return;
  }
  let opacity = 0;
  if (now < flashState.holdUntil) {
    opacity = flashState.peak;
  } else if (now < flashState.fadeEnd) {
    const t = (now - flashState.holdUntil) / (flashState.fadeEnd - flashState.holdUntil);
    opacity = flashState.peak * (1 - t);
  }
  flashEl.style.opacity = opacity.toFixed(3);
}

function updateFlashStatus(now) {
  if (!flashStatusEl) {
    return;
  }
  if (flashThrowState.holding) {
    const heldMs = now - flashThrowState.holdStart;
    const charge = Math.min(1, heldMs / FLASH_SETTINGS.maxChargeMs);
    const percent = Math.round(charge * 100);
    flashStatusEl.textContent = `FLASH: ${percent}%`;
    return;
  }
  const remaining = FLASH_SETTINGS.throwCooldown - (now - lastFlashThrowAt);
  if (remaining <= 0) {
    flashStatusEl.textContent = "FLASH: PRETE";
  } else {
    flashStatusEl.textContent = `FLASH: ${Math.ceil(remaining / 100) / 10}s`;
  }
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
  mesh.renderOrder = EFFECT_RENDER_ORDER;
  scene.add(mesh);
  effects.push({ object: mesh, life: 0.08, maxLife: 0.08, shrink: true });
}

function renderShot(msg) {
  const serverOrigin = new THREE.Vector3(msg.origin.x, msg.origin.y, msg.origin.z);
  const isLocal = msg.shooterId === localId;
  const traces = msg.traces || [];
  const visualOrigin = isLocal ? getViewModelMuzzleWorldPosition() : serverOrigin;
  const muzzleKick = isLocal ? 0.02 : 0.35;
  if (traces.length > 0) {
    const baseDir = new THREE.Vector3(
      traces[0].dir.x,
      traces[0].dir.y,
      traces[0].dir.z
    );
    spawnMuzzleFlash(visualOrigin, baseDir, {
      muzzleOffset: muzzleKick,
      sideOffset: 0
    });
  }
  for (const trace of traces) {
    const dir = new THREE.Vector3(trace.dir.x, trace.dir.y, trace.dir.z);
    const distance = typeof trace.distance === "number" ? trace.distance : 0;
    spawnTracer(visualOrigin, dir, distance, {
      muzzleOffset: muzzleKick,
      sideOffset: 0,
      maxLength: isLocal ? 8 : distance
    });
    spawnProjectile(visualOrigin, dir, distance, {
      muzzleOffset: muzzleKick * 0.6,
      sideOffset: 0,
      maxTravel: isLocal ? 10 : 8
    });
    if (trace.impact) {
      const end = serverOrigin.clone().add(dir.clone().multiplyScalar(distance));
      spawnImpact(end, trace.impact.type);
      if (trace.impact.type === "target" && trace.impact.targetId) {
        flashTarget(trace.impact.targetId);
      }
    }
  }

  if (msg.shooterId === localId && msg.hits && msg.hits.length > 0) {
    const hasPlayerHit = msg.hits.some((hit) => hit.type !== "target");
    const hasTargetHit = msg.hits.some((hit) => hit.type === "target");
    const indicator = hasPlayerHit ? "player" : hasTargetHit ? "target" : null;
    if (indicator) {
      showHitmarker(indicator);
    }
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
  mesh.renderOrder = EFFECT_RENDER_ORDER;
  scene.add(mesh);
  effects.push({ object: mesh, life: 0.2, maxLife: 0.2 });
}

function spawnProjectile(origin, dir, distance, options = {}) {
  const normalized = dir.clone();
  if (normalized.lengthSq() < 1e-6) {
    return;
  }
  normalized.normalize();
  const right = getRightVector(normalized);
  const sideOffset = options.sideOffset || 0;
  const muzzleOffset = options.muzzleOffset || 0.25;
  const maxTravel = typeof options.maxTravel === "number" ? options.maxTravel : 12;
  const travelDistance = Math.max(0.6, Math.min(distance, maxTravel));
  const speed = typeof options.speed === "number" ? options.speed : 80;
  const life = Math.max(0.08, travelDistance / speed);
  const position = origin
    .clone()
    .add(right.multiplyScalar(sideOffset))
    .add(normalized.clone().multiplyScalar(muzzleOffset));

  const material = new THREE.MeshBasicMaterial({
    color: options.color || 0xfff1b2,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(projectileGeometry, material);
  mesh.position.copy(position);
  mesh.renderOrder = EFFECT_RENDER_ORDER;
  scene.add(mesh);
  const velocity = normalized.multiplyScalar(travelDistance / life);
  effects.push({ object: mesh, life, maxLife: life, velocity, shrink: true });
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

function spawnFlashGrenade(origin, velocity, fuseMs) {
  const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial.clone());
  mesh.position.set(origin.x, origin.y, origin.z);
  scene.add(mesh);
  grenades.push({
    mesh,
    velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
    fuseMs,
    elapsedMs: 0,
    landed: false
  });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    effect.life -= dt;
    if (effect.velocity) {
      effect.object.position.addScaledVector(effect.velocity, dt);
    }
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

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const grenade = grenades[i];
    grenade.elapsedMs += dt * 1000;
    if (!grenade.landed) {
      grenade.velocity.y -= FLASH_SETTINGS.gravity * dt;
      grenade.mesh.position.addScaledVector(grenade.velocity, dt);
      if (grenade.mesh.position.y <= 0) {
        grenade.mesh.position.y = 0;
        grenade.velocity.set(0, 0, 0);
        grenade.landed = true;
        grenade.mesh.material.emissive.set(0x1a1a1a);
      }
    }
    if (grenade.elapsedMs >= grenade.fuseMs) {
      scene.remove(grenade.mesh);
      if (grenade.mesh.material) {
        grenade.mesh.material.dispose();
      }
      grenades.splice(i, 1);
    }
  }
}

function normalizeStance(stance) {
  return PLAYER_STANCES[stance] ? stance : DEFAULT_STANCE;
}

function getStanceProfile(stance = player.stance) {
  return PLAYER_STANCES[normalizeStance(stance)];
}

function getStanceScaleY(stance) {
  const profile = getStanceProfile(stance);
  return profile.height / BASE_PLAYER_HEIGHT;
}

function hasClearanceForHeight(desiredHeight) {
  const radiusSq = PLAYER_RADIUS * PLAYER_RADIUS;
  const playerTop = player.position.y + desiredHeight;

  for (const obstacle of obstacles) {
    if (player.position.y >= obstacle.max.y || playerTop <= obstacle.min.y) {
      continue;
    }
    const nearestX = Math.max(obstacle.min.x, Math.min(player.position.x, obstacle.max.x));
    const nearestZ = Math.max(obstacle.min.z, Math.min(player.position.z, obstacle.max.z));
    const dx = player.position.x - nearestX;
    const dz = player.position.z - nearestZ;
    if (dx * dx + dz * dz < radiusSq) {
      return false;
    }
  }

  return true;
}

function updatePlayerStanceFromInput() {
  const desired = input.prone ? "prone" : input.crouch ? "crouch" : DEFAULT_STANCE;
  const normalized = normalizeStance(desired);
  if (normalized === player.stance) {
    return;
  }
  const targetProfile = getStanceProfile(normalized);
  if (hasClearanceForHeight(targetProfile.height)) {
    player.stance = normalized;
    return;
  }
  if (
    normalized === DEFAULT_STANCE &&
    PLAYER_STANCES.crouch &&
    hasClearanceForHeight(PLAYER_STANCES.crouch.height)
  ) {
    player.stance = "crouch";
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

function resolveCollisions(previousBottomY, wasOnGround, playerHeight) {
  let onPlatform = false;
  const radiusSq = PLAYER_RADIUS * PLAYER_RADIUS;

  for (const obstacle of obstacles) {
    const playerTopY = player.position.y + playerHeight;
    if (player.position.y >= obstacle.max.y && player.velocity.y <= 0) {
      // Pas de collision latérale quand on est au-dessus.
    } else if (playerTopY <= obstacle.min.y) {
      continue;
    }

    const nearestX = Math.max(obstacle.min.x, Math.min(player.position.x, obstacle.max.x));
    const nearestZ = Math.max(obstacle.min.z, Math.min(player.position.z, obstacle.max.z));
    const dx = player.position.x - nearestX;
    const dz = player.position.z - nearestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq >= radiusSq) {
      continue;
    }

    const obstacleTop = obstacle.max.y;
    const obstacleBottom = obstacle.min.y;
    const verticalOverlap = player.position.y < obstacleTop && playerTopY > obstacleBottom;

    if (player.velocity.y <= 0) {
      const crossesTop =
        previousBottomY >= obstacleTop - 1e-4 && player.position.y < obstacleTop;
      if (crossesTop) {
        player.position.y = obstacleTop;
        player.velocity.y = 0;
        onPlatform = true;
        continue;
      }
    }

    if (wasOnGround && player.velocity.y <= 0) {
      const stepDelta = obstacleTop - player.position.y;
      if (stepDelta > 1e-4 && stepDelta <= STEP_HEIGHT) {
        player.position.y = obstacleTop;
        player.velocity.y = 0;
        onPlatform = true;
        continue;
      }
    }

    if (!verticalOverlap) {
      continue;
    }

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

  if (onPlatform) {
    player.onGround = true;
  }
}

function clampPositionToBounds() {
  player.position.x = Math.max(mapBounds.minX, Math.min(mapBounds.maxX, player.position.x));
  player.position.z = Math.max(mapBounds.minZ, Math.min(mapBounds.maxZ, player.position.z));
}

function updateMovement(dt) {
  const wasOnGround = player.onGround;
  const previousBottomY = player.position.y;

  if (localDead) {
    player.velocity.set(0, 0, 0);
    const stance = getStanceProfile();
    camera.position.set(
      player.position.x,
      player.position.y + stance.eyeHeight,
      player.position.z
    );
    camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
    return;
  }
  if (document.pointerLockElement !== canvas) {
    player.velocity.set(0, 0, 0);
    const stance = getStanceProfile();
    camera.position.set(
      player.position.x,
      player.position.y + stance.eyeHeight,
      player.position.z
    );
    camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
    return;
  }
  updatePlayerStanceFromInput();
  let stance = getStanceProfile();
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

  const sprinting = input.sprint && player.stance === DEFAULT_STANCE;
  const maxSpeed =
    (sprinting ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed) * stance.speedMultiplier;

  if (wasOnGround) {
    applyFriction(dt);
    accelerate(wishDir, maxSpeed, MOVEMENT.accel, dt);
  } else {
    accelerate(wishDir, maxSpeed, MOVEMENT.airAccel, dt);
  }

  player.velocity.y -= MOVEMENT.gravity * dt;

  if (input.jump && wasOnGround && player.stance !== "prone") {
    const standProfile = getStanceProfile(DEFAULT_STANCE);
    if (hasClearanceForHeight(standProfile.height)) {
      player.velocity.y = MOVEMENT.jumpVelocity;
      player.stance = DEFAULT_STANCE;
      input.crouch = false;
      input.prone = false;
      stance = standProfile;
    }
  }

  player.position.addScaledVector(player.velocity, dt);

  player.onGround = false;
  resolveCollisions(previousBottomY, wasOnGround, stance.height);
  if (!player.onGround && player.position.y <= 0) {
    player.position.y = 0;
    player.velocity.y = 0;
    player.onGround = true;
  }
  clampPositionToBounds();

  camera.position.set(
    player.position.x,
    player.position.y + stance.eyeHeight,
    player.position.z
  );
  camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
}

function updateRemotePlayers(dt) {
  for (const entry of remotePlayers.values()) {
    entry.mesh.position.lerp(entry.targetPosition, 0.2);
    entry.mesh.rotation.y = entry.targetYaw;
    const targetScale = getStanceScaleY(entry.stance);
    entry.stanceScale = dampValue(entry.stanceScale ?? 1, targetScale, 18, dt);
    entry.mesh.scale.set(1, entry.stanceScale, 1);
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
  addRecoilImpulse(currentWeapon);

  if (connected) {
    socket.send(JSON.stringify({ type: "shoot", stance: player.stance }));
  }
}

function tryThrowFlash(now, charge) {
  if (!connected || !socket || !localId) {
    return;
  }
  if (localDead || document.pointerLockElement !== canvas) {
    return;
  }
  if (now - lastFlashThrowAt < FLASH_SETTINGS.throwCooldown) {
    return;
  }
  lastFlashThrowAt = now;
  socket.send(JSON.stringify({ type: "throw_flash", charge }));
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
      weapon: currentWeapon,
      stance: player.stance
    })
  );
}

function animate(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  refreshAiming();
  updateMovement(dt);
  updateWeapon(now);
  updateRecoil(dt);
  updateRemotePlayers(dt);
  updateEffects(dt);
  updateGrenades(dt);
  updateFlash(now);
  updateFlashStatus(now);
  sendState(now);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function handlePointerLockChange() {
  const locked = document.pointerLockElement === canvas;
  overlay.classList.toggle("hidden", locked);
  if (!locked) {
    resetInput();
    aimHeld = false;
    setAiming(false);
    setLeaderboardVisible(false);
    flashThrowState.holding = false;
  }
}

function matchesKey(event, keys, codes) {
  const key = event.key ? event.key.toLowerCase() : "";
  return keys.includes(key) || codes.includes(event.code);
}

function connectControls() {
  playButton.addEventListener("click", () => {
    sendNameIfPossible();
    canvas.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", handlePointerLockChange);
  window.addEventListener("contextmenu", (event) => event.preventDefault());

  if (nameInput) {
    const storedName = localStorage.getItem(NAME_STORAGE_KEY);
    if (storedName) {
      nameInput.value = storedName;
    }
    nameInput.addEventListener("blur", () => {
      sendNameIfPossible();
    });
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendNameIfPossible();
        canvas.requestPointerLock();
      }
    });
  }

  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas) {
      return;
    }
    const baseSensitivity = aiming ? LOOK_SENSITIVITY.scoped : LOOK_SENSITIVITY.normal;
    const sensitivity = baseSensitivity * sensitivityMultiplier;
    player.yaw -= event.movementX * sensitivity;
    player.pitch -= event.movementY * sensitivity;
    player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch));
  });

  window.addEventListener("mousedown", (event) => {
    if (document.pointerLockElement !== canvas) {
      return;
    }
    if (event.button === 0) {
      input.firing = true;
      return;
    }
    if (event.button === 2) {
      aimHeld = true;
      refreshAiming();
    }
  });

  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      input.firing = false;
    }
    if (event.button === 2) {
      aimHeld = false;
      refreshAiming();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Tab" && document.pointerLockElement === canvas) {
      event.preventDefault();
      setLeaderboardVisible(true);
      return;
    }
    if (matchesKey(event, ["w", "z"], ["KeyW", "KeyZ"])) {
      input.forward = true;
    } else if (matchesKey(event, ["s"], ["KeyS"])) {
      input.back = true;
    } else if (matchesKey(event, ["a", "q"], ["KeyA", "KeyQ"])) {
      input.left = true;
    } else if (matchesKey(event, ["d"], ["KeyD"])) {
      input.right = true;
    }

    if (event.code === "KeyF") {
      if (!flashThrowState.holding && !event.repeat) {
        if (
          document.pointerLockElement === canvas &&
          !localDead &&
          performance.now() - lastFlashThrowAt >= FLASH_SETTINGS.throwCooldown
        ) {
          flashThrowState.holding = true;
          flashThrowState.holdStart = performance.now();
        }
      }
      return;
    }

    switch (event.code) {
      case "ShiftLeft":
      case "ShiftRight":
        input.sprint = true;
        break;
      case "ControlLeft":
      case "ControlRight":
      case "KeyC":
        input.crouch = true;
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
      case "Digit4":
        switchWeapon("deagle");
        break;
      case "Digit5":
        switchWeapon("sniper");
        break;
      case "KeyR":
        beginReload(performance.now());
        break;
      default:
        break;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Tab" && document.pointerLockElement === canvas) {
      event.preventDefault();
      setLeaderboardVisible(false);
      return;
    }
    if (matchesKey(event, ["w", "z"], ["KeyW", "KeyZ"])) {
      input.forward = false;
    } else if (matchesKey(event, ["s"], ["KeyS"])) {
      input.back = false;
    } else if (matchesKey(event, ["a", "q"], ["KeyA", "KeyQ"])) {
      input.left = false;
    } else if (matchesKey(event, ["d"], ["KeyD"])) {
      input.right = false;
    }

    if (event.code === "KeyF") {
      if (flashThrowState.holding) {
        const heldMs = performance.now() - flashThrowState.holdStart;
        const charge = Math.min(1, heldMs / FLASH_SETTINGS.maxChargeMs);
        tryThrowFlash(performance.now(), charge);
        flashThrowState.holding = false;
      }
      return;
    }

    switch (event.code) {
      case "ShiftLeft":
      case "ShiftRight":
        input.sprint = false;
        break;
      case "ControlLeft":
      case "ControlRight":
      case "KeyC":
        input.crouch = false;
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
  refreshAiming();
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
initSensitivityControls();
connectControls();
updateWeaponHUD();
updateViewModelForWeapon(currentWeapon);
requestAnimationFrame(animate);
