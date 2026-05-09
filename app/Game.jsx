"use client";

import { useEffect, useRef, useState } from "react";

// =====================================================
// CONFIG — change values here to customize the game
// =====================================================
const RECIPIENT = "0x9942E8725D2e46d2532CF24b61960e427E1F2589";
const ENTRY_FEE_USD = 0.01;
const BASE_CHAIN_HEX = "0x2105";   // Base mainnet (8453). For testnet use "0x14a34"
const BASE_CHAIN_PARAMS = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

// =====================================================
// Game constants
// =====================================================
const TILE = 16;
const GRID = 26;
const T_EMPTY = 0, T_BRICK = 1, T_STEEL = 2, T_BASE = 5;
const LEVELS = [
  { enemies: 5, layout: "classic1" },
  { enemies: 8, layout: "fortress" },
  { enemies: 10, layout: "maze" },
];

export default function Game() {
  const canvasRef = useRef(null);
  const [overlay, setOverlay] = useState("start");
  const [hud, setHud] = useState({ level: 1, lives: 3, score: 0, enemiesLeft: 0 });
  const [account, setAccount] = useState(null);
  const [toast, setToast] = useState(null);

  const stateRef = useRef({
    level: 1, lives: 3, score: 0,
    paused: false, running: false,
    map: [], baseTile: { x: 12, y: 24 },
    player: null, enemies: [], bullets: [], particles: [],
    remainingSpawns: 0, spawnTimer: 0, lastTime: 0,
  });
  const inputRef = useRef({ up: false, down: false, left: false, right: false, fire: false });

  const showToast = (msg, ms = 2500) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  };

  // ---------- Mini App SDK ready ----------
  useEffect(() => {
    // Load Mini App SDK from CDN at runtime via script tag (not import())
    // This prevents Next.js build from trying to resolve the URL.
    const script = document.createElement("script");
    script.type = "module";
    script.textContent = `
      try {
        const { sdk } = await import('https://esm.sh/@farcaster/miniapp-sdk@0.2.3');
        await sdk.actions.ready();
        window.__farcasterSdk = sdk;
      } catch (e) {}
    `;
    document.head.appendChild(script);
  }, []);

  // ---------- Map ----------
  const buildMap = (layout) => {
    const s = stateRef.current;
    s.map = Array.from({ length: GRID }, () => new Array(GRID).fill(T_EMPTY));
    const brickRect = (x, y, w, h) => {
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++)
        if (x + i < GRID && y + j < GRID) s.map[y + j][x + i] = T_BRICK;
    };
    const steel = (x, y) => { if (x < GRID && y < GRID) s.map[y][x] = T_STEEL; };

    if (layout === "classic1") {
      brickRect(2, 4, 2, 6); brickRect(6, 4, 2, 6); brickRect(10, 4, 2, 6);
      brickRect(14, 4, 2, 6); brickRect(18, 4, 2, 6); brickRect(22, 4, 2, 6);
      brickRect(4, 12, 4, 2); brickRect(14, 12, 4, 2);
      brickRect(20, 14, 2, 4); brickRect(4, 14, 2, 4);
      brickRect(10, 16, 6, 2);
      steel(8, 8); steel(17, 8); steel(8, 17); steel(17, 17);
    } else if (layout === "fortress") {
      brickRect(0, 6, GRID, 1); brickRect(0, 14, GRID, 1);
      brickRect(6, 0, 1, 8); brickRect(19, 0, 1, 8);
      brickRect(10, 10, 6, 4);
      steel(12, 12); steel(13, 12); steel(12, 13); steel(13, 13);
    } else {
      for (let y = 2; y < GRID - 2; y += 4)
        for (let x = 2; x < GRID - 2; x++)
          if (x % 5 !== 0) s.map[y][x] = T_BRICK;
      steel(5, 5); steel(20, 5); steel(5, 20); steel(20, 20);
    }

    s.baseTile = { x: 12, y: 24 };
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
      s.map[s.baseTile.y + dy][s.baseTile.x + dx] = T_BASE;
    const ring = [
      [s.baseTile.x - 1, s.baseTile.y - 1], [s.baseTile.x, s.baseTile.y - 1],
      [s.baseTile.x + 1, s.baseTile.y - 1], [s.baseTile.x + 2, s.baseTile.y - 1],
      [s.baseTile.x - 1, s.baseTile.y], [s.baseTile.x + 2, s.baseTile.y],
      [s.baseTile.x - 1, s.baseTile.y + 1], [s.baseTile.x + 2, s.baseTile.y + 1],
    ];
    ring.forEach(([x, y]) => {
      if (x >= 0 && x < GRID && y >= 0 && y < GRID) s.map[y][x] = T_BRICK;
    });
    const clearArea = (cx, cy, r = 1) => {
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++)
          if (x >= 0 && y >= 0 && x < GRID && y < GRID && s.map[y][x] !== T_BASE)
            s.map[y][x] = T_EMPTY;
    };
    clearArea(8, 24, 1); clearArea(0, 0, 1); clearArea(12, 0, 1); clearArea(GRID - 1, 0, 1);
  };

  const newTank = (x, y, isPlayer) => ({
    x, y, size: TILE * 2 - 2,
    dir: isPlayer ? 0 : 2,
    speed: isPlayer ? 70 : 45,
    isPlayer, alive: true,
    cooldown: 0, bulletSpeed: 180, aiTimer: 0, spawnFlash: 1.0,
    color: isPlayer ? "#dcb45c" : "#aaaaaa",
  });

  const collidesMap = (px, py, size) => {
    const s = stateRef.current;
    const x1 = Math.floor(px / TILE), y1 = Math.floor(py / TILE);
    const x2 = Math.floor((px + size - 1) / TILE);
    const y2 = Math.floor((py + size - 1) / TILE);
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) return true;
      const t = s.map[y][x];
      if (t === T_BRICK || t === T_STEEL || t === T_BASE) return true;
    }
    return false;
  };

  const overlapRect = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const tryMove = (tank, dx, dy) => {
    const s = stateRef.current;
    const nx = tank.x + dx, ny = tank.y + dy;
    if (nx < 0 || ny < 0 || nx + tank.size > GRID * TILE || ny + tank.size > GRID * TILE) return false;
    if (collidesMap(nx, ny, tank.size)) return false;
    const others = [...s.enemies, s.player].filter(t => t && t !== tank && t.alive);
    for (const o of others)
      if (overlapRect({ x: nx, y: ny, w: tank.size, h: tank.size }, { x: o.x, y: o.y, w: o.size, h: o.size }))
        return false;
    tank.x = nx; tank.y = ny;
    return true;
  };

  const setDir = (tank, d) => {
    tank.dir = d;
    if (d === 0 || d === 2) tank.x = Math.round(tank.x / TILE) * TILE;
    else tank.y = Math.round(tank.y / TILE) * TILE;
  };

  const fire = (tank) => {
    const s = stateRef.current;
    if (tank.cooldown > 0) return;
    const myBullets = s.bullets.filter(b => b.owner === tank).length;
    if (myBullets >= 1) return;
    tank.cooldown = 0.45;
    const cx = tank.x + tank.size / 2, cy = tank.y + tank.size / 2;
    let bx = cx, by = cy, vx = 0, vy = 0;
    const sp = tank.bulletSpeed;
    if (tank.dir === 0) { by = tank.y - 4; vy = -sp; }
    if (tank.dir === 1) { bx = tank.x + tank.size + 4; vx = sp; }
    if (tank.dir === 2) { by = tank.y + tank.size + 4; vy = sp; }
    if (tank.dir === 3) { bx = tank.x - 4; vx = -sp; }
    s.bullets.push({ x: bx, y: by, vx, vy, owner: tank, w: 5, h: 5 });
  };

  const explode = (x, y, color = "#ff6a00") => {
    const s = stateRef.current;
    for (let i = 0; i < 20; i++)
      s.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 120,
        life: 0.4 + Math.random() * 0.4, color,
      });
  };

  const spawnEnemy = () => {
    const s = stateRef.current;
    const spots = [{ tx: 0, ty: 0 }, { tx: 12, ty: 0 }, { tx: GRID - 2, ty: 0 }];
    const sp = spots[Math.floor(Math.random() * spots.length)];
    const t = newTank(sp.tx * TILE, sp.ty * TILE, false);
    t.color = ["#aaaaaa", "#ff8c42", "#88ccff"][Math.floor(Math.random() * 3)];
    s.enemies.push(t);
  };

  const triggerLose = (reason) => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false; s.lives--;
    setHud(h => ({ ...h, lives: s.lives }));
    setOverlay("lose");
  };
  const triggerWin = () => {
    const s = stateRef.current;
    s.running = false;
    s.score += 100 * s.level; s.level++;
    setHud(h => ({ ...h, score: s.score, level: s.level }));
    setOverlay("win");
  };

  const bulletHitsMap = (b) => {
    const s = stateRef.current;
    const tx = Math.floor((b.x + b.w / 2) / TILE);
    const ty = Math.floor((b.y + b.h / 2) / TILE);
    if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return "edge";
    const t = s.map[ty][tx];
    if (t === T_BRICK) { s.map[ty][tx] = T_EMPTY; return "brick"; }
    if (t === T_STEEL) return "steel";
    if (t === T_BASE) { triggerLose("Base destroyed!"); return "base"; }
    return null;
  };

  const updateTank = (tank, dt) => {
    const s = stateRef.current;
    const input = inputRef.current;
    tank.cooldown = Math.max(0, tank.cooldown - dt);
    tank.spawnFlash = Math.max(0, tank.spawnFlash - dt);
    if (tank.isPlayer) {
      let dx = 0, dy = 0;
      if (input.up) { setDir(tank, 0); dy = -tank.speed * dt; }
      else if (input.right) { setDir(tank, 1); dx = tank.speed * dt; }
      else if (input.down) { setDir(tank, 2); dy = tank.speed * dt; }
      else if (input.left) { setDir(tank, 3); dx = -tank.speed * dt; }
      if (dx || dy) tryMove(tank, dx, dy);
      if (input.fire) { fire(tank); input.fire = false; }
    } else {
      tank.aiTimer -= dt;
      if (tank.aiTimer <= 0) {
        tank.aiTimer = 0.6 + Math.random() * 1.4;
        const bX = s.baseTile.x * TILE, bY = s.baseTile.y * TILE;
        const wantDir = Math.abs(bX - tank.x) > Math.abs(bY - tank.y)
          ? (bX > tank.x ? 1 : 3) : (bY > tank.y ? 2 : 0);
        setDir(tank, Math.random() < 0.5 ? wantDir : Math.floor(Math.random() * 4));
      }
      let dx = 0, dy = 0;
      if (tank.dir === 0) dy = -tank.speed * dt;
      if (tank.dir === 1) dx = tank.speed * dt;
      if (tank.dir === 2) dy = tank.speed * dt;
      if (tank.dir === 3) dx = -tank.speed * dt;
      if (!tryMove(tank, dx, dy)) tank.aiTimer = 0;
      if (Math.random() < dt * 1.4) fire(tank);
    }
  };

  const update = (dt) => {
    const s = stateRef.current;
    if (!s.running || s.paused) return;
    if (s.player && s.player.alive) updateTank(s.player, dt);
    s.spawnTimer -= dt;
    const aliveEnemies = s.enemies.filter(e => e.alive).length;
    if (s.remainingSpawns > 0 && aliveEnemies < 4 && s.spawnTimer <= 0) {
      spawnEnemy(); s.remainingSpawns--; s.spawnTimer = 2.5;
    }
    s.enemies.forEach(e => { if (e.alive) updateTank(e, dt); });
    for (const b of s.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      const r = bulletHitsMap(b);
      if (r) { explode(b.x, b.y, r === "brick" ? "#c44536" : "#888"); s.bullets.splice(i, 1); continue; }
      if (b.x < 0 || b.y < 0 || b.x > GRID * TILE || b.y > GRID * TILE) s.bullets.splice(i, 1);
    }
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      const targets = b.owner.isPlayer ? s.enemies : (s.player && s.player.alive ? [s.player] : []);
      for (const t of targets) {
        if (!t.alive || t.spawnFlash > 0) continue;
        if (overlapRect({ x: b.x, y: b.y, w: b.w, h: b.h }, { x: t.x, y: t.y, w: t.size, h: t.size })) {
          t.alive = false;
          explode(t.x + t.size / 2, t.y + t.size / 2, t.isPlayer ? "#ffe600" : "#ff6a00");
          if (t.isPlayer) triggerLose("Tank destroyed.");
          else { s.score += 100; setHud(h => ({ ...h, score: s.score })); }
          s.bullets.splice(i, 1);
          break;
        }
      }
    }
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const p = s.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) s.particles.splice(i, 1);
    }
    if (s.running && s.remainingSpawns === 0 && s.enemies.every(e => !e.alive)) triggerWin();
    setHud(h => ({ ...h, enemiesLeft: s.enemies.filter(e => e.alive).length + s.remainingSpawns }));
  };

  const drawTile = (ctx, x, y, t) => {
    const px = x * TILE, py = y * TILE;
    if (t === T_BRICK) {
      ctx.fillStyle = "#c44536"; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = "#7a2417";
      ctx.fillRect(px, py + 3, TILE, 1); ctx.fillRect(px, py + 11, TILE, 1);
      ctx.fillRect(px + 7, py, 1, 3); ctx.fillRect(px + 3, py + 4, 1, 7); ctx.fillRect(px + 11, py + 12, 1, 4);
    } else if (t === T_STEEL) {
      ctx.fillStyle = "#9a9a9a"; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = "#cdcdcd"; ctx.fillRect(px + 1, py + 1, 6, 6); ctx.fillRect(px + 9, py + 9, 6, 6);
      ctx.fillStyle = "#5e5e5e"; ctx.fillRect(px + 9, py + 1, 6, 6); ctx.fillRect(px + 1, py + 9, 6, 6);
    }
  };

  const drawBase = (ctx) => {
    const s = stateRef.current;
    const x = s.baseTile.x * TILE, y = s.baseTile.y * TILE;
    ctx.fillStyle = "#0052ff"; ctx.fillRect(x, y, TILE * 2, TILE * 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + 8, y + 6, 3, 20);
    ctx.fillRect(x + 11, y + 6, 10, 4);
    ctx.fillRect(x + 11, y + 14, 10, 4);
    ctx.fillRect(x + 11, y + 22, 10, 4);
    ctx.fillRect(x + 18, y + 10, 3, 4);
    ctx.fillRect(x + 18, y + 18, 3, 4);
  };

  const drawTank = (ctx, tank) => {
    if (tank.spawnFlash > 0 && Math.floor(tank.spawnFlash * 10) % 2 === 0) return;
    const ix = Math.round(tank.x), iy = Math.round(tank.y);
    const sz = tank.size;
    ctx.save();
    ctx.translate(ix + sz / 2, iy + sz / 2);
    ctx.rotate(tank.dir * (Math.PI / 2));
    ctx.fillStyle = tank.color; ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
    ctx.fillStyle = "#222";
    ctx.fillRect(-sz / 2, -sz / 2, 4, sz); ctx.fillRect(sz / 2 - 4, -sz / 2, 4, sz);
    ctx.fillStyle = "#000";
    for (let i = -sz / 2 + 2; i < sz / 2; i += 4) {
      ctx.fillRect(-sz / 2, i, 4, 2); ctx.fillRect(sz / 2 - 4, i, 4, 2);
    }
    ctx.fillStyle = tank.isPlayer ? "#a07a2a" : "#7a7a7a";
    ctx.fillRect(-sz / 2 + 5, -sz / 2 + 4, sz - 10, sz - 8);
    ctx.fillStyle = tank.color;
    ctx.fillRect(-3, -sz / 2 - 1, 6, sz / 2 + 2);
    ctx.fillStyle = "#000"; ctx.fillRect(-2, -sz / 2 - 1, 4, 4);
    if (tank.isPlayer) { ctx.fillStyle = "#fff"; ctx.fillRect(-2, -2, 4, 4); }
    ctx.restore();
  };

  const render = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, GRID * TILE, GRID * TILE);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) drawTile(ctx, x, y, s.map[y]?.[x] || 0);
    drawBase(ctx);
    ctx.fillStyle = "#fff";
    for (const b of s.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
    s.enemies.forEach(e => e.alive && drawTank(ctx, e));
    if (s.player && s.player.alive) drawTank(ctx, s.player);
    for (const p of s.particles) {
      ctx.fillStyle = p.color;
      const sz = Math.max(1, Math.floor(p.life * 6));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
    }
  };

  useEffect(() => {
    let raf = 0;
    const loop = (ts) => {
      const s = stateRef.current;
      if (!s.lastTime) s.lastTime = ts;
      const dt = Math.min(0.05, (ts - s.lastTime) / 1000);
      s.lastTime = ts;
      update(dt); render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const down = (e) => {
      const i = inputRef.current;
      if (e.key === "ArrowUp") i.up = true;
      if (e.key === "ArrowDown") i.down = true;
      if (e.key === "ArrowLeft") i.left = true;
      if (e.key === "ArrowRight") i.right = true;
      if (e.key === " ") i.fire = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    };
    const up = (e) => {
      const i = inputRef.current;
      if (e.key === "ArrowUp") i.up = false;
      if (e.key === "ArrowDown") i.down = false;
      if (e.key === "ArrowLeft") i.left = false;
      if (e.key === "ArrowRight") i.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const setInput = (k, v) => { inputRef.current[k] = v; };

  // ------- Wallet & payment -------
  const getEthProvider = async () => {
    // 1) Mini App SDK provider (when running inside Base App / Warpcast)
    //    Loaded via runtime <script> in useEffect above; available on window.
    try {
      if (typeof window !== "undefined" && window.__farcasterSdk?.wallet?.ethProvider) {
        return window.__farcasterSdk.wallet.ethProvider;
      }
    } catch {}
    // 2) Browser wallet (MetaMask / Coinbase Wallet extension)
    if (typeof window !== "undefined" && window.ethereum) return window.ethereum;
    return null;
  };

  const connectWallet = async () => {
    const p = await getEthProvider();
    if (!p) {
      showToast("No wallet found. Open in Base App or install Coinbase Wallet.");
      return null;
    }
    try {
      const accounts = await p.request({ method: "eth_requestAccounts" });
      const a = accounts[0];
      setAccount(a);
      // ensure on Base
      try {
        const cid = await p.request({ method: "eth_chainId" });
        if (cid !== BASE_CHAIN_HEX) {
          try {
            await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_HEX }] });
          } catch (err) {
            if (err?.code === 4902) {
              await p.request({ method: "wallet_addEthereumChain", params: [BASE_CHAIN_PARAMS] });
            }
          }
        }
      } catch {}
      return a;
    } catch {
      showToast("Connection cancelled");
      return null;
    }
  };

  const usdToWeiHex = async (usd) => {
    let ethUsd = 3000;
    try {
      const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
      const j = await r.json();
      const p = parseFloat(j?.data?.amount);
      if (p > 0) ethUsd = p;
    } catch {}
    const eth = usd / ethUsd;
    const wei = BigInt(Math.floor(eth * 1e18));
    return "0x" + wei.toString(16);
  };

  const startLevel = () => {
    const s = stateRef.current;
    const cfg = LEVELS[(s.level - 1) % LEVELS.length];
    buildMap(cfg.layout);
    s.enemies = []; s.bullets = []; s.particles = [];
    s.remainingSpawns = cfg.enemies; s.spawnTimer = 1.0;
    s.player = newTank(8 * TILE, 24 * TILE, true);
    s.running = true; s.paused = false;
    setOverlay(null);
    setHud({ level: s.level, lives: s.lives, score: s.score, enemiesLeft: cfg.enemies });
  };

  const payAndStart = async () => {
    let acc = account;
    if (!acc) acc = await connectWallet();
    if (!acc) return;
    const p = await getEthProvider();
    if (!p) return;
    setOverlay("paying");
    try {
      const valueHex = await usdToWeiHex(ENTRY_FEE_USD);
      const hash = await p.request({
        method: "eth_sendTransaction",
        params: [{ from: acc, to: RECIPIENT, value: valueHex }],
      });
      showToast("TX sent: " + hash.slice(0, 10) + "…");
      startLevel();
    } catch (e) {
      setOverlay("start");
      showToast(e?.message?.slice(0, 60) || "Transaction rejected");
    }
  };

  const handleRetry = () => {
    const s = stateRef.current;
    if (s.lives <= 0) {
      s.level = 1; s.lives = 3; s.score = 0;
      setHud({ level: 1, lives: 3, score: 0, enemiesLeft: 0 });
    }
    payAndStart();
  };

  // ---------- JSX ----------
  return (
    <div className="container">
      <header>
        <div className="logo">BASE TANKS</div>
        <div className="subtitle">◆ ON-CHAIN BATTLE CITY ◆</div>
      </header>

      <div className="wallet-bar">
        <div className="wallet-info">
          <span className="wallet-status" style={{ color: account ? "#4caf50" : "#ffe600" }}>
            {account ? "⬢ CONNECTED" : "⬢ NOT CONNECTED"}
          </span>
          {account && <span className="wallet-address">{account.slice(0, 6)}…{account.slice(-4)}</span>}
        </div>
        {!account && <button onClick={connectWallet}>CONNECT</button>}
      </div>

      <div className="game-stage">
        <div className="canvas-wrap">
          <canvas ref={canvasRef} width={GRID * TILE} height={GRID * TILE} />

          {overlay === "start" && (
            <div className="overlay">
              <h2>READY?</h2>
              <p>Destroy all enemy tanks and defend your base.</p>
              <div className="price-tag">ENTRY FEE: ${ENTRY_FEE_USD.toFixed(2)} on BASE</div>
              <button className="btn-pay" onClick={payAndStart}>
                {account ? "PAY & START LEVEL" : "CONNECT & PLAY"}
              </button>
            </div>
          )}
          {overlay === "win" && (
            <div className="overlay">
              <h2>VICTORY!</h2>
              <p>Level cleared! Onward.</p>
              <button className="btn-pay" onClick={payAndStart}>NEXT LEVEL — ${ENTRY_FEE_USD.toFixed(2)}</button>
            </div>
          )}
          {overlay === "lose" && (
            <div className="overlay">
              <h2>GAME OVER</h2>
              <p>Tank destroyed.</p>
              <button className="btn-pay" onClick={handleRetry}>RETRY — ${ENTRY_FEE_USD.toFixed(2)}</button>
            </div>
          )}
          {overlay === "paying" && (
            <div className="overlay">
              <h2 className="blink">SIGNING…</h2>
              <p>Confirm the transaction in your wallet</p>
            </div>
          )}
        </div>

        <div className="touch-controls">
          <button className="tc-up"
            onTouchStart={(e) => { e.preventDefault(); setInput("up", true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput("up", false); }}>▲</button>
          <button className="tc-lt"
            onTouchStart={(e) => { e.preventDefault(); setInput("left", true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput("left", false); }}>◀</button>
          <button className="tc-fire"
            onTouchStart={(e) => { e.preventDefault(); setInput("fire", true); }}>FIRE</button>
          <button className="tc-rt"
            onTouchStart={(e) => { e.preventDefault(); setInput("right", true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput("right", false); }}>▶</button>
          <button className="tc-dn"
            onTouchStart={(e) => { e.preventDefault(); setInput("down", true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput("down", false); }}>▼</button>
        </div>

        <aside className="stats-panel">
          <div className="stat"><div className="stat-label">LEVEL</div><div className="stat-value">{hud.level}</div></div>
          <div className="stat"><div className="stat-label">ENEMIES</div><div className="stat-value">{hud.enemiesLeft}</div></div>
          <div className="stat"><div className="stat-label">LIVES</div><div className="stat-value">{hud.lives}</div></div>
          <div className="stat"><div className="stat-label">SCORE</div><div className="stat-value">{hud.score}</div></div>
          <div className="stat"><div className="stat-label">CHAIN</div><div className="stat-value" style={{ fontSize: 16, color: "#00d4ff" }}>BASE</div></div>
        </aside>
      </div>

      <div className="controls-info">
        <h3>CONTROLS</h3>
        <span className="key">↑</span><span className="key">↓</span><span className="key">←</span><span className="key">→</span> move ·{" "}
        <span className="key">SPACE</span> fire
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
