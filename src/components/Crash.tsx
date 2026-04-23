import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';

interface GameProps {
  balance: number;
  onBalanceChange: (amount: number) => void;
  onExit: () => void;
}

export default function Crash({ balance, onBalanceChange, onExit }: GameProps) {
  const [betAmount, setBetAmount] = useState(1);
  const [autoCashout, setAutoCashout] = useState(2.0);
  const [gameState, setGameState] = useState<'IDLE' | 'PLAYING' | 'CRASHED' | 'CASHED_OUT'>('IDLE');
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);
  const [crashPoint, setCrashPoint] = useState(0);

  const startGame = () => {
    if (balance < betAmount) return;
    onBalanceChange(-betAmount);

    // RIGGED: house edge generator (forced lower crashes very often)
    // Random float 0-1.
    // 1 / (1 - r) typically, but we penalize it severely
    const r = Math.random();
    let point = 1.00;
    if (Math.random() < 0.15) {
       // 15% chance to insta-crash or sub-1.10
       point = 1.00 + (Math.random() * 0.10);
    } else {
       point = parseFloat(((1 / (1 - r)) * 0.85).toFixed(2));
       if (point < 1.01) point = 1.01;
    }

    setCrashPoint(point);
    setCurrentMultiplier(1.00);
    setGameState('PLAYING');
  };

  useEffect(() => {
    let interval: number;
    let startTime: number;

    if (gameState === 'PLAYING') {
      startTime = Date.now();
      interval = window.setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000; // seconds
        
        // Exponential curve
        // mult = e^(0.06 * elapsed) -> something smooth
        const newMult = parseFloat(Math.exp(k * elapsed).toFixed(2));

        if (newMult >= crashPoint) {
            setCurrentMultiplier(crashPoint);
            setGameState('CRASHED');
            clearInterval(interval);
        } else if (newMult >= autoCashout && autoCashout > 1) {
            setCurrentMultiplier(autoCashout);
            setGameState('CASHED_OUT');
            onBalanceChange(betAmount * autoCashout);
            clearInterval(interval);
        } else {
            setCurrentMultiplier(newMult);
        }
      }, 50);
    }

    return () => clearInterval(interval);
  }, [gameState, crashPoint, autoCashout, betAmount, onBalanceChange]);

  const k = 0.08; // Curve steepness

  const handleManualCashout = () => {
      if (gameState !== 'PLAYING') return;
      setGameState('CASHED_OUT');
      onBalanceChange(betAmount * currentMultiplier);
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-slate-900 text-slate-50 relative p-8">
       <div className="absolute top-4 left-4">
          <button onClick={onExit} className="px-4 py-2 bg-slate-800 text-sky-400 font-bold border border-sky-500/50 hover:bg-slate-700">
             BACK TO MENU
          </button>
       </div>
       <div className="absolute top-4 right-4 flex flex-col items-end pointer-events-none">
          <span className="text-sky-500/60 font-mono text-xs uppercase">CREDITS</span>
          <span className="text-2xl font-bold font-mono text-white">${balance.toFixed(2)}</span>
       </div>

       <div className="flex flex-col md:flex-row gap-12 w-full max-w-4xl">
         {/* Controls Sidebar */}
         <div className="flex flex-col gap-6 w-full md:w-64">
            <h2 className="text-3xl font-black italic text-sky-400 font-mono tracking-tighter">CRASH</h2>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-mono text-slate-400 uppercase">Bet Amount</label>
              <input 
                 type="number"
                 disabled={gameState === 'PLAYING'}
                 value={betAmount}
                 onChange={(e) => setBetAmount(Math.max(1, parseFloat(e.target.value) || 1))}
                 className="bg-slate-800 border border-sky-500/30 p-3 font-mono text-lg text-white"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-mono text-slate-400 uppercase flex justify-between">
                <span>Auto Cashout</span>
                <span>(0 for manual)</span>
              </label>
              <input 
                 type="number"
                 step="0.1"
                 disabled={gameState === 'PLAYING'}
                 value={autoCashout}
                 onChange={(e) => setAutoCashout(Math.max(0, parseFloat(e.target.value) || 0))}
                 className="bg-slate-800 border border-sky-500/30 p-3 font-mono text-lg text-white"
              />
            </div>

            {gameState === 'IDLE' || gameState === 'CRASHED' || gameState === 'CASHED_OUT' ? (
                <button 
                   onClick={startGame}
                   disabled={balance < betAmount}
                   className={`py-4 font-bold uppercase ${balance >= betAmount ? 'bg-sky-500 hover:bg-sky-400 text-slate-900' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
                >
                   Place Bet
                </button>
            ) : (
                <button 
                   onClick={handleManualCashout}
                   className="py-4 font-bold uppercase transition-colors bg-green-500 hover:bg-green-400 text-slate-900 border border-green-400"
                >
                   Cashout (${(betAmount * currentMultiplier).toFixed(2)})
                </button>
            )}
         </div>

         {/* Chart Area */}
         <div className="flex-1 flex flex-col items-center justify-center border border-sky-500/20 bg-slate-800/20 relative rounded-xl h-96 overflow-hidden">
             
             {/* Dynamic Multiplier */}
             <div className={`text-6xl font-black font-mono z-10 
               ${gameState === 'CRASHED' ? 'text-red-500' : gameState === 'CASHED_OUT' ? 'text-green-400' : 'text-white'}
             `}>
                {currentMultiplier.toFixed(2)}x
             </div>
             
             {gameState === 'CRASHED' && (
                 <div className="text-red-500 mt-2 font-mono uppercase tracking-widest absolute top-[60%]">Crashed @ {crashPoint.toFixed(2)}x</div>
             )}
             {gameState === 'CASHED_OUT' && (
                 <div className="text-green-400 mt-2 font-mono uppercase tracking-widest absolute top-[60%]">+${(betAmount * currentMultiplier).toFixed(2)}</div>
             )}

             {/* Background Graph line effect */}
             <svg className="absolute bottom-0 left-0 w-full h-full opacity-30 pointer-events-none" preserveAspectRatio="none">
                 <path 
                   d={`M 0 100 Q ${currentMultiplier * 10} ${100 - currentMultiplier * 5} ${currentMultiplier * 20} ${100 - currentMultiplier * 10}`} 
                   stroke={gameState === 'CRASHED' ? '#ef4444' : '#38bdf8'} 
                   strokeWidth="2" 
                   fill="none" 
                   vectorEffect="non-scaling-stroke"
                 />
                 {gameState === 'PLAYING' && (
                     <circle cx="50" cy="50" r="2" fill="#38bdf8" className="animate-ping" />
                 )}
             </svg>
             <div className="absolute bottom-0 left-0 w-full h-[1px] bg-slate-700"></div>
             <div className="absolute top-0 left-0 w-[1px] h-full bg-slate-700"></div>
         </div>
       </div>

    </div>
  );
}
