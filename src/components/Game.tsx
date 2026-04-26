import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface GameProps {
  onGameOver: (score: number, collected: number) => void;
  onScoreUpdate: (score: number) => void;
  onMoneyCollect: (amount: number, dropId?: string) => void;
  userProfile?: any;
  isTestMode: boolean;
}

const WORLD_SIZE = 4000;
const INITIAL_LENGTH = 10;
const SNAKE_SPEED = 4;
const BOT_SPEED = 3.5;
const SEGMENT_GAP = 12;
const SNAKE_RADIUS = 10;
const MAX_SNAKE_RADIUS = 15;
const MAX_SNAKE_LENGTH = 100;
const FOOD_RADIUS = 5;

// Helper for dynamic radius based on score
function getSnakeRadius(score: number) {
  return Math.min(MAX_SNAKE_RADIUS, Math.max(SNAKE_RADIUS, SNAKE_RADIUS + ((score - 10) / 90) * (MAX_SNAKE_RADIUS - SNAKE_RADIUS)));
}
const MAX_FOODS = 300; // Reduced for performance with multiplayer
const BOT_COUNT = 15; // Reduced to make room for real players
const TURN_SPEED = 0.1;

const COLORS = [
  '#FF3366', '#33CCFF', '#FF9933', '#33FF99', 
  '#CC33FF', '#FFFF33', '#FF3333', '#3333FF'
];

interface Point {
  x: number;
  y: number;
}

interface Snake {
  id: string;
  isPlayer: boolean;
  name: string;
  segments: Point[];
  color: string;
  angle: number;
  targetAngle: number;
  score: number;
  collectedMoney: number;
  dead: boolean;
  lastUpdate?: number;
}

