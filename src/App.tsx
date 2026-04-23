import { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Activity, 
  BarChart2, 
  X, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Coins, 
  ShieldAlert, 
  Mail, 
  Wallet,
  LayoutDashboard,
  Search,
  User,
  Gamepad2,
  ChevronRight,
  PlusCircle,
  Copy,
  ExternalLink,
  QrCode,
  Eye,
  EyeOff,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertCircle,
  Bell,
  Info
} from 'lucide-react';
import { useConnect, useAuthCore } from '@particle-network/auth-core-modal';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase } from './lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import Game from './components/Game';

type Page = 'HOME' | 'PLAYING';

export default function App() {
  const { connect, disconnect, connectionStatus, userInfo: connectUserInfo } = useConnect();
  const { openWallet, provider, userInfo: authUserInfo } = useAuthCore();
  
  // Combine user info from both sources
  const userInfo = connectUserInfo || authUserInfo;
  const isAdmin = userInfo?.email === 'ptnmgmt@gmail.com';

  const [currentPage, setCurrentPage] = useState<Page>('HOME');
  const [selectedGame, setSelectedGame] = useState<'SLITHER'>('SLITHER');
  const [score, setScore] = useState(0);
  const [isTestMode, setIsTestMode] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const [balance, setBalance] = useState(0);
  const [userAddress, setUserAddress] = useState('');
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [totalInjected, setTotalInjected] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);
  const [emailInput, setEmailInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const [isDepositWizardOpen, setIsDepositWizardOpen] = useState(false);
  const [gameOverResult, setGameOverResult] = useState<{ score: number, collected: number, penalty: number, rake: number } | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  // CONFIGURATION
  const PRIMARY_WALLET = '0xbf191b6775ca615d3f3227373e660861959e0035';
  const USDC_ADDRESS = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'; // USDC on BSC (BEP20)
  const USDC_DECIMALS = 18; // USDC on BSC has 18 decimals

  const notify = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Sync with Supabase on auth change
  useEffect(() => {
    console.log('Auth State Change:', { connectionStatus, userInfo, hasProvider: !!provider });
    const getAddress = async () => {
      if (connectionStatus === 'connected' && userInfo) {
        console.log('User logged in, userInfo:', userInfo);
        
        // Try multiple paths for the address
        let address = userInfo.wallets?.[0]?.public_address || (userInfo as any).public_address;
        
        // Fallback to provider if still missing
        if (!address && provider) {
          try {
            const accounts = await (provider as any).request({ method: 'eth_accounts' });
            if (accounts && accounts.length > 0) address = accounts[0];
          } catch (e) {
            console.error('Error fetching accounts from provider:', e);
          }
        }

        if (address) {
          console.log('Setting userAddress:', address);
          setUserAddress(address);
        }
        fetchUserData();
      }
    };
    getAddress();
  }, [connectionStatus, userInfo, provider]);

  const fetchUserData = async () => {
    if (!userInfo?.uuid) return;
    
    // Fetch wallet balance if available
    let walletBalance = 0;
    const address = userAddress || userInfo.wallets?.[0]?.public_address || (userInfo as any).public_address;
    
    if (address && !userAddress) setUserAddress(address);

    if (address && provider) {
      try {
        // Fetch USDC Balance using eth_call
        // Selector for balanceOf(address): 0x70a08231
        const data = '0x70a08231' + address.replace('0x', '').padStart(64, '0');
        const hexBalance = await (provider as any).request({
          method: 'eth_call',
          params: [{
            to: USDC_ADDRESS,
            data: data
          }, 'latest'],
        });
        
        if (hexBalance && hexBalance !== '0x') {
          const rawBalance = BigInt(hexBalance);
          // 1 USDC = 1 Credit
          walletBalance = Number(rawBalance) / 10 ** USDC_DECIMALS; 
        }
      } catch (err) {
        console.error('USDC balance fetch error:', err);
      }
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userInfo.uuid)
        .single();

      if (data) {
        // Source of truth is now the database (which syncs with wallet balance)
        const finalBalance = data.balance ?? 0;
        setBalance(finalBalance);
        setHighScore(data.high_score);
        setTotalInjected(data.total_injected);
        setTotalSessions(data.total_sessions);
        setUserProfile(data);
        
        // Sync back to Supabase if wallet balance changed
        if (walletBalance > 0 && Math.abs(walletBalance - data.balance) > 0.01) {
          updateUserData({ balance: walletBalance });
        }
        
        // If profile doesn't have name/email, update it
        if (!data.email || !data.name) {
          const fallbackName = userInfo.name || (userInfo.email ? userInfo.email.split('@')[0] : 'Operator ' + userInfo.uuid.slice(0, 4));
          updateUserData({ 
            email: userInfo.email || data.email,
            name: data.name || fallbackName
          });
          // Update local state immediately
          setUserProfile({ ...data, name: data.name || fallbackName, email: data.email || userInfo.email });
        }
      } else if (error && error.code === 'PGRST116') {
        const initialBalance = walletBalance;
        const { data: newData, error: insertError } = await supabase
          .from('profiles')
          .insert([{ 
            id: userInfo.uuid, 
            email: userInfo.email,
            name: userInfo.name || 'Operator ' + userInfo.uuid.slice(0, 4),
            balance: initialBalance,
            high_score: 0,
            total_injected: 0,
            total_sessions: 0
          }])
          .select()
          .single();
        
        if (newData) {
          setBalance(newData.balance);
          setHighScore(newData.high_score);
          setTotalInjected(newData.total_injected);
          setTotalSessions(newData.total_sessions);
          setUserProfile(newData);
        }
        if (insertError) console.error('Error creating profile:', insertError);
      }
    } catch (err) {
      console.error('Supabase fetch error:', err);
    }
  };

  const handleDemoTopup = async () => {
    if (!userInfo?.uuid) return;
    setIsProcessing(true);
    try {
      const topupAmount = 100;
      const newBalance = balance + topupAmount;
      setBalance(newBalance);
      await updateUserData({ balance: newBalance });
      notify('Demo Funds Added: +100 USDC', 'success');
    } catch (err) {
      console.error('Demo topup error:', err);
      notify('Failed to add demo funds', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const updateUserData = async (updates: any) => {
    if (!userInfo?.uuid) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userInfo.uuid);
      if (error) throw error;
    } catch (err) {
      console.error('Supabase update error:', err);
    }
  };

  const startGame = async () => {
    if (selectedGame === 'SLITHER') {
       if (!isTestMode && balance < 5) {
         setConfirmModal({
           show: true,
           title: 'Insufficient Credits',
           message: '$5.00 Entry Fee required. Please top up your balance to continue.',
           onConfirm: () => setIsDepositWizardOpen(true)
         });
         return;
       }

        setIsProcessing(true);
        try {
          const { data: { session: authSession } } = await supabase.auth.getSession();
          
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authSession?.access_token || ''}`
            },
            body: JSON.stringify({ 
              action: 'START_SESSION', 
              payload: { 
                userId: userInfo?.uuid,
                isTest: isTestMode // Pass test mode to backend
              } 
            })
          });
          
          const result = await response.json();
          if (result.error && !isTestMode) throw new Error(result.error);

          if (result.newBalance !== undefined) setBalance(result.newBalance);
          setTotalSessions(prev => prev + 1);
          setScore(0);
          setCurrentPage('PLAYING');
          if (!isTestMode) notify('Session Started: -$5.00', 'info');
          else notify('Test Session Started (Free)', 'info');
        } catch (err: any) {
          console.error('Start game error:', err);
          notify(err.message || 'Failed to start session', 'error');
        } finally {
          setIsProcessing(false);
        }
    } else {
       setCurrentPage('PLAYING');
    }
  };

  const handleDeposit = async (amount: number) => {
    if (!userInfo?.uuid) {
      notify('Please log in first', 'error');
      return;
    }
    if (!provider) {
      notify('Wallet provider not ready. Please refresh.', 'error');
      return;
    }
    
    const address = userAddress || userInfo.wallets?.[0]?.public_address || (userInfo as any).public_address;
    if (!address) {
      notify('Wallet address not found. Please refresh.', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      // Encode ERC-20 transfer(address,uint256)
      // Selector: 0xa9059cbb
      const selector = '0xa9059cbb';
      const paddedAddress = PRIMARY_WALLET.replace('0x', '').padStart(64, '0');
      const rawAmount = BigInt(amount) * BigInt(10) ** BigInt(USDC_DECIMALS);
      const paddedAmount = rawAmount.toString(16).padStart(64, '0');
      
      const data = selector + paddedAddress + paddedAmount;

      const transactionParameters = {
        from: address,
        to: USDC_ADDRESS,
        value: '0x0',
        data: data,
      };

      const txHash = await (provider as any).request({
        method: 'eth_sendTransaction',
        params: [transactionParameters],
      });

      if (txHash) {
        console.log('Transaction sent:', txHash);
        // Wait for a bit then refresh
        setTimeout(() => fetchUserData(), 3000);
        
        // Optimistic update
        const credits = amount; 
        const newBalance = balance + credits;
        const newTotalInjected = totalInjected + credits;
        setBalance(newBalance);
        setTotalInjected(newTotalInjected);
        updateUserData({ balance: newBalance, total_injected: newTotalInjected });
        
        notify(`Deposit successful! TX: ${txHash.slice(0, 10)}...`, 'success');
      }
    } catch (err: any) {
      console.error('Transaction error:', err);
      notify('Transaction failed or cancelled: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGameOver = (finalScore: number, collectedMoney: number) => {
    const roundedScore = Math.floor(finalScore);
    
    // Detailed Breakdown Math
    const penaltyAmount = (collectedMoney * 0.5);
    const rakeAmount = penaltyAmount * 0.05;

    setGameOverResult({
      score: roundedScore,
      collected: collectedMoney,
      penalty: penaltyAmount,
      rake: rakeAmount
    });

    setScore(roundedScore);
    if (roundedScore > highScore) {
      setHighScore(roundedScore);
      updateUserData({ high_score: roundedScore });
    }
    
    // Refresh user data after game to get final balance from backend
    setTimeout(() => fetchUserData(), 1500);
  };


  const collectionBufferRef = useRef<number>(0);
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMoneyCollect = async (amount: number, dropId?: string) => {
    // Optimistic update for immediate visual feedback
    setBalance(prev => prev + amount);
    
    // If it's a major persistent drop (has dropId), send immediately
    if (dropId) {
        try {
          const { data: { session: authSession } } = await supabase.auth.getSession();
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authSession?.access_token || ''}`
            },
            body: JSON.stringify({ 
              action: 'COLLECT', 
              payload: { amount, dropId, userId: userInfo?.uuid } 
            })
          });
        } catch (err) {
          console.error('Persistent drop collect error:', err);
        }
        return;
    }

    // For small orbs, aggregate and flush every 2 seconds
    collectionBufferRef.current += amount;
    
    if (!flushTimeoutRef.current) {
        flushTimeoutRef.current = setTimeout(async () => {
            const flushAmount = collectionBufferRef.current;
            collectionBufferRef.current = 0;
            flushTimeoutRef.current = null;

            if (flushAmount <= 0) return;

            try {
              const { data: { session: authSession } } = await supabase.auth.getSession();
              const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${authSession?.access_token || ''}`
                },
                body: JSON.stringify({ 
                  action: 'COLLECT', 
                  payload: { amount: flushAmount, userId: userInfo?.uuid } 
                })
              });
              
              const result = await response.json();
              if (result.newBalance !== undefined) {
                setBalance(result.newBalance);
              }
            } catch (err) {
              console.error('Money collect sync error:', err);
            }
        }, 2000);
    }
  };

  const pnl = balance - totalInjected;
  const isProfitable = pnl >= 0;

  if (connectionStatus !== 'connected') {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-slate-950 text-slate-50 font-sans select-none flex flex-col items-center justify-center">
        <div className="absolute inset-0 z-0 opacity-20"
             style={{
               backgroundImage: 'radial-gradient(circle at 50% 50%, #38bdf8 0%, transparent 50%)',
               filter: 'blur(100px)'
             }}></div>
        
        <div className="max-w-md w-full text-center space-y-8 p-12 relative overflow-hidden bg-slate-900/40 backdrop-blur-2xl rounded-3xl shadow-2xl">
          <div className="relative z-10">
            <h2 className="text-6xl font-black italic tracking-tighter text-white mb-2 leading-none">SYSTEM<br/>ACCESS</h2>
            <p className="text-sky-400 font-mono text-sm uppercase tracking-widest">Secure Web3 Identity</p>
          </div>
          
          <div className="relative z-10 w-full mt-8 space-y-4 font-mono">
            {connectionStatus === 'loading' ? (
               <div className="py-12 flex items-center justify-center">
                  <div className="w-12 h-12 border-t-transparent rounded-full animate-spin"></div>
               </div>
            ) : (
              <>
                <div className="relative group">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-sky-400 transition-colors" />
                  <input 
                    type="email" 
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="Enter secure email..." 
                    className="w-full bg-slate-950/50 p-4 pl-12 text-sm text-white focus:outline-none transition-all rounded-xl"
                  />
                </div>
                
                <button 
                  disabled={isProcessing}
                  onClick={() => connect({ email: emailInput })}
                  className="w-full py-4 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm uppercase transition-all rounded-xl shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-50"
                >
                  {isProcessing ? 'Authorizing...' : 'Authenticate Wallet'}
                </button>

                <div className="flex items-center gap-4 text-slate-500 text-xs uppercase py-2">
                  <div className="flex-1 h-px bg-slate-800"></div>
                  <span>OR</span>
                  <div className="flex-1 h-px bg-slate-800"></div>
                </div>

                <button 
                  onClick={() => connect({ socialType: 'google' })}
                  className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold text-sm uppercase transition-all rounded-xl flex items-center justify-center gap-2"
                >
                  Continue with Google
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 text-slate-50 font-sans select-none flex">
      {/* Sidebar Navigation */}
      <nav className="w-24 lg:w-64 h-full bg-slate-900/50 backdrop-blur-xl flex flex-col items-center lg:items-stretch p-6 gap-8 z-50 shadow-2xl">
        <div className="flex items-center gap-4 px-2">
          <div className="w-10 h-10 bg-sky-500 rounded-xl flex-shrink-0 flex items-center justify-center shadow-lg shadow-sky-500/30">
            <Zap className="text-slate-950 w-6 h-6" />
          </div>
          <h1 className="text-xl font-black tracking-tighter text-white hidden lg:block uppercase">Slither Dash v2</h1>
        </div>

        <div className="flex-1 flex flex-col gap-2">
          <button
            onClick={() => setCurrentPage('HOME')}
            className={`flex items-center gap-4 p-4 rounded-2xl transition-all group ${
              currentPage === 'HOME' 
                ? 'bg-sky-500 text-slate-950 shadow-lg shadow-sky-500/20' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-6 h-6" />
            <span className="font-bold text-sm uppercase hidden lg:block">Terminal</span>
          </button>
        </div>

        <div className="mt-auto space-y-4">
          <div className="p-4 bg-slate-800/50 rounded-2xl hidden lg:block group relative">
            <div className="flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-sky-500/60 text-[10px] uppercase font-bold tracking-widest mb-1">Balance</span>
                <button 
                  onClick={() => setIsBalanceVisible(!isBalanceVisible)}
                  className="text-slate-500 hover:text-sky-400 transition-colors"
                >
                  {isBalanceVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
              </div>
              <span className="text-xl text-white font-black">
                {isBalanceVisible ? `$${(balance || 0).toFixed(2)}` : '••••••'}
              </span>
            </div>
          </div>
          <button 
            onClick={() => disconnect()}
            className="w-full flex items-center justify-center lg:justify-start gap-4 p-4 text-red-400 hover:bg-red-500/10 rounded-2xl transition-all"
          >
            <X className="w-6 h-6" />
            <span className="font-bold text-sm uppercase hidden lg:block">Disconnect</span>
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-y-auto bg-slate-950 p-6 lg:p-12">
        {currentPage === 'HOME' && (
          <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Profile & Identity Section */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 bg-slate-900 rounded-3xl shadow-xl">
               <div className="flex items-center gap-6">
                  <div className="w-20 h-20 bg-sky-500 rounded-2xl flex items-center justify-center shadow-lg shadow-sky-500/20">
                    <User className="w-10 h-10 text-slate-950" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase">
                      {userProfile?.name || userInfo?.name || (userInfo?.email ? userInfo.email.split('@')[0] : 'Anonymous Operator')}
                    </h3>
                    <p className="text-sky-400 font-mono text-sm">
                      {userProfile?.email || userInfo?.email || (userAddress ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : 'unlinked@system.node')}
                    </p>
                  </div>
               </div>
               
               <div className="flex flex-wrap gap-4">
                  <button onClick={fetchUserData} className="flex items-center gap-3 px-6 py-4 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-2xl font-bold transition-all active:scale-95 shadow-lg">
                    <RefreshCw className={`w-5 h-5 ${isProcessing ? 'animate-spin' : ''}`} />
                    <span>REFRESH</span>
                  </button>
                  <button 
                    disabled={isProcessing}
                    onClick={() => setIsDepositWizardOpen(true)}
                    className="flex items-center gap-3 px-6 py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-2xl font-bold transition-all active:scale-95 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                  >
                    <PlusCircle className="w-5 h-5" />
                    <span>DEPOSIT</span>
                  </button>
                  <button onClick={() => setIsWalletOpen(true)} className="flex items-center gap-3 px-6 py-4 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-2xl font-bold transition-all active:scale-95 shadow-lg shadow-sky-500/20">
                    <Wallet className="w-5 h-5" />
                    <span>WALLET</span>
                  </button>
               </div>
            </div>

            {/* Performance Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-2 p-8 bg-slate-900 rounded-3xl space-y-4 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                   <TrendingUp className="w-32 h-32" />
                </div>
                <p className="text-sky-400 font-mono text-xs uppercase tracking-widest">Gross Profit/Loss</p>
                <div className={`text-6xl font-black flex items-center gap-4 ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isProfitable ? <TrendingUp className="w-12 h-12" /> : <TrendingDown className="w-12 h-12" />}
                  {Math.abs(pnl).toFixed(2)} USDC
                </div>
                <div className="pt-4 flex gap-4">
                  <div className="flex-1 p-4 bg-slate-950/50 rounded-2xl">
                    <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Injected</p>
                    <p className="text-xl font-bold">{totalInjected.toFixed(2)} USDC</p>
                  </div>
                  <div className="flex-1 p-4 bg-slate-950/50 rounded-2xl">
                    <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Current</p>
                    <div className="flex items-center justify-between">
                      <p className="text-xl font-bold text-white">
                        {isBalanceVisible ? `$${balance.toFixed(2)}` : '••••••'}
                      </p>
                      <button onClick={() => setIsBalanceVisible(!isBalanceVisible)} className="text-slate-600 hover:text-sky-400">
                        {isBalanceVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-slate-900 rounded-3xl flex flex-col justify-between shadow-xl">
                <p className="text-sky-400 font-mono text-xs uppercase tracking-widest">Total Sessions</p>
                <div className="text-6xl font-black text-white">{totalSessions}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest">Active Runtime</div>
              </div>

              <div className="p-8 bg-slate-900 rounded-3xl flex flex-col justify-between shadow-xl">
                <p className="text-sky-400 font-mono text-xs uppercase tracking-widest">Best Mass</p>
                <div className="text-6xl font-black text-yellow-400">{Math.floor(highScore)}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest">Geometric Peak</div>
              </div>
            </div>

            {/* Primary Protocol Access */}
            <div className="pt-4 pb-12">
              <button 
                onClick={startGame}
                className="group relative w-full min-h-[400px] bg-slate-900 rounded-[3rem] overflow-hidden text-left transition-all hover:scale-[1.01] active:scale-[0.99] shadow-2xl border-none"
              >
                {/* Background Layering */}
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/20 via-slate-900 to-slate-950"></div>
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 mix-blend-overlay"></div>
                
                {/* Animated Orbs */}
                <div className="absolute -right-20 -top-20 w-96 h-96 bg-sky-500/20 rounded-full blur-[120px] group-hover:bg-sky-500/30 transition-all duration-1000"></div>
                <div className="absolute -left-20 -bottom-20 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] group-hover:bg-blue-600/20 transition-all duration-1000"></div>
                
                <div className="relative p-12 lg:p-16 h-full flex flex-col justify-between">
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                       <div className="px-4 py-1.5 bg-sky-500/20 rounded-full backdrop-blur-md">
                          <span className="text-sky-400 font-mono text-xs uppercase font-bold tracking-[0.2em]">Live Protocol</span>
                       </div>
                       <div className="px-4 py-1.5 bg-yellow-500/20 rounded-full backdrop-blur-md">
                          <span className="text-yellow-400 font-mono text-xs uppercase font-bold tracking-[0.2em]">$5.00 ENTRY</span>
                       </div>
                    </div>
                    
                    <div className="space-y-2">
                      <h2 className="text-6xl lg:text-8xl font-black italic tracking-tighter text-white leading-[0.9] uppercase">
                        NEON<br/>
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-sky-400">SLITHER</span>
                      </h2>
                      <p className="max-w-xl text-slate-400 text-lg lg:text-xl font-medium leading-relaxed">
                        Survive the digital void. Consume data nodes, outmaneuver rival protocols, and ascend to the peak of the arcade matrix.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-8 pt-12">
                    <div className="px-10 py-5 bg-sky-500 text-slate-950 rounded-2xl font-black text-2xl uppercase tracking-tighter shadow-2xl shadow-sky-500/40 group-hover:bg-sky-400 group-hover:scale-105 transition-all duration-300 flex items-center gap-4">
                      <Play className={`w-8 h-8 fill-current ${isProcessing ? 'animate-pulse' : ''}`} />
                      {isProcessing ? 'AUTHORIZING...' : 'START SESSION'}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-mono text-[10px] uppercase tracking-widest">Est. Potential</span>
                      <span className="text-emerald-400 font-black text-xl">HIGH RETURN</span>
                    </div>
                  </div>
                </div>

                {/* Decorative Elements */}
                <div className="absolute right-12 bottom-12 opacity-10 group-hover:opacity-20 transition-opacity">
                   <Gamepad2 className="w-48 h-48 text-white rotate-12" />
                </div>
              </button>
              
              {/* Test Mode Protocol Toggle - ADMIN ONLY */}
              {isAdmin && (
                <div className="mt-8 flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-sky-500/10 backdrop-blur-xl">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isTestMode ? 'bg-yellow-500 animate-pulse' : 'bg-slate-700'}`}></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">Testing Environment</span>
                      <span className="text-[10px] font-mono text-sky-500/60 uppercase tracking-tighter">Bypass Economic Deduction</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsTestMode(!isTestMode)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${
                      isTestMode 
                        ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20' 
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {isTestMode ? 'TEST MODE ACTIVE' : 'ENABLE TEST MODE'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentPage === 'PLAYING' && (
          <div className="fixed inset-0 z-[100] bg-slate-950">
            {/* Unified HUD */}
            <div className="absolute top-0 left-0 right-0 z-[110] px-6 py-4 md:px-8 md:py-6 flex flex-col md:flex-row items-start md:items-center justify-between pointer-events-none gap-4">
              <div className="flex items-center gap-4 md:gap-6 pointer-events-auto">
                <button 
                  onClick={() => setCurrentPage('HOME')}
                  className="p-3 md:p-4 bg-slate-900/50 hover:bg-slate-800 text-white rounded-xl md:rounded-2xl backdrop-blur-xl transition-all shadow-xl group"
                >
                  <X className="w-5 h-5 md:w-6 md:h-6 group-hover:scale-110 transition-transform" />
                </button>
                
                <div className="flex flex-col">
                  <span className="text-sky-500/60 font-mono text-[8px] md:text-[10px] uppercase tracking-[0.2em] font-bold">Protocol</span>
                  <span className="text-xs md:text-sm font-black text-white uppercase tracking-tighter">{selectedGame} ACTIVE</span>
                </div>
              </div>

              {selectedGame === 'SLITHER' && (
                <div className="flex items-center gap-6 md:gap-12 bg-slate-900/40 backdrop-blur-2xl px-6 md:px-12 py-3 md:py-4 rounded-2xl md:rounded-3xl shadow-2xl pointer-events-auto">
                  <div className="flex flex-col items-center">
                    <span className="text-sky-500/60 font-mono text-[8px] md:text-[10px] uppercase tracking-[0.2em] font-bold">Current Mass</span>
                    <span className="text-2xl md:text-4xl font-black italic tracking-tighter text-white leading-none">{Math.floor(score)}</span>
                  </div>
                  <div className="w-px h-6 md:h-8 bg-slate-800"></div>
                  <div className="flex flex-col items-center">
                    <span className="text-yellow-500/60 font-mono text-[8px] md:text-[10px] uppercase tracking-[0.2em] font-bold">Geometric Peak</span>
                    <span className="text-xl md:text-2xl font-black italic tracking-tighter text-yellow-400 leading-none">{highScore}</span>
                  </div>
                </div>
              )}

              {/* Spacer for desktop layout balance */}
              <div className="hidden md:block w-48"></div>
            </div>

            {/* Credits HUD - Bottom on mobile, Top-Right on desktop */}
            <div className="fixed bottom-6 right-6 md:top-6 md:right-8 md:bottom-auto z-[120] flex items-center gap-4 bg-slate-900/40 backdrop-blur-2xl p-2 pl-4 md:pl-6 rounded-xl md:rounded-2xl shadow-2xl pointer-events-auto border border-white/5">
              <div className="flex flex-col items-end">
                <span className="text-sky-500/60 font-mono text-[8px] md:text-[10px] uppercase tracking-[0.2em] font-bold">Available Credits</span>
                <span className="text-sm md:text-xl font-black italic tracking-tighter text-white">
                  {isBalanceVisible ? `${balance.toFixed(2)} USDC` : '•••• USDC'}
                </span>
              </div>
              <button 
                onClick={() => setIsBalanceVisible(!isBalanceVisible)}
                className="w-8 h-8 md:w-10 md:h-10 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg md:rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20 transition-all"
              >
                {isBalanceVisible ? <Coins className="w-4 h-4 md:w-5 md:h-5" /> : <EyeOff className="w-4 h-4 md:w-5 md:h-5" />}
              </button>
            </div>

            
            {selectedGame === 'SLITHER' && (
              <Game
                onGameOver={handleGameOver}
                onScoreUpdate={setScore}
                onMoneyCollect={handleMoneyCollect}
                userProfile={userProfile}
              />
            )}
          </div>
        )}
      </main>

      {/* Custom Wallet Modal */}
      {isWalletOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 lg:p-12 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl" onClick={() => setIsWalletOpen(false)}></div>
          
          <div className="relative w-full max-w-2xl bg-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden">
            <div className="p-8 lg:p-12 space-y-12">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20">
                    <Wallet className="w-6 h-6 text-slate-950" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Wallet Terminal</h3>
                    <p className="text-sky-500/60 font-mono text-[10px] uppercase tracking-widest font-bold italic">Secure Node Connection</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsWalletOpen(false)}
                  className="p-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-8 bg-slate-950/50 rounded-3xl space-y-6">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-mono text-xs uppercase tracking-widest">Active Balance</span>
                    <button 
                      onClick={() => setIsBalanceVisible(!isBalanceVisible)}
                      className="px-3 py-1 bg-sky-500/10 rounded-full flex items-center gap-2 hover:bg-sky-500/20 transition-colors"
                    >
                      <span className="text-sky-400 font-mono text-[10px] uppercase font-bold">BSC USDC NETWORK</span>
                      {isBalanceVisible ? <Eye className="w-3 h-3 text-sky-400" /> : <EyeOff className="w-3 h-3 text-sky-400" />}
                    </button>
                  </div>
                  <div className="text-6xl font-black text-white tracking-tighter italic">
                    {isBalanceVisible ? `${balance.toFixed(2)} USDC` : '•••••• USDC'}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 bg-slate-800/30 rounded-2xl space-y-3">
                    <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest">Operator Address</p>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-white font-mono truncate max-w-[120px]">
                        {userAddress || '0x...'}
                      </span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(userAddress);
                          notify('Address copied to clipboard', 'success');
                        }}
                        className="p-2 hover:bg-sky-500/10 text-sky-400 rounded-lg transition-all"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={() => window.open('https://wallet.particle.network', '_blank')}
                    className="p-6 bg-slate-800/30 hover:bg-slate-800/50 rounded-2xl flex items-center justify-between group transition-all"
                  >
                    <div className="text-left">
                      <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest">Advanced Config</p>
                      <p className="text-white font-bold">External Node</p>
                    </div>
                    <ExternalLink className="w-5 h-5 text-sky-500 group-hover:scale-110 transition-transform" />
                  </button>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => setIsWalletOpen(false)}
                  className="w-full py-5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-2xl font-black text-xl uppercase tracking-tighter shadow-lg shadow-sky-500/20 transition-all active:scale-[0.98]"
                >
                  Return to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Wizard Modal */}
      {isDepositWizardOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-6 animate-in fade-in zoom-in duration-300">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-2xl" onClick={() => setIsDepositWizardOpen(false)}></div>
          
          <div className="relative w-full max-w-xl bg-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-800">
            <div className="p-8 lg:p-12 space-y-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <PlusCircle className="w-6 h-6 text-slate-950" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Funding Wizard</h3>
                    <p className="text-emerald-500/60 font-mono text-[10px] uppercase tracking-widest font-bold">Deposit USDC to Play</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsDepositWizardOpen(false)}
                  className="p-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex flex-col items-center space-y-8 py-4">
                <div className="p-4 bg-white rounded-3xl shadow-2xl shadow-sky-500/20">
                  <QRCodeCanvas 
                    value={userAddress} 
                    size={200}
                    level="H"
                    includeMargin={true}
                    imageSettings={{
                      src: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png",
                      x: undefined,
                      y: undefined,
                      height: 40,
                      width: 40,
                      excavate: true,
                    }}
                  />
                </div>
                
                <div className="w-full space-y-4">
                  <div className="p-6 bg-slate-950/50 rounded-2xl space-y-3">
                    <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest text-center">Your Deposit Address (BSC)</p>
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-xs font-bold text-sky-400 font-mono break-all text-center">
                        {userAddress}
                      </span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(userAddress);
                          notify('Address copied!', 'success');
                        }}
                        className="p-2 hover:bg-sky-500/10 text-sky-400 rounded-lg transition-all flex-shrink-0"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-800/30 rounded-2xl flex flex-col items-center justify-center gap-1">
                      <span className="text-[10px] text-slate-500 uppercase font-bold">Network</span>
                      <span className="text-sm font-black text-white">BSC (BEP20)</span>
                    </div>
                    <div className="p-4 bg-slate-800/30 rounded-2xl flex flex-col items-center justify-center gap-1">
                      <span className="text-[10px] text-slate-500 uppercase font-bold">Asset</span>
                      <span className="text-sm font-black text-white">USDC</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4">

                {isAdmin && (
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={handleDemoTopup}
                      disabled={isProcessing}
                      className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-2xl font-bold text-sm uppercase tracking-tighter transition-all flex items-center justify-center gap-2 border border-sky-500/20"
                    >
                      <Zap className="w-4 h-4" />
                      Demo Topup (+$100)
                    </button>
                  </div>
                )}
                
                <button 
                  onClick={() => setIsDepositWizardOpen(false)}
                  className="w-full py-5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-2xl font-black text-xl uppercase tracking-tighter shadow-lg shadow-sky-500/20 transition-all active:scale-[0.98]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Notification Toast System */}
      <div className="fixed bottom-8 right-8 z-[1000] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.95 }}
              className={`pointer-events-auto p-5 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center gap-4 min-w-[320px] border-l-4 ${
                n.type === 'success' ? 'bg-emerald-500/10 border-emerald-500' :
                n.type === 'error' ? 'bg-red-500/10 border-red-500' :
                'bg-sky-500/10 border-sky-500'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                n.type === 'success' ? 'bg-emerald-500 text-slate-950' :
                n.type === 'error' ? 'bg-red-500 text-white' :
                'bg-sky-500 text-slate-950'
              }`}>
                {n.type === 'success' ? <CheckCircle2 className="w-6 h-6" /> :
                 n.type === 'error' ? <AlertCircle className="w-6 h-6" /> :
                 <Info className="w-6 h-6" />}
              </div>
              <div className="flex-1">
                <p className="text-white font-bold text-sm leading-tight">{n.message}</p>
                <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest mt-1">System Message</p>
              </div>
              <button onClick={() => setNotifications(prev => prev.filter(i => i.id !== n.id))} className="text-slate-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>


      {/* Game Over Summary Modal */}
      <AnimatePresence>
        {gameOverResult && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-slate-900 rounded-[3rem] border border-white/5 shadow-2xl overflow-hidden"
            >
              {/* Background Accents */}
              <div className="absolute inset-0 bg-gradient-to-b from-red-500/10 to-transparent"></div>
              
              <div className="relative p-10 lg:p-14 space-y-10 text-white">
                <div className="text-center space-y-2">
                  <div className="inline-block px-4 py-1 bg-red-500/20 rounded-full mb-4">
                    <span className="text-red-400 font-mono text-[10px] uppercase font-bold tracking-widest">Protocol Terminated</span>
                  </div>
                  <h2 className="text-5xl lg:text-6xl font-black italic tracking-tighter uppercase leading-none">GAME OVER</h2>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-slate-950/50 rounded-3xl border border-white/5 space-y-1">
                    <p className="text-sky-500/60 font-mono text-[10px] uppercase font-bold tracking-widest">Final Mass</p>
                    <p className="text-4xl font-black italic">{gameOverResult.score}</p>
                  </div>
                  <div className="p-6 bg-slate-950/50 rounded-3xl border border-white/5 space-y-1">
                    <p className="text-emerald-500/60 font-mono text-[10px] uppercase font-bold tracking-widest">Global Balance</p>
                    <p className="text-2xl font-black italic">${balance.toFixed(2)}</p>
                  </div>
                </div>

                <div className="bg-slate-950/80 rounded-[2rem] border border-white/5 overflow-hidden">
                  <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold text-slate-400">Financial Summary</span>
                    <TrendingDown className="w-4 h-4 text-red-500/50" />
                  </div>
                  <div className="p-8 space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Session Wager</span>
                      <span className="text-white font-mono">$5.00</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Collected Earnings</span>
                      <span className="text-emerald-400 font-mono">+${gameOverResult.collected.toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-white/5"></div>
                    <div className="flex justify-between text-sm">
                      <div className="flex flex-col">
                        <span className="text-red-400">Death Penalty (50%)</span>
                        <span className="text-[10px] text-slate-500 uppercase">Clawback Protocol</span>
                      </div>
                      <span className="text-red-400 font-mono">-${gameOverResult.penalty.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-red-400/60">House Rake (5%)</span>
                      <span className="text-red-400/60 font-mono">-${gameOverResult.rake.toFixed(2)}</span>
                    </div>
                    <div className="pt-4 border-t border-white/10 flex justify-between items-baseline">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Net Session Profit</span>
                      <span className={`text-2xl font-black italic ${(gameOverResult.collected - gameOverResult.penalty - gameOverResult.rake - 5) >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                        ${(gameOverResult.collected - gameOverResult.penalty - gameOverResult.rake - 5).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <button 
                    onClick={() => {
                      setGameOverResult(null);
                      startGame();
                    }}
                    className="w-full py-5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-2xl font-black text-xl uppercase tracking-tighter shadow-lg shadow-sky-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                  >
                    <RefreshCw className="w-6 h-6" />
                    Play Again
                  </button>
                  <button 
                    onClick={() => {
                      setGameOverResult(null);
                      setCurrentPage('HOME');
                    }}
                    className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold text-sm uppercase transition-all"
                  >
                    Return to Dashboard
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Confirm Modal */}
      <AnimatePresence>
        {confirmModal.show && (
          <div className="fixed inset-0 z-[1100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 rounded-[2rem] shadow-2xl border border-slate-800 p-8 space-y-6 overflow-hidden"
            >
              <div className="w-16 h-16 bg-sky-500/10 rounded-2xl flex items-center justify-center">
                <Bell className="w-8 h-8 text-sky-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-white uppercase tracking-tighter">{confirmModal.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{confirmModal.message}</p>
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(prev => ({ ...prev, show: false }));
                  }}
                  className="flex-1 py-4 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl font-black transition-all shadow-lg shadow-sky-500/20"
                >
                  Proceed
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
