import { useState } from 'react';

interface GameProps {
  balance: number;
  onBalanceChange: (amount: number) => void;
  onExit: () => void;
}

export default function Dice({ balance, onBalanceChange, onExit }: GameProps) {
  const [betAmount, setBetAmount] = useState(1);
  const [targetRoll, setTargetRoll] = useState(50); // 2 to 98
  const [rollMode, setRollMode] = useState<'OVER' | 'UNDER'>('OVER'); 
  const [gameState, setGameState] = useState<'IDLE' | 'WON' | 'LOST'>('IDLE');
  const [lastRoll, setLastRoll] = useState(0);

  // Math
  const winChance = rollMode === 'OVER' ? 100 - targetRoll : targetRoll;
  // House Edge built into multiplier mathematically usually 99/winChance. We rigged it slightly harder below.
  const multiplier = parseFloat((98 / winChance).toFixed(4)); 
  const potentialWin = betAmount * multiplier;

  const rollDice = () => {
     if (balance < betAmount) return;
     onBalanceChange(-betAmount);

     let actualRoll = Math.floor(Math.random() * 100);
     
     // RIGGING:
     // If the raw roll is a "win", 10% of the time override it to a loss
     const wouldWin = rollMode === 'OVER' ? actualRoll >= targetRoll : actualRoll <= targetRoll;
     if (wouldWin && Math.random() < 0.10) {
        // Force a loss
        if (rollMode === 'OVER') {
           actualRoll = Math.floor(Math.random() * targetRoll); // roll under
        } else {
           actualRoll = targetRoll + Math.floor(Math.random() * (100 - targetRoll)) + 1; // roll over
        }
     }
     
     if (actualRoll > 99) actualRoll = 99;

     setLastRoll(actualRoll);

     const isWin = rollMode === 'OVER' ? actualRoll >= targetRoll : actualRoll <= targetRoll;
     if (isWin) {
        onBalanceChange(potentialWin);
        setGameState('WON');
     } else {
        setGameState('LOST');
     }
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

       <div className="flex flex-col gap-12 w-full max-w-2xl bg-slate-800/20 p-8 border border-sky-500/10 rounded-xl">
         <h2 className="text-3xl font-black italic text-sky-400 font-mono tracking-tighter text-center">DICE</h2>
         
         {/* Results Area */}
         <div className="flex items-center justify-center py-6">
            <div className={`text-7xl font-black font-mono transition-transform duration-200 ${gameState === 'WON' ? 'text-green-400 scale-110' : gameState === 'LOST' ? 'text-red-500 scale-95' : 'text-slate-300'}`}>
                {lastRoll.toString().padStart(2, '0')}
            </div>
         </div>
         {gameState === 'WON' && <div className="text-center text-green-400 font-bold font-mono mt-[-20px] mb-4">+${potentialWin.toFixed(2)}</div>}
         {gameState === 'LOST' && <div className="text-center text-red-500 font-bold font-mono mt-[-20px] mb-4">LOST</div>}

         {/* Sliders */}
         <div className="space-y-6 flex-1">
            <div className="flex flex-col gap-2 relative">
              <div className="flex justify-between text-slate-400 font-mono text-sm">
                 <span>Target: {rollMode} {targetRoll}</span>
                 <span>{winChance}% Win Chance</span>
              </div>
              <input 
                  type="range" 
                  min="2" max="98" 
                  value={targetRoll}
                  onChange={(e) => setTargetRoll(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
              />
            </div>
            
            <div className="flex gap-4 items-end">
               <div className="flex flex-col gap-2 flex-1">
                  <label className="text-sm font-mono text-slate-400 uppercase">Bet Amount</label>
                  <input 
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(Math.max(1, parseFloat(e.target.value) || 1))}
                    className="bg-slate-800 border border-sky-500/30 p-3 font-mono text-lg text-white"
                  />
               </div>
               <div className="flex flex-col gap-2 flex-1">
                  <label className="text-sm font-mono text-slate-400 uppercase">Payout Mult</label>
                  <div className="bg-slate-800/50 border border-sky-500/20 p-3 font-mono text-lg text-sky-400">
                      {multiplier.toFixed(2)}x
                  </div>
               </div>
               <div className="flex gap-2">
                 <button 
                   onClick={() => setRollMode('UNDER')}
                   className={`px-4 py-3 font-bold uppercase transition-colors border ${rollMode === 'UNDER' ? 'bg-sky-500 text-slate-900 border-sky-500' : 'bg-slate-800 text-slate-500 hover:border-sky-500/50 border-slate-700'}`}
                 >
                   Under
                 </button>
                 <button 
                   onClick={() => setRollMode('OVER')}
                   className={`px-4 py-3 font-bold uppercase transition-colors border ${rollMode === 'OVER' ? 'bg-sky-500 text-slate-900 border-sky-500' : 'bg-slate-800 text-slate-500 hover:border-sky-500/50 border-slate-700'}`}
                 >
                   Over
                 </button>
               </div>
            </div>

            <button 
                onClick={rollDice}
                disabled={balance < betAmount}
                className={`w-full py-5 text-xl font-bold uppercase ${balance >= betAmount ? 'bg-sky-500 hover:bg-sky-400 text-slate-900' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
            >
                Roll Dice
            </button>
         </div>

       </div>
    </div>
  );
}