interface Food {
  id: string;
  x: number;
  y: number;
  color: string;
  value: number;
  moneyValue: number;
  isDrop?: boolean;
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function lerpAngle(a: number, b: number, t: number) {
  const diff = b - a;
  let delta = (diff + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export default function Game({ onGameOver, onScoreUpdate, onMoneyCollect, userProfile, isTestMode }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameOverRef = useRef(onGameOver);
  const scoreUpdateRef = useRef(onScoreUpdate);
  const moneyCollectRef = useRef(onMoneyCollect);
  
  // Realtime state
  const channelRef = useRef<any>(null);
  const remotePlayersRef = useRef<Map<string, Snake>>(new Map());
  const dropsRef = useRef<Food[]>([]);

  useEffect(() => {
    gameOverRef.current = onGameOver;
    scoreUpdateRef.current = onScoreUpdate;
    moneyCollectRef.current = onMoneyCollect;
  }, [onGameOver, onScoreUpdate, onMoneyCollect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationId: number;
    let isRunning = true;
    
    // Clear any stale remote players on mount
    remotePlayersRef.current.clear();
    
    console.log('Initializing Game component...', { isTestMode, userProfileId: userProfile?.id });
    const localPlayerId = userProfile?.id || 'player-' + Math.random().toString(36).slice(2, 7);
    
    // 1. Initialize Player first to avoid any reference errors
    const pStartPos = { x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE };
    const playerSegments: Point[] = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
        playerSegments.push({ x: pStartPos.x, y: pStartPos.y + i * SEGMENT_GAP });
    }

    let player: Snake = {
      id: localPlayerId,
      isPlayer: true,
      name: userProfile?.name || 'You',
      segments: playerSegments,
      color: '#38BDF8',
      angle: -Math.PI / 2,
      targetAngle: -Math.PI / 2,
      score: INITIAL_LENGTH,
      collectedMoney: 0,
      dead: false
    };

    // 2. Setup safe getSafeSpawnPoint
    const getSafeSpawnPoint = (excludePlayer = false) => {
      let maxAttempts = 15;
      const allActive = (excludePlayer || !player ? bots : [player, ...bots]).filter(b => b && !b.dead);
      let spawnX = Math.random() * WORLD_SIZE;
      let spawnY = Math.random() * WORLD_SIZE;

      while (maxAttempts > 0) {
        let isSafe = true;
        for (const s of allActive) {
          const head = s.segments?.[0];
          if (!head) continue;
          const dx = head.x - spawnX;
          const dy = head.y - spawnY;
          if (dx * dx + dy * dy < 800 * 800) {
            isSafe = false;
            break;
          }
        }
        if (isSafe) break;
        spawnX = Math.random() * WORLD_SIZE;
        spawnY = Math.random() * WORLD_SIZE;
        maxAttempts--;
      }
      return { x: spawnX, y: spawnY };
    }

    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', handleResize);

    let mouseX = width / 2;
    let mouseY = height / 2;
    let isDashing = false;
    let spectateTargetId: string | null = null;
    let deathTime: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    const handleMouseDown = () => { isDashing = true; };
    const handleMouseUp = () => { isDashing = false; };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    // Multiplayer Sync Init
    const channel = supabase.channel('arena', {
      config: { broadcast: { self: false } }
    });

    try {
      channel
        .on('broadcast', { event: 'pos' }, ({ payload }) => {
          const { id, name, segments, angle, score, color } = payload;
          if (id === localPlayerId) return;
          remotePlayersRef.current.set(id, {
            id, name, segments, angle, score, color,
            isPlayer: false, dead: false, targetAngle: angle,
            collectedMoney: 0, lastUpdate: Date.now()
          });
        })
        .on('broadcast', { event: 'death' }, ({ payload }) => {
          const { id } = payload;
          const victim = remotePlayersRef.current.get(id);
          if (victim) victim.dead = true;
        })
        .subscribe();
    } catch (e) {
      console.error('Multiplayer channel error:', e);
    }

    channelRef.current = channel;

    const dropsChannelId = `drops-db-${Math.random().toString(36).slice(2, 7)}`;
    const dropsSubscription = supabase
      .channel(dropsChannelId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drops' }, payload => {
        const drop = payload.new;
        dropsRef.current.push({
          id: drop.id, x: drop.x, y: drop.y, color: '#34D399', value: 5,
          moneyValue: Number(drop.money_value), isDrop: true
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drops' }, payload => {
        if (payload.new.claimed_by) {
          dropsRef.current = dropsRef.current.filter(d => d.id !== payload.new.id);
        }
      })
      .subscribe();

    supabase.from('drops').select('*').is('claimed_by', null).then(({ data }) => {
      if (data) {
        dropsRef.current = data.map(d => ({
          id: d.id, x: d.x, y: d.y, color: '#34D399', value: 5,
          moneyValue: Number(d.money_value), isDrop: true
        }));
      }
    });

    let foods: Food[] = [];
    let bots: Snake[] = [];
    const effectiveBotCount = isTestMode ? BOT_COUNT : 0;
    const BOT_NAMES = ['destroyer', 'slyther', 'venom', 'snek', 'noodle', 'danger_noodle', 'worm', 'alpha', 'beta', 'chomper', 'glizzy', 'slithers', 'voldemort', 'python', 'anaconda', 'boa', 'cobra', 'mamba', 'viper', 'rattler', 'basilisk', 'serpent', 'slimy', 'scaly', 'fang', 'hiss'];

    const spawnFood = (x?: number, y?: number, val?: number, moneyVal?: number, customColor?: string) => {
        const colors = ['#38BDF8', '#818CF8', '#C084FC', '#F472B6', '#FB7185', '#FBBF24', '#34D399'];
        const food = {
            id: Math.random().toString(36),
            x: Math.max(20, Math.min(WORLD_SIZE - 20, x ?? Math.random() * WORLD_SIZE)),
            y: Math.max(20, Math.min(WORLD_SIZE - 20, y ?? Math.random() * WORLD_SIZE)),
            color: customColor ?? colors[Math.floor(Math.random() * colors.length)],
            value: val ?? 1,
            moneyValue: moneyVal ?? 0.01,
            isDrop: moneyVal && moneyVal > 0.01 ? true : false
        };
        foods.push(food);
    };

    const spawnBot = () => {
      const pos = getSafeSpawnPoint();
      const length = Math.floor(Math.random() * 20) + 10;
      const segs: Point[] = [];
      for (let i = 0; i < length; i++) segs.push({ x: pos.x, y: pos.y });
      bots.push({
        id: 'bot-' + Math.random().toString(36),
        isPlayer: false,
        name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
        segments: segs,
        color: randomColor(),
        angle: Math.random() * Math.PI * 2,
        targetAngle: Math.random() * Math.PI * 2,
        score: length,
        collectedMoney: 0,
        dead: false
      });
    };

    for (let i = 0; i < MAX_FOODS; i++) spawnFood();
    for (let i = 0; i < effectiveBotCount; i++) spawnBot();

    const killSnake = async (snake: Snake) => {
      if (snake.dead) return;
      snake.dead = true;
      
      // Economic Calculation based on user request
      // Total Drop Value = (Base Drop: $0.50) + (50% of the dead snake's collectedMoney)
      const totalWealth = 0.50 + (snake.collectedMoney * 0.5);
      // Applying 5% House Rake
      const lootToDrop = totalWealth * 0.95;
      
      // Distribute loot across segments as Gold Orbs
      const segmentsToDrop = snake.segments.filter((_, i) => i % 2 === 0);
      const moneyPerOrb = lootToDrop / Math.max(1, segmentsToDrop.length);

      segmentsToDrop.forEach((seg) => {
        // Use rainbow colors for death drops as well to unify the look
        const rainbowColors = ['#38BDF8', '#818CF8', '#C084FC', '#F472B6', '#FB7185', '#FBBF24', '#34D399'];
        const randomRainbow = rainbowColors[Math.floor(Math.random() * rainbowColors.length)];
        spawnFood(seg.x, seg.y, 3, moneyPerOrb, randomRainbow);
      });

      if (snake.isPlayer) {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'death',
          payload: { id: snake.id }
        });

        // Secure backend processing for death (e.g., 50% penalty clawback)
        const head = snake.segments[0];
        const { data: { session: authSession } } = await supabase.auth.getSession();
        
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            action: 'DIE',
            payload: { 
              x: head.x, 
              y: head.y,
              sessionEarnings: snake.collectedMoney, // Pass earnings for penalty calculation
              userId: userProfile?.id
            }
          })
        }).catch(err => console.error('Death sync error:', err));

        deathTime = Date.now();

        // Pick a random survivor to spectate (but delay camera switch in loop)
        const survivors = [...bots, ...Array.from(remotePlayersRef.current.values())].filter(s => !s.dead);
        if (survivors.length > 0) {
          spectateTargetId = survivors[Math.floor(Math.random() * survivors.length)].id;
        }
      }
    };

    let lastTime = performance.now();
    let gameOverTriggered = false;
    let syncTimer = 0;

    const loop = (time: number) => {
      if (!isRunning) return;
      const dt = time - lastTime;
      lastTime = time;

      if (!player || !player.segments || player.segments.length === 0) {
        console.warn('Player not initialized in loop');
        if (isRunning) animationId = requestAnimationFrame(loop);
        return;
      }

      const head = player.segments[0];
      if (!player.dead && head) {
          const screenDx = mouseX - width / 2;
          const screenDy = mouseY - height / 2;
          player.targetAngle = Math.atan2(screenDy, screenDx);
          
          // Sync position periodically
          syncTimer += dt;
          if (syncTimer > 50) { // 20fps sync
            channelRef.current?.send({
              type: 'broadcast',
              event: 'pos',
              payload: {
                id: player.id,
                name: player.name,
                segments: player.segments.slice(0, 30), // Only sync first 30 for perf
                angle: player.angle,
                score: player.score,
                color: player.color
              }
            });
            syncTimer = 0;
          }
      }

      // Remove stale remote players (inactive for > 5s)
      const now = Date.now();
      for (const [id, s] of remotePlayersRef.current.entries()) {
        if (s.lastUpdate && now - s.lastUpdate > 5000) {
          remotePlayersRef.current.delete(id);
        }
      }

      const allSnakes = [player, ...bots].filter(s => !s.dead);

      allSnakes.forEach(snake => {
        let isSnakeDashing = false;
        if (!snake.isPlayer) {
          if (Math.random() < 0.02) snake.targetAngle += (Math.random() - 0.5) * Math.PI;
          const botHead = snake.segments[0];
          const margin = 200;
          if (botHead.x < margin || botHead.x > WORLD_SIZE - margin ||
              botHead.y < margin || botHead.y > WORLD_SIZE - margin) {
              snake.targetAngle = Math.atan2(WORLD_SIZE/2 - botHead.y, WORLD_SIZE/2 - botHead.x);
          }
        } else {
           isSnakeDashing = isDashing && snake.score > INITIAL_LENGTH;
        }

        snake.angle = lerpAngle(snake.angle, snake.targetAngle, Math.min(1, TURN_SPEED * (isSnakeDashing ? 0.6 : 1)));
        const baseSpeed = snake.isPlayer ? SNAKE_SPEED : BOT_SPEED;
        const speed = baseSpeed * (isSnakeDashing ? 2.2 : 1);
        
        const head = snake.segments[0];
        head.x += Math.cos(snake.angle) * speed;
        head.y += Math.sin(snake.angle) * speed;

        if (head.x < 0 || head.x > WORLD_SIZE || head.y < 0 || head.y > WORLD_SIZE) {
            if (snake.isPlayer) { killSnake(snake); return; }
            else { head.x = Math.max(0, Math.min(WORLD_SIZE, head.x)); head.y = Math.max(0, Math.min(WORLD_SIZE, head.y)); snake.angle += Math.PI; }
        }

        for (let i = 1; i < snake.segments.length; i++) {
          const prev = snake.segments[i - 1];
          const curr = snake.segments[i];
          const dx = prev.x - curr.x;
          const dy = prev.y - curr.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > SEGMENT_GAP) {
            const moveAmt = dist - SEGMENT_GAP;
            curr.x += (dx / dist) * moveAmt;
            curr.y += (dy / dist) * moveAmt;
          }
        }

        if (isSnakeDashing && Math.random() < 0.1) {
          snake.score -= 1;
          if (snake.isPlayer) scoreUpdateRef.current(snake.score);
          const tail = snake.segments[snake.segments.length - 1];
          spawnFood(tail.x, tail.y, 1, 0); // Dash drops have 0 value
        }

        const targetLength = Math.min(MAX_SNAKE_LENGTH, Math.max(1, snake.score));
        while (snake.segments.length > targetLength) snake.segments.pop();
        while (snake.segments.length < targetLength) {
          const tail = snake.segments[snake.segments.length - 1];
          if (tail) snake.segments.push({ x: tail.x, y: tail.y });
          else break;
        }
      });

      // Food & Drop Collision
      const sHead = player.segments[0];
      if (!player.dead && sHead) {
        const sRadius = getSnakeRadius(player.score);
        
        // Check regular food
        for (let f = foods.length - 1; f >= 0; f--) {
          const food = foods[f];
          const dx = sHead.x - food.x;
          const dy = sHead.y - food.y;
          if (dx * dx + dy * dy < (sRadius + FOOD_RADIUS) * (sRadius + FOOD_RADIUS)) {
            player.score += food.value;
            player.collectedMoney += food.moneyValue || 0;
            foods.splice(f, 1);
            scoreUpdateRef.current(player.score);
            if (food.moneyValue > 0) moneyCollectRef.current(food.moneyValue);
          }
        }

        // Check database drops
        for (let f = dropsRef.current.length - 1; f >= 0; f--) {
          const drop = dropsRef.current[f];
          const dx = sHead.x - drop.x;
          const dy = sHead.y - drop.y;
          if (dx * dx + dy * dy < (sRadius + FOOD_RADIUS * 2) * (sRadius + FOOD_RADIUS * 2)) {
            const claimedDrop = dropsRef.current.splice(f, 1)[0];
            moneyCollectRef.current(claimedDrop.moneyValue, claimedDrop.id);
            player.score += 5; // Extra score for gold drops
            scoreUpdateRef.current(player.score);
          }
        }
      }

      // Snake vs Snake Collision (Full collision matrix)
      const activeSnakes = [...allSnakes, ...Array.from(remotePlayersRef.current.values()).filter(s => !s.dead)];
      
      activeSnakes.forEach(snake => {
        if (snake.dead || snake.segments.length < 2) return;
        const head = snake.segments[0];
        const radius = getSnakeRadius(snake.score);
        
        for (const other of activeSnakes) {
          if (other.id === snake.id || other.dead) continue;
          const otherRadius = getSnakeRadius(other.score);
          const hitDistSq = (radius * 0.8 + otherRadius * 0.8) ** 2;
          
          // Check collision with other snake's body
          for (let j = 0; j < other.segments.length; j += 2) {
            const part = other.segments[j];
            const dx = head.x - part.x;
            const dy = head.y - part.y;
            if (dx * dx + dy * dy < hitDistSq) {
              killSnake(snake);
              return;
            }
          }
        }
      });

      while (bots.length < effectiveBotCount) spawnBot();
      while (foods.length < MAX_FOODS) spawnFood();

      if (player.dead && !gameOverTriggered && deathTime && (Date.now() - deathTime > 3500)) {
        gameOverTriggered = true;
        gameOverRef.current(player.score, player.collectedMoney);
      }

      // RENDER
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, width, height);

      if (!player || !player.segments || player.segments.length === 0) {
         if (isRunning) animationId = requestAnimationFrame(loop);
         return;
      }

      let cameraHead = player.segments[0];
      const isSpectating = player.dead && spectateTargetId && deathTime && (Date.now() - deathTime > 3000);

      if (isSpectating) {
        const activeSnakes = [...bots, ...Array.from(remotePlayersRef.current.values())];
        const target = activeSnakes.find(s => s.id === spectateTargetId);
        if (target && !target.dead) {
          cameraHead = target.segments[0];
        } else {
          const next = activeSnakes.find(s => !s.dead);
          if (next) spectateTargetId = next.id;
        }
      }

      const pCameraHead = cameraHead || { x: WORLD_SIZE/2, y: WORLD_SIZE/2 };
      ctx.save();
      ctx.translate(width / 2 - pCameraHead.x, height / 2 - pCameraHead.y);

      // Map Boundary Border
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)'; // Sky-400
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);
      
      // Subtle Grid for better orientation
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
      ctx.lineWidth = 2;
      const gridSize = 200;
      for (let x = 0; x <= WORLD_SIZE; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_SIZE); ctx.stroke();
      }
      for (let y = 0; y <= WORLD_SIZE; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_SIZE, y); ctx.stroke();
      }
      // Food & Drops
      [...foods, ...dropsRef.current].forEach(f => {
        if (f.x > pCameraHead.x - width/2 - 100 && f.x < pCameraHead.x + width/2 + 100 &&
            f.y > pCameraHead.y - height/2 - 100 && f.y < pCameraHead.y + height/2 + 100) {
          
          if (f.isDrop) {
            // Money Drops now look like vibrant rainbow food but slightly larger/pulsing
            const pulse = Math.sin(Date.now() / 200) * 0.5 + 0.5;
            const dropRadius = FOOD_RADIUS * 1.5;
            
            ctx.beginPath();
            ctx.arc(f.x, f.y, dropRadius + (pulse * 2), 0, Math.PI * 2);
            ctx.fillStyle = f.color;
            ctx.fill();
            
            // Subtle inner glow to distinguish from regular food
            ctx.beginPath();
            ctx.arc(f.x, f.y, dropRadius * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fill();
          } else {
            // Regular rainbow food
            ctx.beginPath();
            ctx.arc(f.x, f.y, FOOD_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = f.color;
            ctx.fill();
          }
        }
      });

      // All Snakes
      const snakesToDraw = [...bots, ...Array.from(remotePlayersRef.current.values())].filter(s => !s.dead);
      if (!player.dead) snakesToDraw.push(player);

      snakesToDraw.forEach(s => {
        for (let i = s.segments.length - 1; i >= 0; i--) {
          const seg = s.segments[i];
          if (seg.x < pCameraHead.x - width/2 - 100 || seg.x > pCameraHead.x + width/2 + 100 ||
              seg.y < pCameraHead.y - height/2 - 100 || seg.y > pCameraHead.y + height/2 + 100) continue;

          ctx.beginPath();
          const baseRadius = getSnakeRadius(s.score);
          const radius = Math.max(3, baseRadius * (1 - i / (s.segments.length * 1.5)));
          ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = s.isPlayer ? (i%2===0 ? '#38BDF8' : '#0EA5E9') : s.color;
          if (!s.isPlayer) ctx.globalAlpha = i%2===0 ? 1 : 0.8;
          ctx.fill();
          ctx.globalAlpha = 1;
          
          if (i === 0) {
             ctx.fillStyle = 'white';
             for (let sign of [-1, 1]) {
                const ex = seg.x + Math.cos(s.angle + sign * 0.8) * radius * 0.5;
                const ey = seg.y + Math.sin(s.angle + sign * 0.8) * radius * 0.5;
                ctx.beginPath(); ctx.arc(ex, ey, radius * 0.3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(ex, ey, radius * 0.15, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'white';
             }
          }
        }
        const head = s.segments[0];
        if (head) {
           ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
           ctx.font = "bold 12px Inter, sans-serif";
           ctx.textAlign = "center";
           ctx.fillText(s.name, head.x, head.y - getSnakeRadius(s.score) - 10);
        }
      });

      ctx.restore();

      // Minimap
      const mapSize = width < 768 ? 120 : 180;
      const mapMargin = 24;
      const mapScale = mapSize / WORLD_SIZE;
      
      ctx.save();
      ctx.translate(mapMargin, height - mapSize - mapMargin);
      
      // Map Background
      ctx.fillStyle = 'rgba(15,23,42,0.4)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(0, 0, mapSize, mapSize, 12);
      } else {
        ctx.rect(0, 0, mapSize, mapSize);
      }
      ctx.fill();
      

      snakesToDraw.forEach(s => {
        const head = s.segments[0];
        if (!head) return;
        
        ctx.fillStyle = s.isPlayer ? '#38BDF8' : 'rgba(255,255,255,0.4)';
        const dotSize = s.isPlayer ? 3 : 2;
        
        ctx.beginPath();
        ctx.arc(head.x * mapScale, head.y * mapScale, dotSize, 0, Math.PI * 2);
        ctx.fill();
        
        if (s.isPlayer) {
          // Glow for player on map
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#38BDF8';
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });
      
      // Render Drops on Map
      dropsRef.current.forEach(d => {
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.arc(d.x * mapScale, d.y * mapScale, 1, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // UI
      const margin = 20;
      const topSnakes = [...snakesToDraw].sort((a, b) => b.score - a.score).slice(0, 10);
      const isMobile = width < 768;
      const leaderboardY = isMobile ? 180 : 68;
      
      ctx.fillStyle = 'rgba(15,23,42,0.6)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(width - 200 - margin, leaderboardY, 200, 30 + topSnakes.length * 20, 16);
      } else {
        ctx.rect(width - 200 - margin, leaderboardY, 200, 30 + topSnakes.length * 20);
      }
      ctx.fill();
      
      ctx.font = 'bold 12px Inter, sans-serif'; 
      ctx.textAlign = 'center'; 
      ctx.fillStyle = '#38BDF8';
      ctx.fillText('ARENA LEADERS', width - 100 - margin, leaderboardY + 18);
      
      topSnakes.forEach((s, idx) => {
         ctx.textAlign = 'left'; 
         ctx.fillStyle = s.isPlayer ? '#38BDF8' : 'rgba(255,255,255,0.7)';
         ctx.fillText(`${idx + 1}. ${s.name.slice(0, 12)}`, width - 190 - margin, leaderboardY + 38 + idx * 20);
         ctx.textAlign = 'right'; 
         ctx.fillText(`${Math.floor(s.score)}`, width - 10 - margin, leaderboardY + 38 + idx * 20);
      });

      if (isRunning) animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      channel.unsubscribe();
      dropsSubscription.unsubscribe();
    };
  }, [userProfile?.id, isTestMode]);

  return <canvas ref={canvasRef} className="block w-full h-full cursor-crosshair touch-none" />;
}
