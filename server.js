const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const TICK_RATE = 20;
const RESPAWN_DELAY_MS = 3000;
const EYE_HEIGHT = 1.6;
const BODY_CENTER_Y = 0.95;
const BODY_RADIUS = 0.45;
const HEAD_CENTER_Y = 1.65;
const HEAD_RADIUS = 0.25;
const FLASH = {
  fuseMs: 1200,
  cooldownMs: 4500,
  maxRadius: 150,
  throwDistance: 11,
  throwHeight: 0.6,
  throwSpeedMin: 7,
  throwSpeedMax: 60,
  upBoost: 3.2,
  gravity: 26
};

const WEAPONS = {
  pistol: {
    label: "Pistolet",
    damage: 25,
    headshot: 1.6,
    range: 70,
    fireRate: 0.35,
    spread: 0.01,
    pellets: 1,
    magazine: 12,
    reloadTime: 1.2
  },
  deagle: {
    label: "Deagle",
    damage: 50,
    headshot: 2,
    range: 85,
    fireRate: 0.5,
    spread: 0.008,
    pellets: 1,
    magazine: 7,
    reloadTime: 1.7
  },
  rifle: {
    label: "Fusil",
    damage: 14,
    headshot: 1.5,
    range: 90,
    fireRate: 0.1,
    spread: 0.02,
    pellets: 1,
    magazine: 30,
    reloadTime: 1.6
  },
  sniper: {
    label: "Sniper",
    damage: 80,
    headshot: 1.5,
    range: 190,
    fireRate: 1.2,
    spread: 0.002,
    pellets: 1,
    magazine: 5,
    reloadTime: 2.8
  },
  shotgun: {
    label: "Pompe",
    damage: 9,
    headshot: 1.25,
    range: 35,
    fireRate: 0.9,
    spread: 0.15,
    pellets: 8,
    magazine: 6,
    reloadTime: 2.2
  }
};

const MAP = {
  bounds: { minX: -38, maxX: 38, minZ: -38, maxZ: 38 },
  spawns: [
    { x: -20, y: 0, z: -20 },
    { x: 20, y: 0, z: -18 },
    { x: 18, y: 0, z: 20 },
    { x: -18, y: 0, z: 22 },
    { x: 0, y: 0, z: 0 },
    { x: -8, y: 0, z: 12 },
    { x: 10, y: 0, z: -6 }
  ],
  obstacles: [
    { id: "crate-a", position: { x: -6, y: 1.2, z: -4 }, size: { x: 3, y: 2.4, z: 3 } },
    { id: "crate-b", position: { x: 8, y: 1.2, z: 6 }, size: { x: 3, y: 2.4, z: 3 } },
    { id: "wall-a", position: { x: -14, y: 1.4, z: 10 }, size: { x: 10, y: 2.8, z: 1.5 } },
    { id: "wall-b", position: { x: 12, y: 1.4, z: -12 }, size: { x: 10, y: 2.8, z: 1.5 } },
    { id: "pillar", position: { x: 0, y: 1.8, z: -16 }, size: { x: 2.8, y: 3.6, z: 2.8 } },

    // Escalier + plateforme (cote gauche)
    { id: "stairs-left-step-1", position: { x: -28, y: 0.125, z: 6.6 }, size: { x: 6, y: 0.25, z: 1.2 } },
    { id: "stairs-left-step-2", position: { x: -28, y: 0.375, z: 7.8 }, size: { x: 6, y: 0.25, z: 1.2 } },
    { id: "stairs-left-step-3", position: { x: -28, y: 0.625, z: 9.0 }, size: { x: 6, y: 0.25, z: 1.2 } },
    { id: "stairs-left-step-4", position: { x: -28, y: 0.875, z: 10.2 }, size: { x: 6, y: 0.25, z: 1.2 } },
    { id: "stairs-left-step-5", position: { x: -28, y: 1.125, z: 11.4 }, size: { x: 6, y: 0.25, z: 1.2 } },
    { id: "stairs-left-step-6", position: { x: -28, y: 1.375, z: 12.6 }, size: { x: 6, y: 0.25, z: 1.2 } },
    { id: "stairs-left-platform", position: { x: -28, y: 1.65, z: 17.2 }, size: { x: 8, y: 0.3, z: 8 } },
    { id: "stairs-left-rail-n", position: { x: -28, y: 2.1, z: 21.1 }, size: { x: 8, y: 0.9, z: 0.3 } },
    { id: "stairs-left-rail-w", position: { x: -31.85, y: 2.1, z: 17.2 }, size: { x: 0.3, y: 0.9, z: 8 } }
  ],
  targets: [
    { id: "target-1", position: { x: -28, y: 1.4, z: -10 }, radius: 0.55 },
    { id: "target-2", position: { x: 28, y: 1.2, z: 12 }, radius: 0.5 },
    { id: "target-3", position: { x: -18, y: 1.6, z: 26 }, radius: 0.5 },
    { id: "target-4", position: { x: 18, y: 1.3, z: -26 }, radius: 0.5 },
    { id: "target-5", position: { x: 0, y: 2.2, z: 30 }, radius: 0.45 },
    { id: "target-6", position: { x: 0, y: 1.1, z: -32 }, radius: 0.5 }
  ]
};

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const players = new Map();
let nextId = 1;

