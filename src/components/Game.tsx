import { useEffect, useRef } from 'react';

interface GameProps {
  onGameOver: (score: number) => void;
  onScoreUpdate: (score: number) => void;
  onMoneyCollect: (amount: number) => void;
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
  // Linearly scale from SNAKE_RADIUS to MAX_SNAKE_RADIUS as score goes from 10 to 100
  return Math.min(MAX_SNAKE_RADIUS, Math.max(SNAKE_RADIUS, SNAKE_RADIUS + ((score - 10) / 90) * (MAX_SNAKE_RADIUS - SNAKE_RADIUS)));
}
const MAX_FOODS = 500;
const BOT_COUNT = 25;
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
}

interface Food {
  id: string;
  x: number;
  y: number;
  color: string;
  value: number; // bigger food dropped by dead snakes
  moneyValue: number;
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function lerpAngle(a: number, b: number, t: number) {
  const diff = b - a;
  // normalize diff to -PI to PI
  let delta = (diff + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export default function Game({ onGameOver, onScoreUpdate, onMoneyCollect }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameOverRef = useRef(onGameOver);
  const scoreUpdateRef = useRef(onScoreUpdate);
  const moneyCollectRef = useRef(onMoneyCollect);

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
    
    // Resize
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

    // Mouse Tracking
    let mouseX = width / 2;
    let mouseY = height / 2;
    let isDashing = false;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    const handleMouseDown = () => { isDashing = true; };
    const handleMouseUp = () => { isDashing = false; };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    
    // Touch tracking
    const handleTouchMove = (e: TouchEvent) => {
      mouseX = e.touches[0].clientX;
      mouseY = e.touches[0].clientY;
      e.preventDefault(); // prevent scrolling
    };
    const handleTouchStart = (e: TouchEvent) => {
      mouseX = e.touches[0].clientX;
      mouseY = e.touches[0].clientY;
      isDashing = true;
    };
    const handleTouchEnd = () => { isDashing = false; };
    
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);

    // Game State
    let foods: Food[] = [];
    let bots: Snake[] = [];
    
    const BOT_NAMES = ['destroyer', 'slyther', 'venom', 'snek', 'noodle', 'danger_noodle', 'worm', 'alpha', 'beta', 'chomper', 'glizzy', 'slithers', 'voldemort', 'python', 'anaconda', 'boa', 'cobra', 'mamba', 'viper', 'rattler', 'basilisk', 'serpent', 'slimy', 'scaly', 'fang', 'hiss'];
    
    const getSafeSpawnPoint = (excludePlayer = false) => {
      let maxAttempts = 15;
      const allActive = (excludePlayer ? bots : [player, ...bots]).filter(b => b && !b.dead && b.segments.length > 0);
      let spawnX = Math.random() * WORLD_SIZE;
      let spawnY = Math.random() * WORLD_SIZE;

      while (maxAttempts > 0) {
        let isSafe = true;
        for (const s of allActive) {
          const head = s.segments[0];
          if (!head) continue;
          const dx = head.x - spawnX;
          const dy = head.y - spawnY;
          // Avoid 800px radius
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

    // Helpers
    const spawnFood = (x?: number, y?: number, value = 1, moneyValue = 0.01) => {
      foods.push({
        id: Math.random().toString(36),
        x: x !== undefined ? x : Math.random() * WORLD_SIZE,
        y: y !== undefined ? y : Math.random() * WORLD_SIZE,
        color: moneyValue > 0.015 ? '#FACC15' : randomColor(), // Gold colored for big drops
        value,
        moneyValue
      });
    };

    // Player init
    const pStartPos = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    const playerSegments: Point[] = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
        playerSegments.push({ x: pStartPos.x, y: pStartPos.y + i * SEGMENT_GAP });
    }

    let player: Snake = {
      id: 'player',
      isPlayer: true,
      name: 'You',
      segments: playerSegments,
      color: '#38BDF8',
      angle: -Math.PI / 2, // facing up
      targetAngle: -Math.PI / 2,
      score: INITIAL_LENGTH,
      collectedMoney: 0,
      dead: false
    };

    const spawnBot = () => {
      const pos = getSafeSpawnPoint();
      const bx = pos.x;
      const by = pos.y;
      const length = Math.floor(Math.random() * 20) + 10;
      const segs: Point[] = [];
      for (let i = 0; i < length; i++) {
        segs.push({ x: bx, y: by });
      }
      bots.push({
        id: Math.random().toString(36),
        isPlayer: false,
        name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + Math.floor(Math.random() * 999),
        segments: segs,
        color: randomColor(),
        angle: Math.random() * Math.PI * 2,
        targetAngle: Math.random() * Math.PI * 2,
        score: length,
        collectedMoney: 0, // Base $5 handled on death
        dead: false
      });
    };

    // Initial Spawns
    for (let i = 0; i < MAX_FOODS; i++) spawnFood();
    for (let i = 0; i < BOT_COUNT; i++) spawnBot();

    // Safe initialization
    setTimeout(() => {
       const initialSafe = getSafeSpawnPoint(true);
       const safeSegs: Point[] = [];
       for (let i = 0; i < INITIAL_LENGTH; i++) {
           safeSegs.push({ x: initialSafe.x, y: initialSafe.y + i * SEGMENT_GAP });
       }
       player.segments = safeSegs;
    }, 0);

    const killSnake = (snake: Snake) => {
      snake.dead = true;
      // Drop larger food, spread out a bit
      const segmentsToDrop = snake.segments.filter((_, index) => index % 3 === 0);
      
      const lostCollected = snake.collectedMoney * 0.5;
      const baseValue = 5; // Every snake is worth $5 base
      const totalToDrop = baseValue + lostCollected;
      const postFeeDrop = totalToDrop * 0.95; // 5% website fee

      if (snake.isPlayer) {
        moneyCollectRef.current(-lostCollected); // Deduct half of acquired funds from wallet
      }

      const moneyPerDrop = postFeeDrop / Math.max(1, segmentsToDrop.length);

      segmentsToDrop.forEach((seg) => {
        spawnFood(seg.x + (Math.random() * 20 - 10), seg.y + (Math.random() * 20 - 10), 6, moneyPerDrop);
      });
    };

    // MAIN LOOP
    let lastTime = performance.now();
    let gameOverTriggered = false;

    const loop = (time: number) => {
      if (!isRunning) return;
      const dt = time - lastTime;
      lastTime = time;

      // UPDATE PLAYER ANGLE
      // camera is centered on player head
      const head = player.segments[0] || {x: WORLD_SIZE/2, y: WORLD_SIZE/2};
      if (!player.dead && player.segments.length > 0) {
          const screenDx = mouseX - width / 2;
          const screenDy = mouseY - height / 2;
          player.targetAngle = Math.atan2(screenDy, screenDx);
      }

      // ALL SNAKES LOGIC (Player + Bots)
      const allSnakes = [player, ...bots].filter(s => !s.dead);

      allSnakes.forEach(snake => {
        let isSnakeDashing = false;
        
        // AI Logic for bots
        if (!snake.isPlayer) {
          // Occasionally change direction
          if (Math.random() < 0.02) {
             snake.targetAngle += (Math.random() - 0.5) * Math.PI;
          } else {
             // Find nearby food
             let targetFood = null;
             let minDist = 400 * 400; // sensing range
             const botHead = snake.segments[0];
             for (let f = 0; f < foods.length; f++) {
                const dy = foods[f].y - botHead.y;
                const dx = foods[f].x - botHead.x;
                const dsq = dx*dx + dy*dy;
                if (dsq < minDist) {
                    minDist = dsq;
                    targetFood = foods[f];
                }
             }
             if (targetFood && Math.random() < 0.1) {
                 snake.targetAngle = Math.atan2(targetFood.y - botHead.y, targetFood.x - botHead.x);
             }
          }
          
          // Bots dash randomly if big enough
          if (snake.score > INITIAL_LENGTH + 5 && Math.random() < 0.01) {
             snake.targetAngle += (Math.random() - 0.5) * 0.5; // slight adjust
             isSnakeDashing = true; // wait we need to track bot dash state.
             // simpler: just short bursts. But for now they don't dash to keep it simple, or only dash sometimes.
          }
          // Avoid walls (turn towards center if near edge)
          const botHead = snake.segments[0];
          const margin = 200;
          if (botHead.x < margin || botHead.x > WORLD_SIZE - margin ||
              botHead.y < margin || botHead.y > WORLD_SIZE - margin) {
              const toCenter = Math.atan2(WORLD_SIZE/2 - botHead.y, WORLD_SIZE/2 - botHead.x);
              snake.targetAngle = toCenter;
          }
        } else {
           isSnakeDashing = isDashing && snake.score > INITIAL_LENGTH;
        }

        // Steer
        snake.angle = lerpAngle(snake.angle, snake.targetAngle, Math.min(1, TURN_SPEED * (isSnakeDashing ? 0.6 : 1)));

        // Move head
        const baseSpeed = snake.isPlayer ? SNAKE_SPEED : BOT_SPEED;
        const speed = baseSpeed * (isSnakeDashing ? 2.2 : 1);
        
        const head = snake.segments[0];
        head.x += Math.cos(snake.angle) * speed;
        head.y += Math.sin(snake.angle) * speed;

        // Screen wrap or die at bounds
        if (head.x < 0 || head.x > WORLD_SIZE || head.y < 0 || head.y > WORLD_SIZE) {
            if (snake.isPlayer) {
                killSnake(snake);
                return;
            } else {
                head.x = Math.max(0, Math.min(WORLD_SIZE, head.x));
                head.y = Math.max(0, Math.min(WORLD_SIZE, head.y));
                snake.angle += Math.PI; // flip
                snake.targetAngle = snake.angle;
            }
        }

        // Update body segments to follow (Rope pulling mechanics)
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

        // Handle Dashing Cost (lose 1 segment every ~15 frames)
        if (isSnakeDashing) {
           // 1/15 chance per frame to lose a point
           if (Math.random() < 0.1) {
              snake.score -= 1;
              if (snake.isPlayer) scoreUpdateRef.current(snake.score);
              const tail = snake.segments[snake.segments.length - 1];
              spawnFood(tail.x, tail.y, 1, 0); // Explicitly 0 to prevent infinite farm glitch
           }
        }

        // Maintain length based on score
        const targetLength = Math.min(MAX_SNAKE_LENGTH, Math.max(1, snake.score));
        while (snake.segments.length > targetLength) {
          snake.segments.pop();
        }
        while (snake.segments.length < targetLength) {
          const tail = snake.segments[snake.segments.length - 1];
          if (tail) {
            snake.segments.push({ x: tail.x, y: tail.y });
          } else {
            break;
          }
        }
      });

      // COLLISION DETECTION
      const activeSnakes = allSnakes.filter(s => !s.dead);
      
      // 1. Food Collision
      for (let s = 0; s < activeSnakes.length; s++) {
        const snake = activeSnakes[s];
        const sHead = snake.segments[0];
        
        for (let f = foods.length - 1; f >= 0; f--) {
          const food = foods[f];
          const dx = sHead.x - food.x;
          const dy = sHead.y - food.y;
          const sRadius = getSnakeRadius(snake.score);
          if (dx * dx + dy * dy < (sRadius + FOOD_RADIUS) * (sRadius + FOOD_RADIUS)) {
            snake.score += food.value;
            snake.collectedMoney += food.moneyValue || 0;
            foods.splice(f, 1);
            if (snake.isPlayer) {
              scoreUpdateRef.current(snake.score);
              if (food.moneyValue > 0) {
                 moneyCollectRef.current(food.moneyValue);
              }
            }
          }
        }
      }

      // 2. Snake vs Snake (and Self) Collision
      for (let attackerIdx = 0; attackerIdx < activeSnakes.length; attackerIdx++) {
         const attacker = activeSnakes[attackerIdx];
         if (attacker.dead) continue;
         const aHead = attacker.segments[0];

         for (let victimIdx = 0; victimIdx < activeSnakes.length; victimIdx++) {
            const victim = activeSnakes[victimIdx];
            if (victim.dead) continue;
            
            const isSelf = attackerIdx === victimIdx;

            // Wait a bit before allowing spawn-kills or if too short
            if (attacker.segments.length < 2 || victim.segments.length < 2) continue;

            const aRadius = getSnakeRadius(attacker.score);
            const vRadius = getSnakeRadius(victim.score);
            const hitDistanceSq = ((aRadius * 0.75) + (vRadius * 0.75)) * ((aRadius * 0.75) + (vRadius * 0.75));

            // Check if attacker head hits any victim body segment
            // start at j=0, but if it is self collision skip first 16 segments
            const startJ = (isSelf ? 16 : 0);
            for (let j = startJ; j < victim.segments.length; j += 2) { // check every other segment for perf
                const part = victim.segments[j];
                const dx = aHead.x - part.x;
                const dy = aHead.y - part.y;
                // Collision radius slightly smaller than visual radius
                if (dx * dx + dy * dy < hitDistanceSq) {
                    killSnake(attacker);
                    break;
                }
            }
         }
      }

      // Respawn things
      bots = bots.filter(b => !b.dead);
      while (bots.length < BOT_COUNT) spawnBot();
      while (foods.length < MAX_FOODS) spawnFood();

      // Check Player Death
      if (player.dead && !gameOverTriggered) {
        gameOverTriggered = true;
        setTimeout(() => { if (isRunning) gameOverRef.current(player.score) }, 1500);
      }

      // RENDER
      // Dark background
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, width, height);

      const pHead = player.segments[0] || { x: WORLD_SIZE/2, y: WORLD_SIZE/2 };
      
      ctx.save();
      // Translate to camera
      ctx.translate(width / 2 - pHead.x, height / 2 - pHead.y);

      // Draw Grid (World bounds)
      ctx.strokeStyle = 'rgba(56,189,248,0.1)';
      ctx.lineWidth = 1;
      const gridSize = 100;
      const startCol = Math.floor((pHead.x - width/2) / gridSize) * gridSize;
      const endCol = startCol + width + gridSize;
      const startRow = Math.floor((pHead.y - height/2) / gridSize) * gridSize;
      const endRow = startRow + height + gridSize;

      ctx.beginPath();
      // Only draw grid within world bounds
      for (let x = Math.max(0, startCol); x <= Math.min(WORLD_SIZE, endCol); x += gridSize) {
        ctx.moveTo(x, Math.max(0, startRow));
        ctx.lineTo(x, Math.min(WORLD_SIZE, endRow));
      }
      for (let y = Math.max(0, startRow); y <= Math.min(WORLD_SIZE, endRow); y += gridSize) {
        ctx.moveTo(Math.max(0, startCol), y);
        ctx.lineTo(Math.min(WORLD_SIZE, endCol), y);
      }
      ctx.stroke();

      // World Boundary Border
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

          // Draw Food
      foods.forEach(f => {
        // Only draw visible food
        if (f.x > pHead.x - width/2 - 50 && f.x < pHead.x + width/2 + 50 &&
            f.y > pHead.y - height/2 - 50 && f.y < pHead.y + height/2 + 50) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, FOOD_RADIUS * Math.sqrt(f.value), 0, Math.PI * 2);
          ctx.fillStyle = f.color;
          ctx.shadowColor = f.color;
          ctx.shadowBlur = f.moneyValue > 0.015 ? 20 : 10; // Extra glow for big money
          ctx.fill();
          
          if (f.moneyValue > 0.015) {
             ctx.strokeStyle = '#FFFFFF';
             ctx.lineWidth = 2;
             ctx.stroke();
          }

          ctx.shadowBlur = 0; // reset
        }
      });

      // Draw Snakes
      // Draw bots then player on top
      const snakesToDraw = [...bots.filter(b=>!b.dead)];
      if (!player.dead) snakesToDraw.push(player);

      snakesToDraw.forEach(s => {
        // Draw reverse so head is on top
        for (let i = s.segments.length - 1; i >= 0; i--) {
          const seg = s.segments[i];
          
          // Basic culling
          if (seg.x < pHead.x - width/2 - 50 || seg.x > pHead.x + width/2 + 50 ||
              seg.y < pHead.y - height/2 - 50 || seg.y > pHead.y + height/2 + 50) {
              continue;
          }

          ctx.beginPath();
          // Head gets a slightly different radius, or tail gets smaller
          const baseRadius = getSnakeRadius(s.score);
          const radius = Math.max(3, baseRadius * (1 - i / (s.segments.length * 1.5)));
          ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);

          // Alternating colors or solid
          if (s.isPlayer) {
              ctx.fillStyle = i % 2 === 0 ? '#38BDF8' : '#0EA5E9';
          } else {
             // Darken alternating segments
             ctx.fillStyle = s.color;
             ctx.globalAlpha = i % 2 === 0 ? 1 : 0.8;
          }
          ctx.fill();

          // Border for clarity
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
          
          // Draw eyes on head
          if (i === 0) {
             const eyeOffset = radius * 0.5;
             const eyeSize = radius * 0.3;
             ctx.fillStyle = 'white';
             
             for (let sign of [-1, 1]) {
                const ex = seg.x + Math.cos(s.angle + sign * 0.8) * eyeOffset;
                const ey = seg.y + Math.sin(s.angle + sign * 0.8) * eyeOffset;
                ctx.beginPath();
                ctx.arc(ex, ey, eyeSize, 0, Math.PI * 2);
                ctx.fill();
                
                // pupil
                ctx.fillStyle = 'black';
                ctx.beginPath();
                ctx.arc(ex, ey, eyeSize * 0.5, 0, Math.PI * 2);
                ctx.fill();
             }
             ctx.fillStyle = 'white';
          }
        }
        
        // Render Name over head
        const head = s.segments[0];
        if (head && (!s.isPlayer || s.segments.length > 0)) {
           const sRadius = getSnakeRadius(s.score);
           ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
           ctx.font = "bold 12px Inter, sans-serif";
           ctx.textAlign = "center";
           ctx.fillText(s.name, head.x, head.y - sRadius - 10);
        }
      });

      ctx.restore();

      // UI OVERLAYS (No camera logic needed here)
      // Leaderboard
      const margin = 20;
      const topSnakes = [...activeSnakes].sort((a, b) => b.score - a.score).slice(0, 10);
      ctx.fillStyle = 'rgba(15,23,42,0.8)';
      ctx.fillRect(width - 200 - margin, 20 + 48, 200, 30 + topSnakes.length * 20);
      ctx.strokeStyle = 'rgba(56,189,248,0.3)';
      ctx.strokeRect(width - 200 - margin, 20 + 48, 200, 30 + topSnakes.length * 20);
      
      ctx.font = 'bold 14px font-mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#38BDF8';
      ctx.fillText('LEADERBOARD', width - 100 - margin, 40 + 48);
      
      topSnakes.forEach((s, idx) => {
         ctx.textAlign = 'left';
         ctx.font = s.isPlayer ? 'bold 12px font-mono, monospace' : '12px font-mono, monospace';
         ctx.fillStyle = s.isPlayer ? '#38BDF8' : 'rgba(255,255,255,0.8)';
         ctx.fillText(`${idx + 1}. ${s.name}`, width - 190 - margin, 65 + 48 + idx * 20);
         
         ctx.textAlign = 'right';
         ctx.fillText(`${s.score}`, width - 10 - margin, 65 + 48 + idx * 20);
      });

      // Minimap on UI
      ctx.fillStyle = 'rgba(15,23,42,0.8)';
      const minimapSize = 150;
      const minimapScale = minimapSize / WORLD_SIZE;
      ctx.fillRect(width - minimapSize - margin, height - minimapSize - margin, minimapSize, minimapSize);
      ctx.strokeStyle = 'rgba(56,189,248,0.3)';
      ctx.strokeRect(width - minimapSize - margin, height - minimapSize - margin, minimapSize, minimapSize);

      activeSnakes.forEach(s => {
          if (!s.segments[0]) return;
          const sRadius = getSnakeRadius(s.score);
          ctx.fillStyle = s.isPlayer ? '#38BDF8' : 'rgba(255,255,255,0.4)';
          const dotSizes = s.isPlayer ? Math.max(3, sRadius * 0.3) : Math.max(2, sRadius * 0.2);
          ctx.beginPath();
          ctx.arc(
            width - minimapSize - margin + s.segments[0].x * minimapScale,
            height - minimapSize - margin + s.segments[0].y * minimapScale,
            dotSizes, 0, Math.PI*2
          );
          ctx.fill();
      });


      if (isRunning) {
        animationId = requestAnimationFrame(loop);
      }
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="block w-full h-full cursor-crosshair touch-none"
    />
  );
}
