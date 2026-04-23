import { useState } from 'react';
import { Play, Activity, BarChart2, X, TrendingUp, TrendingDown, Target, Coins, ShieldAlert, Mail, Wallet } from 'lucide-react';
import { useConnect, useEthereum, useAuthCore } from '@particle-network/auth-core-modal';
import Game from './components/Game';
import Plinko from './components/Plinko';
import Mines from './components/Mines';
import Crash from './components/Crash';
import Dice from './components/Dice';

export default function App() {
  const { connect, disconnect, connectionStatus, userInfo } = useConnect();
  const { openWallet } = useAuthCore();
  
  const [gameState, setGameState] = useState<'AUTH' | 'MENU' | 'PLAYING' | 'GAME_OVER' | 'PLINKO' | 'MINES' | 'CRASH' | 'DICE'>('MENU');
  const [selectedGame, setSelectedGame] = useState<'SLITHER' | 'PLINKO' | 'MINES' | 'CRASH' | 'DICE'>('SLITHER');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [balance, setBalance] = useState(0);
  const [showPNL, setShowPNL] = useState(false);
  const [totalInjected, setTotalInjected] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);
  const [emailInput, setEmailInput] = useState('');

  const pnl = balance - totalInjected;
  const isProfitable = pnl >= 0;

  const startGame = () => {
    if (balance < 5 && selectedGame === 'SLITHER') return; // Only slither has base $5
    if (selectedGame === 'SLITHER') {
       setBalance(b => b - 5);
       setTotalSessions(s => s + 1);
       setScore(0);
       setGameState('PLAYING');
    } else if (selectedGame === 'PLINKO') {
       setGameState('PLINKO');
    } else if (selectedGame === 'MINES') {
       setGameState('MINES');
    } else if (selectedGame === 'CRASH') {
       setGameState('CRASH');
    } else if (selectedGame === 'DICE') {
       setGameState('DICE');
    }
  };

  const handleGameOver = (finalScore: number) => {
    setScore(finalScore);
    if (finalScore > highScore) {
      setHighScore(finalScore);
    }
    setGameState('GAME_OVER');
  };

  const topUp = () => {
    setBalance(b => b + 5);
    setTotalInjected(i => i + 5);
  };

  const handleMoneyCollect = (amount: number) => {
    setBalance(b => b + amount);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-900 text-slate-50 font-sans select-none flex flex-col"
         style={{
           backgroundImage: 'linear-gradient(rgba(56,189,248,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.1) 1px, transparent 1px)',
           backgroundSize: '20px 20px'
         }}>

      {/* Game Instance */}
      {gameState === 'PLAYING' && selectedGame === 'SLITHER' && (
        <div className="absolute inset-0 z-0">
          <Game
            onGameOver={handleGameOver}
            onScoreUpdate={setScore}
            onMoneyCollect={handleMoneyCollect}
          />
        </div>
      )}

      {gameState === 'PLINKO' && (
        <div className="absolute inset-0 z-10">
          <Plinko 
             balance={balance} 
             onBalanceChange={handleMoneyCollect}
             onExit={() => setGameState('MENU')}
          />
        </div>
      )}
      
      {gameState === 'MINES' && (
        <div className="absolute inset-0 z-10">
          <Mines 
             balance={balance} 
             onBalanceChange={handleMoneyCollect}
             onExit={() => setGameState('MENU')}
          />
        </div>
      )}

      {gameState === 'CRASH' && (
        <div className="absolute inset-0 z-10">
          <Crash 
             balance={balance} 
             onBalanceChange={handleMoneyCollect}
             onExit={() => setGameState('MENU')}
          />
        </div>
      )}

      {gameState === 'DICE' && (
        <div className="absolute inset-0 z-10">
          <Dice 
             balance={balance} 
             onBalanceChange={handleMoneyCollect}
             onExit={() => setGameState('MENU')}
          />
        </div>
      )}

      {/* Playing UI HUD */}
      {gameState === 'PLAYING' && (
        <>
          <header className="absolute top-0 left-0 right-0 h-16 border-b border-sky-500/30 flex items-center justify-between px-8 bg-slate-900/80 backdrop-blur z-10 pointer-events-none">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 bg-sky-500 rotate-45 flex-shrink-0"></div>
              <h1 className="text-2xl font-black tracking-tighter text-sky-400 hidden sm:block">NEON SLITHER</h1>
            </div>
            <div className="flex gap-8 sm:gap-12 font-mono text-sm">
              <div className="flex flex-col">
                <span className="text-green-500/60 text-[10px] uppercase">Balance</span>
                <span className="text-xl text-green-400 font-bold">${balance.toFixed(2)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sky-500/60 text-[10px] uppercase">Length</span>
                <span className="text-xl text-white">{score.toString().padStart(4, '0')}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sky-500/60 text-[10px] uppercase">Best</span>
                <span className="text-xl text-yellow-400">{highScore.toString().padStart(4, '0')}</span>
              </div>
            </div>
          </header>
          <footer className="absolute bottom-0 left-0 right-0 h-8 sm:h-12 border-t border-slate-800 flex items-center justify-between px-4 sm:px-8 bg-slate-900/80 text-[8px] sm:text-[10px] font-mono text-slate-500 uppercase tracking-widest z-10 pointer-events-none backdrop-blur">
            <span>System Status: Operational</span>
            <span className="hidden sm:inline">Precision: 100%</span>
            <span>Local Link: 127.0.0.1</span>
          </footer>
        </>
      )}

      {/* Auth Overlay */}
      {(connectionStatus === 'disconnected' || connectionStatus === 'loading') && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-[8px]">
          <div className="max-w-md w-full text-center space-y-8 p-12 border border-sky-500/50 relative overflow-hidden bg-slate-900">
            <div className="absolute -top-12 -left-12 w-24 h-24 border border-sky-500/30 rotate-12"></div>
            <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-sky-500/10 rotate-45"></div>
            
            <div className="relative z-10">
              <h2 className="text-5xl font-black italic tracking-tighter text-white mb-2 leading-none">SYSTEM<br/>ACCESS</h2>
              <p className="text-sky-400/80 font-mono text-sm uppercase">Secure Web3 Identity</p>
            </div>
            
            <div className="relative z-10 w-full mt-8 space-y-4 font-mono">
              {connectionStatus === 'loading' ? (
                 <div className="py-12 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                 </div>
              ) : (
                <>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="email" 
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="Enter email..." 
                      className="w-full bg-slate-900 border border-sky-500/30 p-3 pl-10 text-sm text-white focus:outline-none focus:border-sky-500 transition-colors"
                    />
                  </div>
                  
                  <button 
                    onClick={() => connect({ email: emailInput })}
                    className="w-full py-3 bg-sky-500 hover:bg-sky-400 text-slate-900 font-bold text-sm uppercase transition-colors flex items-center justify-center"
                  >
                    Authenticate Wallet
                  </button>

                  <div className="flex items-center gap-4 text-slate-500 text-xs uppercase py-2">
                    <div className="flex-1 h-px bg-slate-800"></div>
                    <span>OR</span>
                    <div className="flex-1 h-px bg-slate-800"></div>
                  </div>

                  <button 
                    onClick={() => connect({ socialType: 'google' })}
                    className="w-full py-3 border border-sky-500/50 hover:bg-sky-500/10 text-sky-400 font-bold text-sm uppercase transition-colors flex items-center justify-center gap-2"
                  >
                    Continue with Google
                  </button>
                </>
              )}
            </div>

            <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] relative z-10 mt-8">Particle Network Auth Core</p>
          </div>
        </div>
      )}

      {/* Menu Overlay */}
      {connectionStatus === 'connected' && gameState === 'MENU' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-[8px]">
          {/* Settings / PNL Toggle */}
          <button 
            onClick={() => setShowPNL(true)}
            className={`absolute left-0 top-1/2 -translate-y-1/2 p-3 bg-slate-800 border-y border-r border-sky-500/50 hover:bg-sky-500/20 text-sky-400 transition-transform z-40 ${showPNL ? '-translate-x-full' : 'translate-x-0'}`}
          >
            <BarChart2 className="w-6 h-6" />
          </button>

          {/* PNL Sidebar */}
          <div 
            className={`absolute left-0 top-0 bottom-0 w-80 bg-slate-900/95 border-r border-sky-500/30 transition-transform duration-300 z-50 flex flex-col backdrop-blur-md ${showPNL ? 'translate-x-0' : '-translate-x-full'}`}
          >
            <div className="p-6 border-b border-sky-500/30 flex justify-between items-center">
              <h3 className="text-xl font-bold font-mono text-sky-400 uppercase tracking-widest">Operator P&L</h3>
              <button onClick={() => setShowPNL(false)} className="text-sky-500/60 hover:text-sky-400 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 flex-1 space-y-6 font-mono overflow-y-auto w-full text-left">
              <div className="p-4 border border-slate-700 bg-slate-800/50 relative overflow-hidden">
                <span className="text-[10px] text-slate-400 uppercase tracking-widest absolute top-2 left-3">Gross P/L</span>
                <div className={`text-3xl font-black mt-4 flex items-center gap-2 ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfitable ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                  {isProfitable ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                </div>
              </div>
              
              <div className="space-y-4 text-sm w-full mt-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-slate-500 uppercase">Live Balance</span>
                  <span className="text-white">${balance.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-slate-500 uppercase">Total Injected</span>
                  <span className="text-sky-400">${totalInjected.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-slate-500 uppercase">Sessions Run</span>
                  <span className="text-yellow-400">{totalSessions}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-slate-500 uppercase">Total Buy-ins</span>
                  <span className="text-red-400">${(totalSessions * 5).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-md w-full text-center space-y-8 p-12 border border-sky-500/50 relative overflow-hidden bg-slate-900">
            <div className="absolute -top-12 -left-12 w-24 h-24 border border-sky-500/30 rotate-12"></div>
            <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-sky-500/10 rotate-45"></div>
            
            <div className="relative z-10">
              <h2 className="text-6xl font-black italic tracking-tighter text-white mb-2 leading-none">START<br/>SYSTEM</h2>
              <p className="text-sky-400/80 font-mono text-sm">OPTIMIZE GEOMETRIC EFFICIENCY</p>
            </div>
            
            <div className="relative z-10 w-full mt-8">
              <div className="grid grid-cols-1 gap-2 mb-6">
                 <button onClick={() => setSelectedGame('SLITHER')} className={`col-span-full py-3 font-mono text-xs uppercase font-bold border transition-colors ${selectedGame === 'SLITHER' ? 'bg-sky-500/20 text-sky-400 border-sky-500' : 'bg-slate-800 text-slate-500 border-sky-500/20 hover:border-sky-500/50'}`}>
                    Slither
                 </button>
              </div>

              <div className="flex justify-between items-center text-sm font-mono border-b border-sky-500/30 pb-2 mb-6">
                 <span className="text-sky-500/60 uppercase">System Credits</span>
                 <span className="text-xl text-white font-bold">${balance.toFixed(2)}</span>
              </div>

              <button 
                onClick={startGame}
                disabled={selectedGame === 'SLITHER' && balance < 5}
                className={`w-full py-4 font-bold text-xl uppercase transition-colors flex items-center justify-center gap-3 relative z-10 mb-4 ${
                  (selectedGame !== 'SLITHER' || balance >= 5)
                    ? 'bg-sky-500 hover:bg-sky-400 text-slate-900' 
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
              >
                <span>{selectedGame === 'SLITHER' ? 'Launch Session (-$5.00)' : `Open ${selectedGame}`}</span>
                <Play className="w-5 h-5 fill-current" />
              </button>

              <button 
                onClick={topUp}
                className="w-full py-3 mb-4 border border-sky-500/50 hover:bg-sky-500/10 text-sky-400 font-bold text-sm uppercase transition-colors flex items-center justify-center gap-2"
              >
                <span>Inject Funds (+$5.00)</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                 <button 
                   onClick={() => openWallet()}
                   className="w-full py-2 border border-slate-700 hover:border-sky-500/50 hover:bg-sky-500/10 text-slate-500 hover:text-sky-400 font-bold text-xs uppercase transition-colors flex items-center justify-center gap-2"
                 >
                   <Wallet className="w-3 h-3" />
                   <span>Wallet</span>
                 </button>

                 <button 
                   onClick={() => disconnect()}
                   className="w-full py-2 border border-slate-700 hover:border-red-500/50 hover:bg-red-500/10 text-slate-500 hover:text-red-400 font-bold text-xs uppercase transition-colors flex items-center justify-center gap-2"
                 >
                   <span>Disconnect</span>
                 </button>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] relative z-10 mt-8">
               {userInfo?.name || userInfo?.email || 'User Auth OK'} // Version 2.05
            </p>
          </div>
        </div>
      )}

      {/* Game Over Overlay */}
      {gameState === 'GAME_OVER' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-[8px] transition-opacity duration-500">
          <div className="max-w-md w-full text-center space-y-8 p-12 border border-sky-500/50 relative overflow-hidden bg-slate-900">
            <div className="absolute -top-12 -right-12 w-24 h-24 border border-sky-500/30 rotate-45"></div>
            <div className="absolute -bottom-12 -left-12 w-24 h-24 bg-sky-500/10 rotate-12"></div>
            
            <div className="relative z-10">
              <h2 className="text-5xl font-black uppercase tracking-tight text-red-500 mb-2 leading-none">
                SYSTEM<br/>FAILURE
              </h2>
            </div>
            
            <div className="border-t border-b border-sky-500/30 py-6 my-6 font-mono relative z-10">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sky-500/60 text-xs uppercase">Final Score</span>
                <span className="text-2xl text-white">{score.toString().padStart(4, '0')}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sky-500/60 text-xs uppercase text-yellow-500/80">High Score</span>
                <span className="text-xl text-yellow-400">{highScore.toString().padStart(4, '0')}</span>
              </div>
            </div>
            
            <div className="relative z-10 w-full mt-2">
              <div className="flex justify-between items-center text-sm font-mono border-b border-sky-500/30 pb-2 mb-6">
                 <span className="text-sky-500/60 uppercase">System Credits</span>
                 <span className="text-xl text-white font-bold">${balance.toFixed(2)}</span>
              </div>
              
              <button 
                onClick={startGame}
                disabled={balance < 5}
                className={`w-full py-4 font-bold text-xl uppercase transition-colors flex items-center justify-center gap-3 relative z-10 mb-4 ${
                  balance >= 5 
                    ? 'bg-sky-500 hover:bg-sky-400 text-slate-900' 
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
              >
                 <span>Reboot System (-$5.00)</span>
                 <Activity className="w-5 h-5" />
              </button>

              <button 
                onClick={topUp}
                className="w-full py-3 border border-sky-500/50 hover:bg-sky-500/10 text-sky-400 font-bold text-sm uppercase transition-colors flex items-center justify-center gap-2 mb-6"
              >
                <span>Inject Funds (+$5.00)</span>
              </button>

              <button 
                onClick={() => setGameState('MENU')}
                className="w-full py-2 text-sky-500/60 hover:text-sky-400 transition-colors uppercase tracking-widest text-xs font-bold font-mono relative z-10"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