function randomSpawn() {
  const spawn = MAP.spawns[Math.floor(Math.random() * MAP.spawns.length)];
  return { x: spawn.x, y: spawn.y, z: spawn.z };
}

function createPlayer() {
  const id = String(nextId++);
  const spawn = randomSpawn();
  return {
    id,
    name: `Joueur ${id}`,
    position: { ...spawn },
    yaw: 0,
    pitch: 0,
    health: 100,
    weapon: "rifle",
    lastShotAt: 0,
    lastFlashAt: 0,
    kills: 0,
    deaths: 0,
    dead: false
  };
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function broadcastExcept(except, data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === 1) {
      client.send(payload);
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizePlayerName(name, fallbackId) {
  if (typeof name !== "string") {
    return `Joueur ${fallbackId}`;
  }
  const cleaned = name
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return `Joueur ${fallbackId}`;
  }
  return cleaned.slice(0, 16);
}

// Convention alignee avec Three.js: yaw=0 regarde vers -Z.
function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp
  };
}

function applySpread(dir, spread) {
  if (!spread) {
    return { ...dir };
  }
  const yaw = Math.atan2(-dir.x, -dir.z) + (Math.random() - 0.5) * spread;
  const pitch = Math.asin(dir.y) + (Math.random() - 0.5) * spread;
  return dirFromYawPitch(yaw, pitch);
}

function clampToBounds(position) {
  return {
    x: clamp(position.x, MAP.bounds.minX, MAP.bounds.maxX),
    y: clamp(position.y, 0, 6),
    z: clamp(position.z, MAP.bounds.minZ, MAP.bounds.maxZ)
  };
}

function scheduleFlashExplosion(player, charge) {
  const now = Date.now();
  if (now - player.lastFlashAt < FLASH.cooldownMs) {
    return;
  }
  player.lastFlashAt = now;

  const clampedCharge = clamp(typeof charge === "number" ? charge : 1, 0, 1);
  const throwSpeed =
    FLASH.throwSpeedMin + (FLASH.throwSpeedMax - FLASH.throwSpeedMin) * clampedCharge;
  const dir = dirFromYawPitch(player.yaw, clamp(player.pitch, -0.2, 0.35));
  const start = {
    x: player.position.x,
    y: player.position.y + EYE_HEIGHT,
    z: player.position.z
  };
  const velocity = {
    x: dir.x * throwSpeed,
    y: dir.y * throwSpeed + FLASH.upBoost,
    z: dir.z * throwSpeed
  };
  const t = FLASH.fuseMs / 1000;
  const predicted = {
    x: start.x + velocity.x * t,
    y: start.y + velocity.y * t - 0.5 * FLASH.gravity * t * t,
    z: start.z + velocity.z * t
  };
  if (predicted.y < 0) {
    predicted.y = 0;
  }
  const explosion = clampToBounds(predicted);

  broadcast({
    type: "flash_throw",
    origin: start,
    velocity,
    fuseMs: FLASH.fuseMs
  });

  setTimeout(() => {
    broadcast({
      type: "flash",
      origin: explosion,
      radius: FLASH.maxRadius
    });
  }, FLASH.fuseMs);
}

