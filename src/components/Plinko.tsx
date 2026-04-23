import { useState, useRef, useEffect } from 'react';

interface GameProps {
  balance: number;
  onBalanceChange: (amount: number) => void;
  onExit: () => void;
}

const ROWS = 16;
const COLS = 17;
const OBSTACLE_RADIUS = 4;
const BALL_RADIUS = 8;
const GRAVITY = 0.5;
const BOUNCE = 0.5;

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
  color: string;
}

export default function Plinko({ balance, onBalanceChange, onExit }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [betAmount, setBetAmount] = useState(1);
  const ballsRef = useRef<Ball[]>([]);

  // Calculate layout
  const [dimensions, setDimensions] = useState({ width: 600, height: 800 });

  useEffect(() => {
    const handleResize = () => {
      // Fit to screen, maintain some aspect ratio max
      setDimensions({
        width: Math.min(window.innerWidth, 800),
        height: window.innerHeight - 150
      });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const dropBall = () => {
    if (balance < betAmount) return;
    onBalanceChange(-betAmount);
    // drop from center top
    const startX = dimensions.width / 2 + (Math.random() - 0.5) * 10;
    
    // Rigging: Pre-determine the bucket to enforce RTP while allowing massive hits occasionally
    const weights = [2, 3, 4, 5, 10, 20, 40, 200, 800, 200, 40, 20, 10, 5, 4, 3, 2];
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    let targetBucket = 8;
    for (let i = 0; i < weights.length; i++) {
        if (r < weights[i]) {
            targetBucket = i;
            break;
        }
        r -= weights[i];
    }
    
    ballsRef.current.push({
      x: startX,
      y: 50,
      vx: (Math.random() - 0.5) * 2,
      vy: 0,
      active: true,
      color: `hsl(${Math.random() * 360}, 100%, 50%)`,
      targetBucket: targetBucket
    } as any);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;
    let animationId: number;

    const { width, height } = dimensions;
    canvas.width = width;
    canvas.height = height;

    // Pegs layout
    const pegSpacingY = (height - 150) / ROWS;
    const pegSpacingX = width / COLS;
    
    const pegs: {x: number, y: number}[] = [];
    for (let row = 0; row < ROWS; row++) {
      const isOffset = row % 2 !== 0;
      const numPegs = isOffset ? COLS - 1 : COLS;
      for (let col = 0; col < numPegs; col++) {
         const x = (col + (isOffset ? 1 : 0.5)) * pegSpacingX;
         const y = 50 + row * pegSpacingY;
         pegs.push({x, y});
      }
    }

    // Multipliers at the bottom
    // Rigged: slightly punished center but viable outer edges for a realistic bell curve
    const multipliers = [
      77, 26, 9, 3, 1.2, 0.8, 0.4, 0.2, 0.2, 0.2, 0.4, 0.8, 1.2, 3, 9, 26, 77
    ];
    // Map multipliers into bucket visually
    const bucketWidth = width / multipliers.length;

    const loop = () => {
      if (!isRunning) return;
      ctx.clearRect(0, 0, width, height);

      // Draw background
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, width, height);

      // Draw Pegs
      ctx.fillStyle = '#fff';
      pegs.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, OBSTACLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Buckets
      const bucketY = 50 + ROWS * pegSpacingY + 20;
      for (let i = 0; i < multipliers.length; i++) {
         const bucketX = i * bucketWidth;
         // Draw box
         const mult = multipliers[i];
         ctx.fillStyle = mult >= 1 ? (mult >= 10 ? '#ef4444' : '#eab308') : '#3b82f6';
         ctx.fillRect(bucketX + 2, bucketY, bucketWidth - 4, 30);
         
         ctx.fillStyle = '#fff';
         ctx.font = 'bold 12px sans-serif';
         ctx.textAlign = 'center';
         ctx.fillText(`${mult}x`, bucketX + bucketWidth / 2, bucketY + 20);
      }

      // Update and Draw Balls
      for (let i = ballsRef.current.length - 1; i >= 0; i--) {
        const ball = ballsRef.current[i];
        if (!ball.active) continue;

        // Physics Update
        // Rigging: Steer the ball towards its secretly pre-ordained bucket.
        const targetX = ball.targetBucket * bucketWidth + bucketWidth / 2;
        const distToTargetX = targetX - ball.x;
        
        // Gentle invisible steering
        ball.vx += (distToTargetX / width) * 0.15;

        ball.vy += GRAVITY;
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Collision with pegs
        for (const p of pegs) {
          const dx = ball.x - p.x;
          const dy = ball.y - p.y;
          const distSq = dx * dx + dy * dy;
          const minDist = BALL_RADIUS + OBSTACLE_RADIUS;
          if (distSq <= minDist * minDist) {
            const dist = Math.sqrt(distSq);
            // Resolve overlap
            const overlap = minDist - dist;
            ball.x += (dx / dist) * overlap;
            ball.y += (dy / dist) * overlap;

            // Bounce
            const dot = (ball.vx * dx + ball.vy * dy) / distSq;
            ball.vx = (ball.vx - 2 * dot * dx) * BOUNCE;
            ball.vy = (ball.vy - 2 * dot * dy) * BOUNCE;
            
            // Re-apply subtle steering during the ricochet to maintain illusion but reach target
            const targetX = ball.targetBucket * bucketWidth + bucketWidth / 2;
            let spread = (Math.random() - 0.5) * 2.5; 
            
            // Bias the ricochet heavily towards the predetermined bucket
            const bias = Math.sign(targetX - ball.x) * Math.random() * 1.5;
            spread += bias;

            ball.vx += spread;
          }
        }

        // Check if in bucket
        if (ball.y >= bucketY) {
          ball.active = false;
          // Calculate which bucket
           let bIdx = Math.floor(ball.x / bucketWidth);
           if (bIdx < 0) bIdx = 0;
           if (bIdx >= multipliers.length) bIdx = multipliers.length - 1;
           const multiplier = multipliers[bIdx];
           
           // Payout
           onBalanceChange(betAmount * multiplier);
        }

        // Draw
        ctx.fillStyle = ball.color;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Cleanup inactive balls
      ballsRef.current = ballsRef.current.filter(b => b.active);

      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animationId);
    };
  }, [dimensions, betAmount, onBalanceChange]);

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-slate-900 text-slate-50 relative">
       
       <div className="mb-4 flex items-center gap-4 z-10">
          <div className="flex flex-col">
            <span className="text-xs text-sky-500/80 uppercase mb-1">Bet Amount</span>
            <input 
              type="number" 
              value={betAmount} 
              onChange={e => setBetAmount(Math.max(1, parseFloat(e.target.value) || 1))}
              className="bg-slate-800 text-white p-3 w-32 font-mono rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            />
          </div>
          <button 
             onClick={dropBall}
             disabled={balance < betAmount}
             className={`mt-4 px-8 py-3 font-bold uppercase transition-all rounded-xl shadow-lg ${
                balance >= betAmount 
                  ? 'bg-sky-500 text-slate-900 hover:bg-sky-400 shadow-sky-500/20' 
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
          >
             Drop Ball (-${betAmount})
          </button>
       </div>

       <div className="relative overflow-hidden rounded-3xl shadow-2xl" style={{ width: dimensions.width, height: dimensions.height }}>
          <canvas 
            ref={canvasRef} 
            className="rounded-3xl"
          />
       </div>
    </div>
  );
}
