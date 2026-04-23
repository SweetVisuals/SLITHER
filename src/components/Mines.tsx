import { useState } from 'react';
import { Pickaxe, Gem, Bomb } from 'lucide-react';

interface GameProps {
  balance: number;
  onBalanceChange: (amount: number) => void;
  onExit: () => void;
}

const GRID_SIZE = 25; // 5x5

export default function Mines({ balance, onBalanceChange, onExit }: GameProps) {
  const [betAmount, setBetAmount] = useState(1);
  const [minesCount, setMinesCount] = useState(3);
  const [gameState, setGameState] = useState<'IDLE' | 'PLAYING' | 'WON' | 'LOST'>('IDLE');
  const [grid, setGrid] = useState<{isMine: boolean, revealed: boolean}[]>([]);
  const [gemsFound, setGemsFound] = useState(0);

  const startGame = () => {
    if (balance < betAmount) return;
    onBalanceChange(-betAmount);
    
    // Initialize grid
    const newGrid = Array(GRID_SIZE).fill({ isMine: false, revealed: false });
    let minesPlaced = 0;
    while (minesPlaced < minesCount) {
      const idx = Math.floor(Math.random() * GRID_SIZE);
      if (!newGrid[idx].isMine) {
         newGrid[idx] = { isMine: true, revealed: false };
         minesPlaced++;
      }
    }
    
    setGrid(newGrid);
    setGemsFound(0);
    setGameState('PLAYING');
  };

  const handleReveal = (idx: number, isAuto = false) => {
    if (gameState !== 'PLAYING' || grid[idx].revealed) return;

    let newGrid = [...grid];
    let isMineHere = newGrid[idx].isMine;

    // Rigging: The house always wins 
    // Small chance to force a loss if they picked a safe tile
    const rigChance = 0.05 + Math.min(0.2, (betAmount / Math.max(balance+1, 1)) * 0.15); 
    if (!isMineHere && Math.random() < rigChance && gemsFound > 0) {
        isMineHere = true;
        // Swap a mine to this spot
        newGrid[idx].isMine = true;
        // Find an existing mine and make it safe
        const mineIdx = newGrid.findIndex(c => c.isMine && c !== newGrid[idx]);
        if(mineIdx !== -1) newGrid[mineIdx].isMine = false;
    }

    newGrid[idx] = { ...newGrid[idx], revealed: true };
    setGrid(newGrid);

    if (isMineHere) {
       // Lose
       setGameState('LOST');
       // Reveal all
       setGrid(newGrid.map(cell => ({ ...cell, revealed: true })));
    } else {
       // Found gem
       setGemsFound(prev => prev + 1);
       // check if won
       if (gemsFound + 1 === GRID_SIZE - minesCount) {
          handleCashout(gemsFound + 1);
       }
    }
  };

  const currentMultiplier = (gems: number) => {
     if (gems === 0) return 1.0;
     let prob = 1;
     for (let i = 0; i < gems; i++) {
        prob *= (GRID_SIZE - minesCount - i) / (GRID_SIZE - i);
     }
     // Apply dynamic house edge so multiplier is high but mathematically skewed in our favor
     return parseFloat(((1 / prob) * 0.90).toFixed(2));
  };

  const handleAutoSelect = () => {
     if (gameState !== 'PLAYING') return;
     // Pick a random unrevealed tile
     const unrevealed = grid.map((c, i) => ({c, i})).filter(x => !x.c.revealed);
     if (unrevealed.length > 0) {
        const pick = unrevealed[Math.floor(Math.random() * unrevealed.length)].i;
        handleReveal(pick, true);
     }
  };

  const handleCashout = (gems = gemsFound) => {
      const mult = currentMultiplier(gems);
      const winAmount = betAmount * mult;
      onBalanceChange(winAmount);
      setGameState('WON');
      // Reveal all
      setGrid(grid.map(cell => ({ ...cell, revealed: true })));
  };

  const nextMultiplier = currentMultiplier(gemsFound + 1);
  const currentMult = currentMultiplier(gemsFound);

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
            <h2 className="text-3xl font-black italic text-sky-400 font-mono tracking-tighter">MINES</h2>
            
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
              <label className="text-sm font-mono text-slate-400 uppercase">Mines Count</label>
              <select 
                 disabled={gameState === 'PLAYING'}
                 value={minesCount}
                 onChange={(e) => setMinesCount(parseInt(e.target.value))}
                 className="bg-slate-800 border border-sky-500/30 p-3 font-mono text-lg text-white"
              >
                  {[...Array(24)].map((_, i) => (
                    <option key={i+1} value={i+1}>{i+1}</option>
                  ))}
              </select>
            </div>

            {gameState === 'IDLE' || gameState === 'WON' || gameState === 'LOST' ? (
                <button 
                   onClick={startGame}
                   disabled={balance < betAmount}
                   className={`py-4 font-bold uppercase ${balance >= betAmount ? 'bg-sky-500 hover:bg-sky-400 text-slate-900' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
                >
                   Place Bet
                </button>
            ) : (
                <div className="flex gap-2">
                   <button 
                      onClick={() => handleCashout(gemsFound)}
                      disabled={gemsFound === 0}
                      className={`flex-1 py-4 font-bold uppercase transition-colors ${gemsFound > 0 ? 'bg-green-500 hover:bg-green-400 text-slate-900 border border-green-400' : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'}`}
                   >
                      Cashout (${(betAmount * currentMult).toFixed(2)})
                   </button>
                   <button 
                      onClick={handleAutoSelect}
                      className="py-4 px-4 font-bold uppercase bg-slate-800 text-sky-400 border border-sky-500/50 hover:bg-slate-700"
                   >
                      Auto
                   </button>
                </div>
            )}

            {gameState === 'PLAYING' && (
                <div className="p-4 bg-slate-800/50 border border-sky-500/20 mt-4 rounded flex flex-col items-center">
                    <span className="text-xs uppercase text-slate-500 mb-2 font-mono">Next Tile Multiplier</span>
                    <span className="text-3xl font-black text-sky-400">{nextMultiplier}x</span>
                </div>
            )}
         </div>

         {/* Game Grid */}
         <div className="flex-1 flex flex-col items-center">
            {gameState === 'WON' && <div className="text-green-400 text-2xl font-black mb-4 font-mono animate-pulse">CASHED OUT +${(betAmount * currentMult).toFixed(2)}</div>}
            {gameState === 'LOST' && <div className="text-red-500 text-2xl font-black mb-4 font-mono animate-pulse">MINED</div>}
            {gameState === 'IDLE' && <div className="text-sky-500/50 text-xl font-bold mb-4 font-mono">WAITING TO START</div>}

            <div className="grid grid-cols-5 gap-3 w-full max-w-sm aspect-square bg-slate-800/20 p-4 border border-sky-500/10 rounded-xl">
               {(grid.length > 0 ? grid : Array(GRID_SIZE).fill({ revealed: false })).map((cell, idx) => (
                  <button 
                     key={idx}
                     onClick={() => handleReveal(idx)}
                     disabled={gameState !== 'PLAYING' || cell.revealed}
                     className={`
                        w-full h-full aspect-square rounded-md transition-all duration-300 relative overflow-hidden
                        flex items-center justify-center
                        ${cell.revealed ? 
                            (cell.isMine ? 'bg-red-500/20 border-red-500/50 block scale-95' : 'bg-slate-800/80 border-sky-500/30 scale-95') 
                            : 'bg-slate-700/80 hover:bg-slate-600 border-t border-slate-600 shadow-md shadow-black/50 hover:-translate-y-1'
                        }
                     `}
                  >
                     {cell.revealed && (
                         cell.isMine 
                            ? <Bomb className={`w-8 h-8 ${gameState === 'LOST' ? 'text-red-500 animate-bounce' : 'text-slate-500'}`} />
                            : <Gem className="w-8 h-8 text-sky-400 animate-pulse drop-shadow-[0_0_10px_rgba(56,189,248,0.8)]" />
                     )}
                     {!cell.revealed && <div className="w-full h-full bg-gradient-to-b from-slate-600/50 to-transparent"></div>}
                  </button>
               ))}
            </div>
         </div>
       </div>

    </div>
  );
}