function raySphere(origin, dir, center, radius) {
  const ocx = origin.x - center.x;
  const ocy = origin.y - center.y;
  const ocz = origin.z - center.z;
  const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  const h = b * b - c;
  if (h < 0) {
    return null;
  }
  const sqrtH = Math.sqrt(h);
  const t = -b - sqrtH;
  if (t > 0) {
    return t;
  }
  const t2 = -b + sqrtH;
  return t2 > 0 ? t2 : null;
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

function obstacleDistance(origin, dir, range) {
  let nearest = null;
  for (const obstacle of MAP.obstacles) {
    const half = {
      x: obstacle.size.x / 2,
      y: obstacle.size.y / 2,
      z: obstacle.size.z / 2
    };
    const box = {
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
    };
    const hit = rayAABB(origin, dir, box);
    if (hit !== null && hit <= range) {
      if (nearest === null || hit < nearest) {
        nearest = hit;
      }
    }
  }
  return nearest;
}

function findHit(origin, dir, range, shooterId, obstacleHit) {
  let best = null;

  for (const player of players.values()) {
    if (player.id === shooterId || player.dead) {
      continue;
    }

    const bodyCenter = {
      x: player.position.x,
      y: player.position.y + BODY_CENTER_Y,
      z: player.position.z
    };
    const headCenter = {
      x: player.position.x,
      y: player.position.y + HEAD_CENTER_Y,
      z: player.position.z
    };

    const bodyT = raySphere(origin, dir, bodyCenter, BODY_RADIUS);
    const headT = raySphere(origin, dir, headCenter, HEAD_RADIUS);

    let part = null;
    let t = null;
    if (headT !== null && (bodyT === null || headT < bodyT)) {
      part = "head";
      t = headT;
    } else if (bodyT !== null) {
      part = "body";
      t = bodyT;
    }

    if (t === null || t > range) {
      continue;
    }

    if (obstacleHit !== null && t >= obstacleHit) {
      continue;
    }

    if (!best || t < best.distance) {
      best = { target: player, part, distance: t };
    }
  }

  return best;
}

function findTargetHit(origin, dir, range, obstacleHit) {
  let best = null;
  if (!Array.isArray(MAP.targets)) {
    return null;
  }

  for (const target of MAP.targets) {
    const t = raySphere(origin, dir, target.position, target.radius);
    if (t === null || t > range) {
      continue;
    }
    if (obstacleHit !== null && t >= obstacleHit) {
      continue;
    }
    if (!best || t < best.distance) {
      best = { target, distance: t };
    }
  }

  return best;
}

function resolveImpact(origin, dir, weapon, shooterId) {
  const obstacleHit = obstacleDistance(origin, dir, weapon.range);
  const playerHit = findHit(origin, dir, weapon.range, shooterId, obstacleHit);
  const targetHit = findTargetHit(origin, dir, weapon.range, obstacleHit);

  if (playerHit && (!targetHit || playerHit.distance <= targetHit.distance)) {
    return {
      distance: playerHit.distance,
      impact: { type: "player", targetId: playerHit.target.id, part: playerHit.part },
      playerHit
    };
  }

  if (targetHit) {
    return {
      distance: targetHit.distance,
      impact: { type: "target", targetId: targetHit.target.id },
      targetHit
    };
  }

  if (obstacleHit !== null) {
    return {
      distance: obstacleHit,
      impact: { type: "obstacle" }
    };
  }

  return { distance: weapon.range, impact: null };
}

function handleShoot(player) {
  if (player.dead) {
    return;
  }
  const weapon = WEAPONS[player.weapon];
  if (!weapon) {
    return;
  }

  const now = Date.now();
  const fireInterval = weapon.fireRate * 1000;
  if (now - player.lastShotAt < fireInterval) {
    return;
  }
  player.lastShotAt = now;

  const origin = {
    x: player.position.x,
    y: player.position.y + EYE_HEIGHT,
    z: player.position.z
  };
  const baseDir = dirFromYawPitch(player.yaw, player.pitch);
  const traces = [];
  const hits = [];

  for (let i = 0; i < weapon.pellets; i++) {
    const dir = applySpread(baseDir, weapon.spread);
    const result = resolveImpact(origin, dir, weapon, player.id);
    traces.push({ dir, distance: result.distance, impact: result.impact });

    if (result.playerHit) {
      const hit = result.playerHit;
      const damage = Math.round(
        weapon.damage * (hit.part === "head" ? weapon.headshot : 1)
      );
      hit.target.health = Math.max(0, hit.target.health - damage);

      hits.push({
        targetId: hit.target.id,
        part: hit.part,
        damage,
        remaining: hit.target.health,
        distance: result.distance
      });

      if (hit.target.health <= 0 && !hit.target.dead) {
        hit.target.dead = true;
        hit.target.deaths += 1;
        player.kills += 1;

        broadcast({
          type: "death",
          id: hit.target.id,
          killerId: player.id
        });

        setTimeout(() => {
          if (!players.has(hit.target.id)) {
            return;
          }
          hit.target.dead = false;
          hit.target.health = 100;
          hit.target.position = randomSpawn();
        }, RESPAWN_DELAY_MS);
      }
    }

    if (result.targetHit) {
      hits.push({
        targetId: result.targetHit.target.id,
        type: "target",
        distance: result.distance
      });
    }
  }

  broadcast({
    type: "shot",
    shooterId: player.id,
    origin,
    weapon: player.weapon,
    traces,
    hits
  });
}

wss.on("connection", (ws) => {
  const player = createPlayer();
  players.set(player.id, player);

  ws.send(
    JSON.stringify({
      type: "welcome",
      id: player.id,
      map: MAP,
      weapons: WEAPONS,
      players: Array.from(players.values())
    })
  );

  broadcastExcept(ws, {
    type: "player_join",
    player
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      return;
    }

    const current = players.get(player.id);
    if (!current) {
      return;
    }

    if (msg.type === "state") {
      if (current.dead) {
        return;
      }
      if (msg.position) {
        current.position.x = clamp(msg.position.x, MAP.bounds.minX, MAP.bounds.maxX);
        current.position.y = clamp(msg.position.y, 0, 5);
        current.position.z = clamp(msg.position.z, MAP.bounds.minZ, MAP.bounds.maxZ);
      }
      if (typeof msg.yaw === "number") {
        current.yaw = msg.yaw;
      }
      if (typeof msg.pitch === "number") {
        current.pitch = clamp(msg.pitch, -1.3, 1.3);
      }
      if (typeof msg.weapon === "string" && WEAPONS[msg.weapon]) {
        current.weapon = msg.weapon;
      }
    }

    if (msg.type === "set_name") {
      current.name = sanitizePlayerName(msg.name, current.id);
    }

    if (msg.type === "shoot") {
      handleShoot(current);
    }

    if (msg.type === "switch_weapon") {
      if (typeof msg.weapon === "string" && WEAPONS[msg.weapon]) {
        current.weapon = msg.weapon;
      }
    }

    if (msg.type === "throw_flash") {
      if (!current.dead) {
        scheduleFlashExplosion(current, msg.charge);
      }
    }
  });

  ws.on("close", () => {
    players.delete(player.id);
    broadcast({
      type: "player_leave",
      id: player.id
    });
  });
});

setInterval(() => {
  const snapshot = Array.from(players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    yaw: player.yaw,
    pitch: player.pitch,
    health: player.health,
    weapon: player.weapon,
    dead: player.dead,
    kills: player.kills,
    deaths: player.deaths
  }));

  broadcast({
    type: "state",
    players: snapshot
  });
}, 1000 / TICK_RATE);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur FPS LAN demarre sur http://0.0.0.0:${PORT}`);
});
