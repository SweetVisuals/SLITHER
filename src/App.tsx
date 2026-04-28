import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Info,
  Crown,
  LogOut,
  ArrowUpCircle
} from 'lucide-react';
import { ethers } from 'ethers';
import { useConnect, useAuthCore, useEthereum } from '@particle-network/auth-core-modal';
import { SmartAccount } from '@particle-network/aa';
import { ArbitrumOne } from '@particle-network/chains';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase } from './lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import Game from './components/Game';
import './premium.css';

type Page = 'HOME' | 'PLAYING' | 'PROFILE';

// Global singleton flag - prevents WASM double-init crash
let aaInitializing = false;

export default function App() {
  const { connect, disconnect, connectionStatus, userInfo: connectUserInfo } = useConnect();
  const { provider: authProvider, userInfo: authUserInfo, logout } = useAuthCore();
  const { provider: ethProvider, address: ethAddress } = useEthereum();
  
  const provider = authProvider || ethProvider;
  
  // Combine user info from both sources more robustly
  const userInfo = {
    ...(authUserInfo || {}),
    ...(connectUserInfo || {}),
    uuid: connectUserInfo?.uuid || authUserInfo?.uuid,
    email: authUserInfo?.email || connectUserInfo?.email || (authUserInfo as any)?.thirdparty_user_info?.user_info?.email || (connectUserInfo as any)?.thirdparty_user_info?.user_info?.email,
    name: authUserInfo?.name || connectUserInfo?.name || (authUserInfo as any)?.thirdparty_user_info?.user_info?.name || (connectUserInfo as any)?.thirdparty_user_info?.user_info?.name,
    wallets: [
      ...(connectUserInfo?.wallets || []),
      ...(authUserInfo?.wallets || [])
    ]
  };

  const [currentPage, setCurrentPage] = useState<Page>('HOME');
  const [selectedGame, setSelectedGame] = useState<'SLITHER'>('SLITHER');
  const [score, setScore] = useState(0);
  const [isTestMode, setIsTestMode] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const [balance, setBalance] = useState(0);
  const [userAddress, setUserAddress] = useState('');
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [totalInjected, setTotalInjected] = useState(0);
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);
  const [emailInput, setEmailInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedAddresses, setDetectedAddresses] = useState<{addr: string, bal: number, type: string}[]>([]);
  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const [isDepositWizardOpen, setIsDepositWizardOpen] = useState(false);
  const [gameOverResult, setGameOverResult] = useState<{ score: number, collected: number, penalty: number, rake: number } | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [currentSessionLoot, setCurrentSessionLoot] = useState(0);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [totalWalletBalance, setTotalWalletBalance] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [syncingTxHash, setSyncingTxHash] = useState<string | null>(null);
  const [bestWallet, setBestWallet] = useState<{addr: string, bal: number, type: string, token: string} | null>(null);
  const smartAccountRef = useRef<SmartAccount | null>(null);

  // Initialize SmartAccount once to avoid WASM re-init crashes
  useEffect(() => {
    if (!provider || smartAccountRef.current || aaInitializing) return;
    
    const initAA = async () => {
      aaInitializing = true;
      try {
        const forcedProvider = new Proxy(provider as any, {
          get(target, prop) {
            if (prop === 'request') {
              return async (args: any) => {
                if (args?.method === 'eth_chainId') return '0xa4b1';
                return target.request(args);
              };
            }
            return (target as any)[prop];
          }
        });

        const smartAccount = new SmartAccount(forcedProvider as any, {
          projectId: import.meta.env.VITE_PARTICLE_PROJECT_ID,
          clientKey: import.meta.env.VITE_PARTICLE_CLIENT_KEY,
          appId: import.meta.env.VITE_PARTICLE_APP_ID,
          aaOptions: {
            chainId: 42161,
            accountContracts: {
              BICONOMY: [{ version: '2.0.0', chainIds: [42161] }]
            }
          }
        });
        smartAccountRef.current = smartAccount;
        console.log('[AA] Smart Account initialized successfully');
      } catch (err) {
        console.error('[AA] Initialization error:', err);
        aaInitializing = false; // Allow retry on error
      }
    };
    
    initAA();
  }, [provider]);

  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  // CONFIGURATION
  const PRIMARY_WALLET = '0xf7dAd3bB9E89502d2e2ea478659875063b4b3F7A'; 
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Native USDC on Arbitrum
  const USDC_E_ADDRESS = '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'; // Bridged USDC.e on Arbitrum
  const USDC_DECIMALS = 6; 
  const USDC_E_DECIMALS = 6;
  const ENTRY_FEE = 0.25;

  const notify = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const handleTopUp = async (amount: number, targetType: string, targetAddr: string, tokenAddress: string = USDC_ADDRESS) => {
    if (!userInfo?.uuid || isProcessing) return;
    
    setIsProcessing(true);
    let txHash = '';
    const tokenSymbol = tokenAddress.toLowerCase() === USDC_E_ADDRESS.toLowerCase() ? 'USDC.e' : 'USDC';
    try {
      notify(`Initiating deposit of ${amount.toFixed(2)} ${tokenSymbol} from ${targetType}...`, 'info');

      if (!provider) throw new Error('No wallet provider found');

      const currentActiveAddr = await smartAccountRef.current?.getAddress();
      
      // Determine if we need a different Smart Account instance (e.g. V1 instead of V2)
      const isSA = targetType?.toLowerCase().includes('biconomy') || targetType?.toLowerCase().includes('simple');
      
      let saInstance = smartAccountRef.current;
      let activeAddress = currentActiveAddr;

        if (isSA && (!currentActiveAddr || targetAddr?.toLowerCase() !== currentActiveAddr.toLowerCase())) {
          notify(`Switching to ${targetType} node...`, 'info');
          const targetVersion = targetType.toLowerCase().includes('v1') ? '1.0.0' : '2.0.0';
          const targetName = targetType.toLowerCase().includes('biconomy') ? 'BICONOMY' : 'SIMPLE';
          
          const forcedProvider = new Proxy(provider as any, {
            get(target, prop) {
              if (prop === 'request') {
                return async (args: any) => {
                  if (args?.method === 'eth_chainId') return '0xa4b1';
                  return target.request(args);
                };
              }
              return (target as any)[prop];
            }
          });

          saInstance = new SmartAccount(forcedProvider as any, {
            projectId: import.meta.env.VITE_PARTICLE_PROJECT_ID,
            clientKey: import.meta.env.VITE_PARTICLE_CLIENT_KEY,
            appId: import.meta.env.VITE_PARTICLE_APP_ID,
            chainId: 42161,
            aaOptions: {
              accountContracts: {
                [targetName]: [{ version: targetVersion, chainIds: [42161] }]
              }
            }
          });
          activeAddress = await saInstance.getAddress();
          console.log(`[TopUp] Initialized temporary ${targetType} instance at ${activeAddress}`);
        }

        const isSmartAccount = !!saInstance && activeAddress && targetAddr?.toLowerCase() === activeAddress.toLowerCase();

        if (isSmartAccount && saInstance) {
          notify(`Analyzing gas logistics...`, 'info');
          const usdcInterface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
          
          const browserProvider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
          const tokenContract = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], browserProvider);
          const rawBal = await tokenContract.balanceOf(activeAddress);
          const actualTransferBal = Number(ethers.formatUnits(rawBal, 6));

          // Get Fee Quotes safely
          const probeTx = { 
            to: tokenAddress, 
            data: usdcInterface.encodeFunctionData("transfer", [PRIMARY_WALLET, ethers.parseUnits("0.000001", 6)]), 
            value: '0x0' 
          };
          const feeQuotes = await saInstance.getFeeQuotes(probeTx);

          const finalTx = { to: tokenAddress, data: '', value: '0x0' };

          if (feeQuotes.verifyingPaymasterGasless) {
            notify('Sponsoring gas fees...', 'info');
            let finalAmount = Math.floor(Math.min(amount, actualTransferBal) * 1000000) / 1000000;
            finalTx.data = usdcInterface.encodeFunctionData("transfer", [PRIMARY_WALLET, ethers.parseUnits(finalAmount.toFixed(6), 6)]);
            
            const userOpHash = await saInstance.sendTransaction({
              tx: finalTx,
              feeQuote: feeQuotes.verifyingPaymasterGasless.feeQuote,
            } as any);
            
            notify('Bundling transaction...', 'info');
            let receipt = null;
            let pollingAttempts = 0;
            while (!receipt && pollingAttempts < 30) {
              try {
                console.log(`[TopUp] Polling for UserOp receipt: ${userOpHash}`);
                receipt = await (provider as any).request({ method: 'eth_getUserOperationReceipt', params: [userOpHash] });
                if (receipt?.transactionHash) {
                  txHash = receipt.transactionHash;
                  console.log(`[TopUp] Found Transaction Hash: ${txHash}`);
                  notify('UserOp bundled! Syncing with blockchain...', 'info');
                } else {
                  pollingAttempts++;
                  if (pollingAttempts % 5 === 0) notify(`Bundling transaction... (${pollingAttempts}/30)`, 'info');
                  await new Promise(r => setTimeout(r, 2000));
                }
              } catch (e) {
                console.warn('[TopUp] Receipt poll error:', e);
                await new Promise(r => setTimeout(r, 2000));
              }
            }

            if (!txHash) throw new Error('Timed out waiting for transaction hash. Please check your wallet history.');
          } else if (feeQuotes.tokenPaymaster?.feeQuotes?.length) {
            const quotes = feeQuotes.tokenPaymaster.feeQuotes;
            const balanceChecks = await Promise.all(quotes.map(async (q: any) => {
              const contract = new ethers.Contract(q.tokenInfo.address, ["function balanceOf(address) view returns (uint256)"], browserProvider);
              const bal = await contract.balanceOf(activeAddress);
              return { quote: q, balance: Number(ethers.formatUnits(bal, q.tokenInfo.decimals)) };
            }));

            const bestQuoteObj = balanceChecks.find(b => 
              b.quote.tokenInfo.address.toLowerCase() === tokenAddress.toLowerCase() && 
              b.balance > (Number(b.quote.fee) / 10**b.quote.tokenInfo.decimals)
            ) || balanceChecks.find(b => b.balance >= (Number(b.quote.fee) / 10**b.quote.tokenInfo.decimals));

            if (!bestQuoteObj) throw new Error(`Insufficient funds for gas. Need ~$0.02 in any USDC or ETH.`);

            const selectedQuote = bestQuoteObj.quote;
            const feeAmount = Number(selectedQuote.fee) / 10 ** selectedQuote.tokenInfo.decimals;
            const isSameToken = selectedQuote.tokenInfo.address.toLowerCase() === tokenAddress.toLowerCase();

            let finalAmount = amount;
            if (isSameToken) {
              const maxSafe = Math.floor((actualTransferBal - feeAmount - 0.01) * 1000000) / 1000000;
              finalAmount = Math.min(amount, maxSafe);
            } else {
              finalAmount = Math.floor(Math.min(amount, actualTransferBal) * 1000000) / 1000000;
            }

            if (finalAmount <= 0) throw new Error(`Insufficient ${tokenSymbol}: Balance $${actualTransferBal.toFixed(4)}, Gas Fee $${feeAmount.toFixed(4)}`);

            finalTx.data = usdcInterface.encodeFunctionData("transfer", [PRIMARY_WALLET, ethers.parseUnits(finalAmount.toFixed(6), 6)]);
            notify(`Paying gas with ${selectedQuote.tokenInfo.symbol}...`, 'info');
            const userOpHash = await saInstance.sendTransaction({
              tx: finalTx,
              feeQuote: selectedQuote,
              tokenPaymasterAddress: feeQuotes.tokenPaymaster.tokenPaymasterAddress,
            } as any);

            notify('Bundling transaction...', 'info');
            let receipt = null;
            let pollingAttempts = 0;
            while (!receipt && pollingAttempts < 45) {
              try {
                console.log(`[TopUp] Polling for UserOp receipt: ${userOpHash}`);
                receipt = await (provider as any).request({ method: 'eth_getUserOperationReceipt', params: [userOpHash] });
                if (receipt?.transactionHash) {
                  txHash = receipt.transactionHash;
                  console.log(`[TopUp] Found Transaction Hash: ${txHash}`);
                  notify('UserOp bundled! Syncing with blockchain...', 'info');
                } else {
                  pollingAttempts++;
                  if (pollingAttempts % 5 === 0) notify(`Bundling transaction... (${pollingAttempts}/45)`, 'info');
                  await new Promise(r => setTimeout(r, 2000));
                }
              } catch (e) {
                console.warn('[TopUp] Receipt poll error:', e);
                await new Promise(r => setTimeout(r, 2000));
              }
            }

            if (!txHash) {
              console.log('[TopUp] Bundling timed out, but transaction might still confirm. Attempting to use UserOpHash as fallback.');
              txHash = userOpHash; // Fallback to UserOpHash if we can't get TxHash - backend will try to resolve it
            }
          } else {
            let finalAmount = Math.floor(Math.min(amount, actualTransferBal) * 1000000) / 1000000;
            finalTx.data = usdcInterface.encodeFunctionData("transfer", [PRIMARY_WALLET, ethers.parseUnits(finalAmount.toFixed(6), 6)]);
            const userOpHash = await saInstance.sendTransaction({ tx: finalTx } as any);
            
            notify('Bundling transaction...', 'info');
            let receipt = null;
            let pollingAttempts = 0;
            while (!receipt && pollingAttempts < 45) {
              try {
                console.log(`[TopUp] Polling for UserOp receipt: ${userOpHash}`);
                receipt = await (provider as any).request({ method: 'eth_getUserOperationReceipt', params: [userOpHash] });
                if (receipt?.transactionHash) {
                  txHash = receipt.transactionHash;
                  console.log(`[TopUp] Found Transaction Hash: ${txHash}`);
                  notify('UserOp bundled! Syncing with blockchain...', 'info');
                } else {
                  pollingAttempts++;
                  if (pollingAttempts % 5 === 0) notify(`Bundling transaction... (${pollingAttempts}/45)`, 'info');
                  await new Promise(r => setTimeout(r, 2000));
                }
              } catch (e) {
                console.warn('[TopUp] Receipt poll error:', e);
                await new Promise(r => setTimeout(r, 2000));
              }
            }

            if (!txHash) {
              console.log('[TopUp] Bundling timed out, but transaction might still confirm. Attempting to use UserOpHash as fallback.');
              txHash = userOpHash;
            }
          }
        } else {
        const browserProvider = new ethers.BrowserProvider(provider as any);
        const signer = await browserProvider.getSigner();
        const usdcContract = new ethers.Contract(tokenAddress, [
          "function transfer(address to, uint256 amount) returns (bool)",
          "function balanceOf(address) view returns (uint256)"
        ], signer);
        
        const rawBalance = await usdcContract.balanceOf(targetAddr);
        const actualBalance = Number(ethers.formatUnits(rawBalance, 6));
        
        let finalAmount = amount;
        if (finalAmount > actualBalance) {
          finalAmount = actualBalance;
          notify(`Adjusting to max available balance: $${finalAmount.toFixed(2)}`, 'info');
        }

        if (finalAmount <= 0) throw new Error(`Insufficient ${tokenSymbol} balance`);

        notify(`Requesting signature for $${finalAmount.toFixed(2)}...`, 'info');
        try {
          const tx = await usdcContract.transfer(PRIMARY_WALLET, ethers.parseUnits(finalAmount.toFixed(6), 6));
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) throw new Error('Transaction failed');
          txHash = tx.hash;
        } catch (txErr: any) {
          if (txErr.message?.toLowerCase().includes('estimategas') || txErr.code === 'INSUFFICIENT_FUNDS') {
            throw new Error(`Gas estimation failed. This standard wallet requires ETH to pay for gas. Please use a Smart Account for a gassless experience.`);
          }
        }
      }

      if (txHash) {
        setSyncingTxHash(txHash);
        notify('Transaction sent! Finalizing deposit...', 'info');
        
        let attempts = 0;
        const pollDeposit = async () => {
          try {
            const { data: { session: authSession } } = await supabase.auth.getSession();
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
              },
              body: JSON.stringify({ action: 'DEPOSIT', payload: { userId: userInfo.uuid, txHash } })
            });

            const result = await res.json();
            if (result.success) {
              const addedAmount = Number(result.added || 0);
              notify(`Success! Added $${addedAmount.toFixed(2)} to your balance.`, 'success');
              setBalance(result.newBalance);
              setSyncingTxHash(null);
              setIsProcessing(false);
              fetchUserData();
              return true; // Stop polling
            } else if (res.status === 400 && (result.error?.toLowerCase().includes('not detected yet') || result.error?.toLowerCase().includes('timeout') || result.error?.toLowerCase().includes('null'))) {
              attempts++;
              if (attempts % 2 === 0) notify(`Synchronizing credit buffer... (${attempts}/${MAX_POLL_ATTEMPTS})`, 'info');
              return false; // Continue polling
            } else {
              throw new Error(result.error || 'Failed to award credits');
            }
          } catch (err: any) {
            console.log('[Sync] Wait condition:', err.message);
            return false;
          }
        };

        // Start polling with a hard limit
        const MAX_POLL_ATTEMPTS = 60; // 5 minutes total
        const interval = setInterval(async () => {
          if (attempts >= MAX_POLL_ATTEMPTS) {
             clearInterval(interval);
             setIsProcessing(false);
             setSyncingTxHash(null);
             notify("Blockchain sync is slow. Your credits will appear automatically once confirmed. You can also click SYNC later.", "warning");
             return;
          }
          const finished = await pollDeposit();
          if (finished) {
            clearInterval(interval);
            setIsProcessing(false);
          }
        }, 5000);

        // Also check once immediately
        pollDeposit();
      }
    } catch (err: any) {
      console.error('Topup failed:', err);
      notify(err.message || 'Top-up failed', 'error');
      setIsProcessing(false);
    }
  };

  const handleGlobalSync = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      notify('Synchronizing node status...', 'info');
      await fetchUserData();
      
      // If there's a pending TX hash we were tracking, try to verify it one last time
      if (syncingTxHash) {
        notify('Checking pending deposit...', 'info');
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ action: 'DEPOSIT', payload: { userId: userInfo?.uuid, txHash: syncingTxHash } })
        });
        const result = await res.json();
        if (result.success) {
          const addedAmt = Number(result.added || 0);
          notify(`Deposit verified! $${addedAmt.toFixed(2)} added.`, 'success');
          setBalance(result.newBalance);
          setSyncingTxHash(null);
        }
      }
      notify('Node synchronized.', 'success');
    } catch (err) {
      console.error('Global sync error:', err);
    } finally {
      setIsProcessing(false);
    }
  };



  const isAdmin = useMemo(() => {
    const email = userInfo?.email?.toLowerCase() || '';
    const addr = userAddress?.toLowerCase() || '';
    const treasury = PRIMARY_WALLET.toLowerCase();
    
    return (
      email === 'ptnmgmt@gmail.com' || 
      email === 'nicolastheato@gmail.com' ||
      addr === treasury ||
      (userInfo as any)?.public_address?.toLowerCase() === treasury
    );
  }, [userInfo, userAddress, PRIMARY_WALLET]);
  
  const handleLogout = async () => {
    try {
      setIsProcessing(true);
      await disconnect();
      if (logout) await logout();
      await supabase.auth.signOut();
      
      // Reset all user-related state
      setUserAddress('');
      setBalance(0);
      setHighScore(0);
      setTotalInjected(0);
      setTotalSessions(0);
      setUserProfile(null);
      setTreasuryBalance(0);
      setEmailInput('');
      setCurrentPage('HOME');
      
      notify('Session terminated successfully', 'success');
    } catch (err) {
      console.error('Logout error:', err);
      notify('Failed to clear session fully', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const [treasuryBalance, setTreasuryBalance] = useState<number>(0);
  const [treasuryEthBalance, setTreasuryEthBalance] = useState<number>(0);

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

  const fetchUserData = useCallback(async (forcedAddressInput?: string | any, retryCount = 0, aaExtras?: { biconomyAddress?: string, simpleAddress?: string }) => {
    if (!userInfo?.uuid) return;
    
    // Ensure forcedAddress is a string (prevents event objects from leaking in)
    const forcedAddress = typeof forcedAddressInput === 'string' ? forcedAddressInput : undefined;
    
    try {
      setIsProcessing(true);
      
      // Only retry if an EVM wallet is null (Solana is often null if not used)
      const hasNullEVMWallet = userInfo.wallets?.some((w: any) => 
        (w.chain_name?.toLowerCase().includes('evm') || !w.chain_name) && !w.public_address
      );
      if (hasNullEVMWallet && retryCount < 5) {
        console.log(`[Diagnostic] Null EVM wallet address detected. Retrying fetch in 1.5s... (${retryCount + 1}/5)`);
        setTimeout(() => fetchUserData(forcedAddress, retryCount + 1), 1500);
        return;
      }
      
      const getBalance = async (targetAddr: any) => {
        if (!targetAddr || typeof targetAddr !== 'string' || targetAddr === 'null' || targetAddr === 'undefined') {
          return 0;
        }

        // Only process EVM addresses
        if (!targetAddr.startsWith('0x') || targetAddr.length !== 42) {
          return 0;
        }
        
        const callData = '0x70a08231' + targetAddr.replace('0x', '').padStart(64, '0');
        
        const fetchCall = async (contract: string) => {
          try {
            // Use public RPC for more reliable read-only calls
            const response = await fetch('https://arb1.arbitrum.io/rpc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: Math.floor(Math.random() * 1000000),
                method: 'eth_call',
                params: [{ to: contract, data: callData }, 'latest']
              })
            });
            const result = await response.json();
            if (result?.error) {
              console.warn(`[RPC Warning] Balance check error for ${contract}:`, result.error);
            }
            return result?.result || null;
          } catch (e) {
            console.error(`[RPC Error] Network failure for ${contract}:`, e);
            return null;
          }
        };

        const [resUSDC, resUSDCe] = await Promise.all([
          fetchCall(USDC_ADDRESS),
          fetchCall(USDC_E_ADDRESS)
        ]);

        if (resUSDC === null && resUSDCe === null) return null;

        let nativeBal = 0;
        let bridgedBal = 0;

        if (resUSDC && resUSDC !== '0x' && resUSDC.length > 2) {
          nativeBal = Number(BigInt(resUSDC)) / Math.pow(10, USDC_DECIMALS);
        }
        if (resUSDCe && resUSDCe !== '0x' && resUSDCe.length > 2) {
          bridgedBal = Number(BigInt(resUSDCe)) / Math.pow(10, USDC_E_DECIMALS);
        }

        const total = (nativeBal || 0) + (bridgedBal || 0);
        return { nativeBal, bridgedBal, total };
      };

      const scanSet = new Set<string>();
      const addAddr = (a: any) => {
        if (a && typeof a === 'string' && a.length > 20 && a !== 'null' && a !== 'undefined') {
          scanSet.add(a.toLowerCase());
        }
      };

      if (PRIMARY_WALLET) addAddr(PRIMARY_WALLET);
      if (forcedAddress) addAddr(forcedAddress);
      if (userAddress) addAddr(userAddress);
      if (ethAddress) addAddr(ethAddress);
      
      if (aaExtras?.biconomyAddress) addAddr(aaExtras.biconomyAddress);
      if (aaExtras?.simpleAddress) addAddr(aaExtras.simpleAddress);
      if ((userInfo as any).biconomyV1Address) addAddr((userInfo as any).biconomyV1Address);
      if ((userInfo as any).simpleV2Address) addAddr((userInfo as any).simpleV2Address);

      // Add all wallets from Particle
      const pWallets = userInfo.wallets || [];
      pWallets.forEach((w: any) => addAddr(w.public_address));

      // Check provider accounts
      if (provider) {
        try {
          const pAccounts = await (provider as any).request({ method: 'eth_accounts' });
          if (Array.isArray(pAccounts)) pAccounts.forEach(addAddr);
          
          try {
            const aaAccount = await (provider as any).request({ method: 'particle_aa_getSmartAccount' });
            if (Array.isArray(aaAccount)) {
              aaAccount.forEach((a: any) => addAddr(a?.smartAccountAddress));
            } else if (typeof aaAccount === 'string') {
              addAddr(aaAccount);
            }
          } catch (aaErr) {}
        } catch (e) {}
      }

      console.log(`[Diagnostic] Scanning ${scanSet.size} unique addresses:`, Array.from(scanSet));
      
      let totalWalletBalance = 0;
      let hasError = false;
      const newDetected: {addr: string, bal: number, type: string}[] = [];
      const processedAddrs = new Set<string>();
      
      for (const addr of scanSet) {
        if (processedAddrs.has(addr)) continue;
        processedAddrs.add(addr);

        const balData = await getBalance(addr);
        if (balData === null) {
          hasError = true;
          continue;
        }
        
        const bal = balData.total;
        let type = 'EOA/External';
        const isTreasury = addr.toLowerCase() === PRIMARY_WALLET.toLowerCase();

        if (isTreasury) {
          type = 'House Treasury';
          setTreasuryBalance(bal);
        }
        else if (aaExtras?.biconomyAddress?.toLowerCase() === addr) type = 'Biconomy V2';
        else if ((userInfo as any).biconomyV1Address?.toLowerCase() === addr) type = 'Biconomy V1';
        else if (aaExtras?.simpleAddress?.toLowerCase() === addr) type = 'Simple AA V1';
        else if ((userInfo as any).simpleV2Address?.toLowerCase() === addr) type = 'Simple AA V2';
        else if (userInfo.wallets?.some((w: any) => w.public_address?.toLowerCase() === addr)) type = 'Linked Particle';
        
        console.log(`[Diagnostic] Scanned ${addr}: Bal=${bal} (Native=${balData.nativeBal}, Bridged=${balData.bridgedBal}) Type=${type}`);
        
        if (!isTreasury && bal > 0) {
          totalWalletBalance += bal;
        }
        
        newDetected.push({ 
          address: addr, 
          bal, 
          type, 
          nativeBal: balData.nativeBal, 
          bridgedBal: balData.bridgedBal 
        });
      }

      // Update the UI state with detected wallets
      setDetectedAddresses(newDetected);

      // Find the best wallet for quick top-up (Prioritize GASSLESS Smart Accounts)
      const allOptions: any[] = [];
      newDetected.forEach(d => {
        if (d.type === 'House Treasury') return;
        const isSA = d.type.toLowerCase().includes('biconomy') || d.type.toLowerCase().includes('simple');
        const priority = isSA ? 1000 : 1; // Heavy priority for SA
        
        if (d.nativeBal > 0) allOptions.push({ addr: d.address, bal: d.nativeBal, type: d.type, token: USDC_ADDRESS, priority });
        if (d.bridgedBal > 0) allOptions.push({ addr: d.address, bal: d.bridgedBal, type: d.type, token: USDC_E_ADDRESS, priority });
      });
      
      // Sort by priority first, then balance
      const best = allOptions.sort((a, b) => (b.priority + b.bal) - (a.priority + a.bal))[0];
      setBestWallet(best || null);

      console.log(`[Diagnostic] Total Aggregate Wallet Balance: ${totalWalletBalance}`);
      setTotalWalletBalance(totalWalletBalance);
      
      // --- LIVE SYNC ARCHITECTURE ---
      const { data: profiles, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userInfo.uuid);

      if (pError) throw pError;
      const data = profiles?.[0];
      
      // --- CREDIT-ONLY ARCHITECTURE ---
      // The database balance is now the absolute source of truth for "In-Game Credits".
      // We no longer auto-merge wallet funds. Users must explicitly "Top Up".
      let finalBalance = data?.balance || 0;
      let finalInjected = data?.total_injected || 0;
      let finalWithdrawn = data?.total_withdrawn || 0;

      // Handle new users: start at 0 credits
      if (!data) {
        finalBalance = 0;
        finalInjected = 0;
      }

      // Strictly prioritize Biconomy Smart Accounts (V2 > V1) for the Operator Node
      const biconomyAddr = (aaExtras?.biconomyAddress || (userInfo as any).biconomyV2Address || (userInfo as any).biconomyV1Address || '').toLowerCase();
      const otherSmartAddr = aaExtras?.simpleAddress || (userInfo as any).simpleV2Address;
      
      const primaryAddr = biconomyAddr || otherSmartAddr || forcedAddress || userAddress || (userInfo as any).public_address;
      
      // If we have a Biconomy address, it MUST be the primary Operator Node
      if (biconomyAddr && biconomyAddr.length > 20) {
        if (userAddress.toLowerCase() !== biconomyAddr) {
          console.log('[Diagnostic] Forcing primary Biconomy node:', biconomyAddr);
          setUserAddress(biconomyAddr);
        }
      }

      if (data) {
        // Update profile but preserve the credit balance as is
        const { error: syncError } = await supabase
          .from('profiles')
          .update({
            // balance is NOT updated from totalWalletBalance anymore
            last_wallet_balance: totalWalletBalance, 
            email: userInfo.email || data.email,
            name: data.name || userInfo.name || ('Operator ' + userInfo.uuid.slice(0, 4)),
            wallet_address: primaryAddr || data.wallet_address
          })
          .eq('id', userInfo.uuid);

        if (!syncError) {
          setBalance(finalBalance);
          setTotalSessions(data.total_sessions || 0);
          setTotalInjected(finalInjected);
          setTotalWithdrawn(finalWithdrawn);
          setUserProfile({ ...data, balance: finalBalance });
        }
      } else {
        // Create new profile with 0 credits
        const { data: newData, error: insertError } = await supabase
          .from('profiles')
          .insert([{ 
            id: userInfo.uuid, 
            email: userInfo.email,
            name: userInfo.name || 'Operator ' + userInfo.uuid.slice(0, 4),
            balance: 0,
            last_wallet_balance: totalWalletBalance,
            high_score: 0,
            total_injected: 0,
            total_sessions: 0,
            wallet_address: primaryAddr
          }])
          .select()
          .single();
        
        if (newData) {
          setBalance(newData.balance);
          setTotalInjected(newData.total_injected);
          setTotalSessions(0);
          setUserProfile(newData);
        }
        if (insertError) console.error('Error creating profile:', insertError);
      }

      // Fetch treasury balance if admin
      if (isAdmin) {
        const tBal = await getBalance(PRIMARY_WALLET);
        if (tBal !== null) setTreasuryBalance(tBal.total);
        
        try {
          const ethRes = await (provider as any || fetch).request?.({
            method: 'eth_getBalance',
            params: [PRIMARY_WALLET, 'latest']
          }) || await (async () => {
             const r = await fetch('https://arb1.arbitrum.io/rpc', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [PRIMARY_WALLET, 'latest'] })
             });
             const j = await r.json();
             return j.result;
          })();
          if (ethRes) setTreasuryEthBalance(Number(BigInt(ethRes)) / 1e18);
        } catch (e) { console.warn('Failed to fetch treasury ETH:', e); }
      }
    } catch (err: any) {
      console.error('Fetch user data error:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [userInfo?.uuid, userAddress, provider, ethAddress]);

  // Consolidated Address Discovery & Sync Logic
  useEffect(() => {
    if (connectionStatus !== 'connected' || !userInfo?.uuid) return;
    
    const initializeUserNode = async () => {
      let biconomyAddress = '';
      let simpleAddress = '';
      
      if (provider) {
        try {
          const initSA = async (type: string, version: string = '2.0.0') => {
            try {
              const sa = new SmartAccount(provider, {
                projectId: import.meta.env.VITE_PARTICLE_PROJECT_ID,
                clientKey: import.meta.env.VITE_PARTICLE_CLIENT_KEY,
                appId: import.meta.env.VITE_PARTICLE_APP_ID,
                aaOptions: {
                  accountContracts: {
                    [type]: [{ version, chainIds: [ArbitrumOne.id] }]
                  }
                }
              });
              const address = await sa.getAddress();
              console.log(`[Diagnostic] Discovered ${type} ${version}:`, address);
              return address;
            } catch (e) {
              console.warn(`[Diagnostic] Failed to init ${type} ${version}:`, e);
              return '';
            }
          };
          
          biconomyAddress = await initSA('BICONOMY', '2.0.0');
          const biconomyV1 = await initSA('BICONOMY', '1.0.0');
          simpleAddress = await initSA('SIMPLE', '1.0.0');
          const simpleV2 = await initSA('SIMPLE', '2.0.0');

          // Store for metadata
          if (biconomyAddress) (userInfo as any).biconomyV2Address = biconomyAddress;
          if (biconomyV1) (userInfo as any).biconomyV1Address = biconomyV1;
          if (simpleAddress) (userInfo as any).simpleV1Address = simpleAddress;
          if (simpleV2) (userInfo as any).simpleV2Address = simpleV2;
          
        } catch (aaInitErr) {
          console.warn('[Diagnostic] AA SDK overall initialization failed:', aaInitErr);
        }
      }
      
      // Strict Priority: Biconomy V2 -> Biconomy V1
      const finalAddress = (biconomyAddress || (userInfo as any).biconomyV1Address || '').toLowerCase();
      
      console.log('[Diagnostic] Final Biconomy Node Selected:', finalAddress);
      
      if (finalAddress && finalAddress.length > 20) {
        setUserAddress(finalAddress);
        fetchUserData(finalAddress, 0, { biconomyAddress: biconomyAddress, simpleAddress: simpleAddress });
      } else if (!userProfile && userInfo?.uuid) {
        fetchUserData();
      }
    };

    initializeUserNode();
  }, [connectionStatus, userInfo?.uuid, provider, ethAddress]);


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


  const startGame = async () => {
     if (selectedGame === 'SLITHER') {
        if (!isTestMode && balance < 0.25) {
          setConfirmModal({
            show: true,
            title: 'Insufficient Credits',
            message: '$0.25 Entry Fee required. Please top up your balance to continue.',
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
              'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
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
          setCurrentSessionLoot(0);
          setCurrentPage('PLAYING');
          if (!isTestMode) notify('Session Started: -$0.25', 'info');
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
    
    // Detailed Breakdown Math based on PNL
    const netPnl = Math.max(0, collectedMoney - 0.25);
    const penaltyAmount = netPnl * 0.50; // User loses 50% of gain
    const dropAmount = netPnl * 0.40;    // 40% of gain is dropped
    const houseRake = netPnl * 0.05;     // 5% of gain is fee
    const foodRefill = netPnl * 0.05;    // 5% of gain goes back to food

    setGameOverResult({
      score: roundedScore,
      collected: collectedMoney,
      penalty: penaltyAmount,
      rake: houseRake
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
    setCurrentSessionLoot(prev => prev + amount);
    
    // If it's a major persistent drop (has dropId), send immediately
    if (dropId) {
        try {
          const { data: { session: authSession } } = await supabase.auth.getSession();
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
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
                  'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ 
                  action: 'COLLECT', 
                  payload: { amount: flushAmount, userId: userInfo?.uuid || userProfile?.id } 
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

  const pnl = (balance + totalWithdrawn) - totalInjected;
  const isProfitable = pnl >= 0;

  if (connectionStatus !== 'connected') {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-slate-950 text-slate-50 font-sans select-none flex flex-col items-center justify-center p-0 md:p-6">
        <div className="absolute inset-0 z-0 opacity-20"
             style={{
               backgroundImage: 'radial-gradient(circle at 50% 50%, #38bdf8 0%, transparent 50%)',
               filter: 'blur(100px)'
             }}></div>
        
        <div className="w-full h-full md:h-auto md:max-w-md text-center space-y-8 p-8 md:p-12 relative overflow-hidden bg-slate-900/40 backdrop-blur-2xl md:rounded-3xl shadow-2xl flex flex-col justify-center">
          <div className="relative z-10">
            <h2 className="text-5xl md:text-6xl font-black italic tracking-tighter text-white mb-2 leading-none uppercase">System<br/>Access</h2>
            <p className="text-sky-400 font-mono text-sm uppercase tracking-[0.3em]">Secure Web3 Identity</p>
          </div>
          
          <div className="relative z-10 w-full mt-8 space-y-4 font-mono max-w-sm mx-auto">
            {connectionStatus === 'loading' ? (
               <div className="py-12 flex flex-col items-center justify-center gap-4">
                  <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                  <span className="text-[10px] text-sky-500 animate-pulse">AUTHORIZING NODE...</span>
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
                    className="w-full bg-slate-950/50 p-5 pl-12 text-sm text-white focus:outline-none transition-all rounded-2xl"
                  />
                </div>
                
                <button 
                  disabled={isProcessing}
                  onClick={() => connect({ email: emailInput })}
                  className="w-full py-5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-sm uppercase transition-all rounded-2xl shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-50"
                >
                  {isProcessing ? 'Authorizing...' : 'Authenticate Wallet'}
                </button>

                <div className="flex items-center gap-4 text-slate-500 text-[10px] uppercase py-2 font-black tracking-widest">
                  <div className="flex-1 h-[1px] bg-slate-800"></div>
                  <span>OR</span>
                  <div className="flex-1 h-[1px] bg-slate-800"></div>
                </div>

                <button 
                  onClick={() => connect({ socialType: 'google' })}
                  className="w-full py-5 bg-slate-800/50 hover:bg-slate-800 text-white font-black text-sm uppercase transition-all rounded-2xl flex items-center justify-center gap-3"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="G" />
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
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-sky-500/30 overflow-x-hidden">
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-sky-500/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-pulse delay-700"></div>
      </div>

      {/* Premium Top Navigation */}
      <header className="sticky top-0 z-[160] premium-glass px-6 md:px-12 py-5 flex items-center justify-between border-none">
        <div className="flex items-center gap-10">
          <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setCurrentPage('HOME')}>
            <div className="w-12 h-12 bg-sky-500 rounded-2xl flex items-center justify-center shadow-lg shadow-sky-500/20 group-hover:rotate-12 transition-all duration-500">
              <Zap className="text-slate-950 w-6 h-6 fill-current" />
            </div>
            <h1 className="text-2xl md:text-3xl font-black italic tracking-tighter premium-gradient-text uppercase">Slider</h1>
          </div>


        </div>

        <div className="flex items-center gap-2 md:gap-4">
           {userAddress ? (
             <div className="flex items-center gap-2 md:gap-4">
                {/* Header Balance */}
                <div className="hidden lg:block premium-glass px-4 py-2 rounded-2xl border-none">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Balance</span>
                    <span className="text-sm font-black text-white italic">${Number(userProfile?.balance || 0).toFixed(2)}</span>
                    <button 
                      onClick={fetchUserData}
                      disabled={isProcessing}
                      className="p-1 hover:bg-sky-500/10 text-sky-400 rounded transition-all disabled:opacity-30 group"
                      title="Sync Node"
                    >
                      <RefreshCw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    </button>
                  </div>
                </div>

                <button 
                  onClick={handleLogout}
                  className="w-12 h-12 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-2xl flex items-center justify-center transition-all active:scale-90 border-none shadow-xl group"
                  title="Sign Out"
                >
                  <User className="w-5 h-5 group-hover:hidden" />
                  <LogOut className="w-5 h-5 hidden group-hover:block" />
                </button>
             </div>
           ) : (
             <button 
               onClick={() => connect()}
               disabled={isProcessing}
               className="px-6 md:px-8 py-3 md:py-4 bg-sky-500 text-slate-950 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-sky-400 transition-all shadow-lg shadow-sky-500/20 active:scale-95 border-none"
             >
               Authorize Node
             </button>
           )}
        </div>
      </header>

      {/* Main Content Area - Full Width Optimization */}
      <main className="flex-1 relative z-10 w-full max-w-[1500px] mx-auto p-4 md:p-12 lg:p-16 space-y-12 pb-32 md:pb-16">
        {currentPage === 'HOME' && (
          <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Profile & Identity Section */}
            {/* Profile & Identity Section - Optimized for Mobile */}
            <div className="relative group premium-glass rounded-[2rem] md:rounded-[3rem] overflow-hidden border-none shadow-2xl">
               <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-transparent"></div>
               <div className="relative flex flex-col md:flex-row items-center md:items-center justify-between gap-8 p-6 md:p-10">
                  {/* Identity Block */}
                  <div className="flex items-center gap-4 md:gap-8 w-full md:w-auto">
                     <div className="relative flex-shrink-0">
                        <div className="w-14 h-14 md:w-24 md:h-24 bg-sky-500 rounded-2xl md:rounded-[2rem] flex items-center justify-center shadow-2xl shadow-sky-500/30">
                           <User className="w-7 h-7 md:w-12 md:h-12 text-slate-950" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 md:w-6 md:h-6 bg-emerald-500 rounded-full border-[3px] border-slate-950 animate-pulse"></div>
                     </div>
                     <div className="space-y-1 min-w-0">
                        <h3 className="text-lg md:text-3xl font-black text-white uppercase italic tracking-tighter premium-gradient-text truncate">
                           {userProfile?.name || userInfo?.name || (userInfo?.email ? userInfo.email.split('@')[0] : 'Anonymous Operator')}
                        </h3>
                        <p className="text-sky-400/80 font-mono text-[9px] md:text-sm uppercase tracking-widest font-black truncate opacity-80">
                           {userProfile?.email || userInfo?.email || (userAddress ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : 'unlinked@system.node')}
                        </p>
                     </div>
                  </div>
                  
                  {/* Action Grid - Contained and non-scrollable on mobile */}
                  <div className="grid grid-cols-2 md:flex w-full md:w-auto gap-3 md:gap-4">
                     <button onClick={handleGlobalSync} className="flex items-center justify-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-slate-800/60 hover:bg-slate-700 text-sky-400 rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all active:scale-95 shadow-xl border-none">
                        <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                        <span>SYNC</span>
                     </button>
                     <button onClick={() => setIsWalletOpen(true)} className="flex items-center justify-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-sky-500/20 border-none">
                        <Wallet className="w-3.5 h-3.5" />
                        <span>WALLET</span>
                     </button>
                     <button onClick={handleLogout} className="flex items-center justify-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all active:scale-95 border-none">
                        <LogOut className="w-3.5 h-3.5" />
                        <span>EXIT</span>
                     </button>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 gap-8 mb-12">
              {/* Admin Treasury Dashboard - Check email OR specific admin wallet */}
              {isAdmin && (
                <div className="p-6 md:p-12 bg-gradient-to-br from-purple-900/40 via-slate-900/60 to-slate-950/80 rounded-[2.5rem] md:rounded-[4rem] backdrop-blur-3xl shadow-2xl relative overflow-hidden group border-none">
                  <div className="absolute -top-24 -right-24 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] group-hover:bg-purple-500/20 transition-all duration-1000" />
                  
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12 relative z-10">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <div className="bg-purple-500 p-2 rounded-xl shadow-lg shadow-purple-500/20">
                          <Crown className="text-white w-5 h-5 md:w-6 md:h-6" />
                        </div>
                        <h3 className="text-xl md:text-3xl font-black text-white tracking-tighter uppercase italic premium-gradient-text">House Treasury</h3>
                      </div>
                      <p className="text-[10px] md:text-xs text-purple-400 font-black uppercase tracking-[0.3em] opacity-60">Global Economic Controller • Arbitrum One</p>
                    </div>
                    <div className="flex items-center gap-4 bg-purple-500/10 px-5 py-3 rounded-2xl backdrop-blur-md border-none">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(74,222,128,0.5)]" />
                      <span className="text-[10px] font-black text-purple-200 uppercase tracking-[0.2em]">System: Operational</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-10 relative z-10">
                    <div className="space-y-4">
                      <span className="text-[11px] font-black text-purple-400/60 uppercase tracking-[0.4em]">Vault Liquidity</span>
                      <div className="text-4xl md:text-8xl font-black text-white tracking-tighter italic flex items-baseline gap-3 md:gap-5">
                        ${Number(treasuryBalance || 0).toFixed(2)}
                        <span className="text-lg md:text-3xl not-italic font-bold text-slate-500 tracking-normal uppercase">USDC</span>
                      </div>
                      <p className="text-xs md:text-sm text-slate-400 font-medium max-w-sm leading-relaxed">Active liquidity buffer for real-time player payouts and automated orb distribution protocols.</p>
                    </div>
                    
                    <div className="bg-white/5 rounded-[2.5rem] p-6 md:p-10 hover:bg-white/10 transition-all flex flex-col lg:flex-row items-center gap-8 group/card border-none">
                       <div className="bg-white p-4 rounded-[2rem] shadow-2xl shadow-white/10 group-hover/card:scale-105 transition-transform duration-500 flex-shrink-0">
                          <QRCodeCanvas value={PRIMARY_WALLET} size={120} />
                       </div>
                       <div className="flex-1 text-center lg:text-left space-y-6">
                          <div className="space-y-2">
                            <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.4em] block">Field Address</span>
                            <p className="text-[10px] md:text-xs font-mono text-sky-400 break-all leading-relaxed bg-black/40 p-4 rounded-2xl border-none">{PRIMARY_WALLET}</p>
                          </div>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(PRIMARY_WALLET);
                              notify('Treasury address copied', 'success');
                            }}
                            className="w-full lg:w-auto px-10 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shadow-xl shadow-purple-600/20 active:scale-95 border-none"
                          >
                            Copy Deposit Node
                          </button>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Performance Analytics - Reimagined 4-Column Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              
              {/* CARD 1: PERFORMANCE NODE */}
              <div className="p-5 md:p-7 premium-glass rounded-[2rem] shadow-2xl relative overflow-hidden group border-none flex flex-col justify-between min-h-[240px]">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                <div className="relative z-10 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full animate-pulse ${isProfitable ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]'}`}></div>
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em]">Performance</span>
                    </div>
                    <TrendingUp className={`w-4 h-4 ${isProfitable ? 'text-emerald-400' : 'text-red-400 rotate-180'}`} />
                  </div>
                  <div className="space-y-1">
                    <p className={`text-3xl md:text-5xl font-black italic tracking-tighter leading-none ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isProfitable ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                    </p>
                    <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest opacity-60">Net Protocol Yield</p>
                  </div>
                </div>
                <div className="relative z-10 pt-4 border-t border-white/5">
                   <div className="flex justify-between items-center">
                      <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest">Status</span>
                      <span className={`text-[9px] font-black px-3 py-1 rounded-full ${isProfitable ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {isProfitable ? 'OPTIMIZED' : 'DEFICIT'}
                      </span>
                   </div>
                </div>
              </div>

              {/* CARD 2: FUNDING NODE */}
              <div className="p-5 md:p-7 premium-glass rounded-[2rem] shadow-2xl relative overflow-hidden group border-none flex flex-col justify-between min-h-[240px]">
                <div className="relative z-10 space-y-4 h-full">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em]">Funding Node</span>
                    <ArrowUpCircle className="w-4 h-4 text-sky-500/60" />
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="p-3 bg-white/10 rounded-2xl border-none shadow-xl flex-shrink-0 group-hover:scale-105 transition-transform duration-500">
                      <QRCodeCanvas 
                        value={userAddress || '0x'} 
                        size={64}
                        bgColor={"transparent"}
                        fgColor={"#38bdf8"}
                        level={"M"}
                        includeMargin={false}
                      />
                    </div>
                    <div className="flex-1 space-y-1.5 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest leading-none">Best Topup Source</p>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(userAddress);
                            notify('Wallet address copied!', 'success');
                          }}
                          className="flex items-center gap-1.5 px-2 py-1 hover:bg-sky-500/10 text-sky-400 rounded transition-all border border-sky-500/0 hover:border-sky-500/20"
                          title="Copy Address"
                        >
                          <span className="text-[8px] font-black uppercase tracking-wider">{userAddress?.slice(0, 6)}...{userAddress?.slice(-4)}</span>
                          <Copy className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      {bestWallet ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-white truncate leading-none uppercase">{bestWallet.type}</p>
                          <p className="text-[10px] font-mono text-emerald-400 font-bold leading-none">${bestWallet.bal.toFixed(2)} {bestWallet.token === USDC_E_ADDRESS ? 'USDC.e' : 'USDC'}</p>
                          <button 
                            onClick={() => handleTopUp(bestWallet.bal, bestWallet.type, bestWallet.addr, bestWallet.token)}
                            disabled={isProcessing || !!syncingTxHash}
                            className={`mt-2 w-full py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-[0.98] shadow-lg ${
                              syncingTxHash 
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
                                : 'bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-sky-500/20'
                            } disabled:opacity-50`}
                          >
                            {isProcessing ? 'Processing...' : syncingTxHash ? 'Syncing...' : 'Quick Top Up'}
                          </button>
                          {syncingTxHash && (
                            <div className="flex items-center gap-1.5 mt-2 justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
                              <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest">Awaiting On-Chain Node</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-500 italic">No funds found</p>
                          <button 
                            onClick={() => setIsWalletOpen(true)}
                            className="mt-2 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
                          >
                            Open Wallet
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* CARD 3: ANALYTICS HUB */}
              <div className="p-5 md:p-7 premium-glass rounded-[2rem] shadow-2xl relative overflow-hidden group border-none flex flex-col justify-between min-h-[240px]">
                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em]">Operational</span>
                    <Activity className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-end border-b border-white/5 pb-2">
                      <div className="space-y-0.5">
                        <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest leading-none">Sessions</p>
                        <p className="text-xl font-black text-white italic leading-none">{totalSessions}</p>
                      </div>
                      <div className="h-6 w-1 bg-sky-500/20 rounded-full overflow-hidden">
                        <div className="h-1/2 w-full bg-sky-500"></div>
                      </div>
                    </div>
                    <div className="flex justify-between items-end border-b border-white/5 pb-2">
                      <div className="space-y-0.5">
                        <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest leading-none">Max Mass</p>
                        <p className="text-xl font-black text-white italic leading-none">{highScore}</p>
                      </div>
                      <div className="h-6 w-1 bg-yellow-500/20 rounded-full overflow-hidden">
                        <div className="h-3/4 w-full bg-yellow-500"></div>
                      </div>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="space-y-0.5">
                        <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest leading-none">Uptime</p>
                        <p className="text-xl font-black text-white italic leading-none">24h</p>
                      </div>
                      <div className="h-6 w-1 bg-emerald-500/20 rounded-full overflow-hidden">
                        <div className="h-full w-full bg-emerald-500"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* CARD 4: ECONOMIC FLOW */}
              <div className="p-5 md:p-7 premium-glass rounded-[2rem] shadow-2xl relative overflow-hidden group border-none flex flex-col justify-between min-h-[240px]">
                <div className="relative z-10 space-y-4 h-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em]">Economic Flow</span>
                      {syncingTxHash ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-sky-500/10 rounded-full">
                          <RefreshCw className="w-2.5 h-2.5 text-sky-400 animate-spin" />
                          <span className="text-[8px] font-black text-sky-400 uppercase tracking-widest">Syncing...</span>
                        </div>
                      ) : (
                        <button 
                          onClick={() => {
                            notify('Reconciling balances...', 'info');
                            fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
                              },
                              body: JSON.stringify({ 
                                action: 'SYSTEM_RESET', 
                                payload: { targetUserId: userInfo.uuid } 
                              })
                            })
                            .then(res => res.json())
                            .then(data => {
                              notify('Balance synchronized!', 'success');
                              fetchUserData();
                            })
                            .catch(err => notify('Sync failed', 'error'));
                          }}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-500 hover:text-sky-400 transition-all active:scale-90"
                          title="Sync with On-chain"
                        >
                          <RefreshCw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                        </button>
                      )}
                    </div>
                    <Coins className="w-4 h-4 text-yellow-500/60" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="p-3 bg-white/5 rounded-2xl border-none group-hover:bg-white/10 transition-colors">
                      <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest mb-1 leading-none">Wagered</p>
                      <p className="text-lg font-black text-white italic tracking-tighter leading-none">${Number(totalInjected || 0).toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-2xl border-none group-hover:bg-white/10 transition-colors">
                      <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest mb-1 leading-none">Earnings</p>
                      <p className="text-lg font-black text-emerald-400 italic tracking-tighter leading-none">${(Number(userProfile?.balance || 0) + Number(totalWithdrawn || 0)).toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-2xl border-none group-hover:bg-white/10 transition-colors">
                      <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest mb-1 leading-none">Cashed</p>
                      <p className="text-lg font-black text-sky-400 italic tracking-tighter leading-none">${Number(totalWithdrawn || 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 pb-12">
              <button 
                onClick={startGame}
                className="group relative w-full min-h-[400px] md:min-h-[500px] premium-glass rounded-[3rem] overflow-hidden text-left transition-all hover:scale-[1.01] active:scale-[0.99] shadow-2xl border-none premium-card-hover shimmer"
              >
                {/* Background Layering */}
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/20 via-slate-900/40 to-slate-950/60"></div>
                
                {/* Animated Orbs */}
                <div className="absolute -right-20 -top-20 w-96 h-96 bg-sky-500/20 rounded-full blur-[120px] group-hover:bg-sky-500/40 transition-all duration-1000"></div>
                <div className="absolute -left-20 -bottom-20 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] group-hover:bg-blue-600/20 transition-all duration-1000"></div>
                
                <div className="relative p-10 md:p-20 h-full flex flex-col justify-between">
                  <div className="space-y-8">
                    <div className="flex items-center gap-4">
                       <div className="px-5 py-2 bg-sky-500/20 rounded-full backdrop-blur-xl border-none">
                          <span className="text-sky-400 font-mono text-[10px] uppercase font-black tracking-[0.3em]">Protocol Active</span>
                       </div>
                       <div className="px-5 py-2 bg-yellow-500/20 rounded-full backdrop-blur-xl border-none">
                          <span className="text-yellow-400 font-mono text-[10px] uppercase font-black tracking-[0.3em]">${ENTRY_FEE.toFixed(2)} WAGER</span>
                       </div>
                    </div>
                    
                    <div className="space-y-4">
                      <h2 className="text-6xl md:text-9xl font-black italic tracking-tighter text-white leading-[0.85] uppercase">
                        NEON<br/>
                        <span className="premium-gradient-text">SLITHER</span>
                      </h2>
                      <p className="max-w-xl text-slate-400 text-sm md:text-2xl font-medium leading-relaxed opacity-80">
                        Survive the digital void. Consume data nodes and outmaneuver rival protocols to dominate the matrix.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-8 pt-12">
                    <div className="px-12 py-6 bg-sky-500 text-slate-950 rounded-[2rem] font-black text-2xl md:text-3xl uppercase tracking-tighter shadow-2xl shadow-sky-500/40 group-hover:bg-sky-400 group-hover:scale-105 transition-all duration-500 flex items-center gap-5 border-none">
                      <Play className={`w-8 h-8 md:w-10 md:h-10 fill-current ${isProcessing ? 'animate-pulse' : ''}`} />
                      {isProcessing ? 'AUTHORIZING...' : 'START SESSION'}
                    </div>
                    <div className="flex flex-col space-y-1">
                      <span className="text-slate-500 font-mono text-[10px] uppercase tracking-[0.3em] font-black">Economic Yield</span>
                      <span className="text-emerald-400 font-black text-2xl italic">HIGH VOLATILITY</span>
                    </div>
                  </div>
                </div>

                {/* Decorative Elements */}
                <div className="absolute right-12 bottom-12 opacity-5 group-hover:opacity-10 transition-opacity hidden md:block">
                   <Gamepad2 className="w-64 h-64 text-white rotate-12" />
                </div>
              </button>
              
              {/* Test Mode Protocol Toggle - ADMIN ONLY */}
              {isAdmin && (
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-6 bg-slate-900/50 rounded-[2rem] backdrop-blur-xl border-none">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${isTestMode ? 'bg-yellow-500 animate-pulse' : 'bg-slate-700'}`}></div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">Testing Environment</span>
                        <span className="text-[10px] font-mono text-sky-500/60 uppercase tracking-tighter">Bypass Economic Deduction</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => setIsTestMode(!isTestMode)}
                      className={`px-6 py-3 rounded-xl text-[10px] font-bold uppercase transition-all ${
                        isTestMode 
                          ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20' 
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {isTestMode ? 'TEST MODE ACTIVE' : 'ENABLE TEST MODE'}
                    </button>
                  </div>

                  <button 
                    onClick={() => {
                      setConfirmModal({
                        show: true,
                        title: 'SYSTEM WIDE RESET',
                        message: 'This will force-sync all user balances with the blockchain and reset all PNL statistics to zero. This action cannot be undone.',
                        onConfirm: async () => {
                          setIsProcessing(true);
                          try {
                            const { data: { session: authSession } } = await supabase.auth.getSession();
                            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
                              },
                              body: JSON.stringify({ action: 'SYSTEM_RESET' })
                            });
                            const result = await res.json();
                            notify(result.message || 'System sync complete', 'success');
                            fetchUserData();
                          } catch (err: any) {
                            notify(err.message || 'Reset failed', 'error');
                          } finally {
                            setIsProcessing(false);
                          }
                        }
                      });
                    }}
                    disabled={isProcessing}
                    className="flex items-center justify-between p-6 bg-red-500/10 hover:bg-red-500/20 rounded-[2rem] backdrop-blur-xl border-none transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <ShieldAlert className="w-5 h-5 text-red-500" />
                      <div className="flex flex-col text-left">
                        <span className="text-[10px] font-mono text-red-500 uppercase tracking-widest font-bold">System Maintenance</span>
                        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Force Balance Sync & PNL Reset</span>
                      </div>
                    </div>
                    <RefreshCw className={`w-5 h-5 text-red-500 ${isProcessing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                  </button>

                  <button 
                    onClick={() => {
                      setConfirmModal({
                        show: true,
                        title: 'NUCLEAR IDENTITY RESET',
                        message: 'This will WIPE all your in-game credits and force your database profile to match your real on-chain wallets. Your PNL will be set to exactly $0.00.',
                        onConfirm: async () => {
                          setIsProcessing(true);
                          try {
                            const { data: { session: authSession } } = await supabase.auth.getSession();
                            // Calculate current real liquidity from matrix (excluding treasury)
                            const realLiquidity = detectedAddresses
                              .filter(d => d.type !== 'House Treasury')
                              .reduce((acc, d) => acc + d.bal, 0);

                            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
                              },
                              body: JSON.stringify({ 
                                action: 'SYSTEM_RESET', 
                                payload: { targetUserId: userInfo.uuid, forceMatchBalance: realLiquidity } 
                              })
                            });
                            const result = await res.json();
                            notify('Identity synced to Matrix. PNL Reset.', 'success');
                            fetchUserData();
                          } catch (err: any) {
                            notify(err.message || 'Sync failed', 'error');
                          } finally {
                            setIsProcessing(false);
                          }
                        }
                      });
                    }}
                    disabled={isProcessing}
                    className="flex items-center justify-between p-6 bg-sky-500/10 hover:bg-sky-500/20 rounded-[2rem] backdrop-blur-xl border-none transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <Zap className="w-5 h-5 text-sky-500" />
                      <div className="flex flex-col text-left">
                        <span className="text-[10px] font-mono text-sky-500 uppercase tracking-widest font-bold">Identity Sync</span>
                        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Force DB to match Wallet Matrix</span>
                      </div>
                    </div>
                    <RefreshCw className={`w-5 h-5 text-sky-500 ${isProcessing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* Game Layer - Outside Main to avoid clipping */}
      <AnimatePresence>
        {currentPage === 'PLAYING' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] bg-slate-950 w-screen h-screen overflow-hidden"
          >
            <Game 
              onGameOver={handleGameOver}
              onScoreUpdate={setScore}
              onMoneyCollect={handleMoneyCollect}
              userProfile={userProfile}
              isTestMode={isTestMode}
              wager={ENTRY_FEE}
            />

            {/* In-Game HUD Overlay */}
            <div className="absolute inset-0 z-[2100] pointer-events-none p-6 md:p-10 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div className="space-y-4">
                  <div className="premium-glass p-6 rounded-[2rem] border-none shadow-2xl">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20">
                        <Wallet className="w-5 h-5 text-slate-950" />
                      </div>
                      <div>
                        <p className="text-sky-500/60 font-mono text-[10px] uppercase font-bold tracking-widest leading-none mb-1">Balance</p>
                        <p className="text-2xl font-black text-white italic tracking-tighter leading-none">${Number(userProfile?.balance || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="premium-glass p-6 rounded-[2rem] border-none shadow-2xl bg-emerald-500/5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                        <Target className="w-5 h-5 text-slate-950" />
                      </div>
                      <div>
                        <p className="text-emerald-500/60 font-mono text-[10px] uppercase font-bold tracking-widest leading-none mb-1">Session Loot</p>
                        <p className="text-2xl font-black text-white italic tracking-tighter leading-none">+${Number(currentSessionLoot || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-between items-end">
                {/* Empty div to balance bottom-left which has the mini-map on canvas */}
                <div className="w-48 h-48 pointer-events-none"></div>

                <div className="px-6 py-3 premium-glass rounded-full border-none shadow-xl bg-slate-950/40 backdrop-blur-md mb-4">
                  <p className="text-slate-500 font-mono text-[10px] uppercase font-bold tracking-widest">
                    Hold <span className="text-sky-400">Space</span> or <span className="text-sky-400">Click</span> to Boost
                  </p>
                </div>

                <div className="premium-glass p-6 rounded-[2rem] border-none shadow-2xl bg-white/5">
                  <div className="text-right">
                    <p className="text-slate-400 font-mono text-[10px] uppercase font-bold tracking-widest leading-none mb-1">Current Mass</p>
                    <p className="text-5xl font-black text-white italic tracking-tighter leading-none">{score}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Custom Wallet Modal */}
      {isWalletOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center md:p-6 lg:p-12 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-2xl" onClick={() => setIsWalletOpen(false)}></div>
          
          <div className="relative w-full h-full md:h-auto md:max-w-2xl premium-glass rounded-none md:rounded-[3rem] shadow-[0_0_100px_-20px_rgba(56,189,248,0.2)] overflow-y-auto border-none">
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

              <div className="space-y-8">
                {/* Balance Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-white/[0.03] rounded-3xl space-y-2">
                    <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest font-bold">Balance</p>
                    <p className="text-2xl font-black text-[#00ffa3] italic tracking-tighter">
                      ${(userProfile?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="p-6 bg-white/[0.03] rounded-3xl space-y-2">
                    <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest font-bold">Total Injected</p>
                    <p className="text-2xl font-black text-white italic tracking-tighter">
                      ${(userProfile?.total_injected || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {/* Top Up Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-2">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <Zap className="w-3 h-3 text-sky-400" />
                      Protocol Top Up (Gassless)
                    </h4>
                  </div>
                  <div className="space-y-4">
                    {(() => {
                      const filtered = detectedAddresses.filter(d => {
                        const isBiconomy = d.type.toLowerCase().includes('biconomy');
                        const isOperatorNode = d.address.toLowerCase() === userAddress.toLowerCase();
                        const hasBalance = (d.bal || 0) > 0 || (d.nativeBal || 0) > 0 || (d.bridgedBal || 0) > 0;
                        
                        // Show the primary Biconomy Operator Node OR any wallet with balance (for recovery)
                        return (isOperatorNode && isBiconomy) || hasBalance;
                      });

                      if (filtered.length > 0) {
                        return filtered.map((d, i) => (
                          <div key={i} className="space-y-3">
                            <div className="premium-glass p-6 rounded-3xl border-none flex flex-col sm:flex-row sm:items-center justify-between gap-6 hover:bg-white/[0.05] transition-all group/row">
                              <div className="flex items-center gap-5">
                                <div className="w-12 h-12 rounded-2xl bg-sky-500/10 flex items-center justify-center text-sky-400 group-hover/row:scale-110 transition-transform">
                                  <Zap className="w-6 h-6" />
                                </div>
                                  <div className="min-w-0">
                                    <p className="text-base font-black text-white group-hover/row:text-sky-400 transition-colors uppercase tracking-tight">
                                      {d.type} (USDC)
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <p className="text-[10px] font-mono text-slate-500">{d.address.slice(0,12)}...{d.address.slice(-8)}</p>
                                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 uppercase tracking-widest">GASSLESS NODE</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-6">
                                  <div className="text-right">
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Available</p>
                                    <p className="text-2xl font-black text-white italic tracking-tighter">${d.nativeBal.toFixed(2)}</p>
                                  </div>
                                  <button 
                                    onClick={() => handleTopUp(d.nativeBal, d.type, d.address, USDC_ADDRESS)} 
                                    disabled={isProcessing}
                                    className="px-8 py-4 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-sky-500/20 transition-all active:scale-95"
                                  >
                                    {isProcessing ? 'Wait...' : 'Top Up'}
                                  </button>
                                </div>
                              </div>
                          </div>
                        ));
                      }

                      return (
                        <div className="text-center py-12 premium-glass rounded-[2rem] border-none">
                          <p className="text-slate-500 text-sm font-black uppercase tracking-widest italic opacity-40">Initializing Protocol Node...</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Account Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 bg-white/[0.03] rounded-2xl space-y-3 border-none">
                    <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest font-bold">Operator Node</p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-white font-mono truncate">
                        {userAddress ? `${userAddress.toLowerCase().slice(0, 6)}...${userAddress.toLowerCase().slice(-4)}` : 'Disconnected'}
                      </span>
                      <button 
                        onClick={() => {
                          if (userAddress) {
                            navigator.clipboard.writeText(userAddress);
                            notify('Address copied!', 'success');
                          }
                        }}
                        className="p-2 hover:bg-sky-500/10 text-sky-400 rounded-lg transition-all"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <button 
                    disabled={isProcessing || balance <= 0}
                    onClick={async () => {
                      if (!userInfo?.uuid) return;
                      setIsProcessing(true);
                      try {
                        // 1. Use the existing established address
                        const targetAddress = userAddress || ethAddress || (userInfo.wallets?.[0]?.public_address);
                        const { data: { session: authSession } } = await supabase.auth.getSession();
                        
                        if (!targetAddress) {
                          notify('Opening wallet selector...', 'info');
                          await connect();
                          return; // Let them click again once connected
                        }

                        console.log('[Withdraw] Selected destination:', targetAddress);

                      // 2. Proceed with payout confirmation
                      const withdrawAmount = Math.floor((balance || 0) * 1000000) / 1000000;
                      
                      setConfirmModal({
                        show: true,
                        title: 'Confirm Withdrawal',
                        message: `Withdraw $${withdrawAmount.toFixed(2)} USDC to ${targetAddress.slice(0,6)}...${targetAddress.slice(-4)}?`,
                        onConfirm: async () => {
                          setIsProcessing(true);
                          try {
                            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
                              },
                              body: JSON.stringify({ 
                                action: 'WITHDRAW', 
                                payload: { 
                                  userId: userInfo.uuid, 
                                  amount: withdrawAmount,
                                  targetAddress: targetAddress 
                                } 
                              })
                            });

                            const result = await res.json();
                            if (result.error) throw new Error(result.error);
                            notify(result.payoutSent ? `Success! Sent to ${targetAddress.slice(0,6)}...` : 'Withdrawal processed.', 'success');
                            fetchUserData();
                          } catch (err: any) {
                            console.error('[Withdraw] Error:', err);
                            notify(err.message || 'Withdrawal failed', 'error');
                          } finally {
                            setIsProcessing(false);
                          }
                        }
                      });
                    } catch (err: any) {
                      console.error('[Withdraw Setup] Error:', err);
                      notify(err.message || 'Failed to initialize withdrawal', 'error');
                    } finally {
                      setIsProcessing(false);
                    }
                  }}
                    className="p-6 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-2xl flex items-center justify-between group transition-all border-none disabled:opacity-50"
                  >
                    <div className="text-left">
                      <p className="text-emerald-500/60 font-mono text-[10px] uppercase tracking-widest">Payout Execution</p>
                      <p className="text-white font-bold">Withdraw to Wallet</p>
                    </div>
                    <ExternalLink className="w-5 h-5 text-emerald-500 group-hover:scale-110 transition-transform" />
                  </button>
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
        </div>
      )}

      {/* Deposit Wizard Modal */}
      {isDepositWizardOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center md:p-6 animate-in fade-in zoom-in duration-500">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-2xl" onClick={() => setIsDepositWizardOpen(false)}></div>
          
          <div className="relative w-full h-full md:h-auto md:max-w-xl premium-glass rounded-none md:rounded-[3rem] shadow-[0_0_100px_-20px_rgba(16,185,129,0.2)] overflow-y-auto border-none">
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
                    size={240}
                    level="H"
                    includeMargin={true}
                    className="rounded-xl"
                  />
                </div>
                
                <div className="w-full space-y-4">
                  <div className="p-6 bg-slate-950/50 rounded-2xl space-y-3">
                    <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest text-center">Your Deposit Address (ARBITRUM)</p>
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-xs font-bold text-sky-400 font-mono break-all text-center">
                        {userAddress?.toLowerCase()}
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
                      <span className="text-sm font-black text-white">Arbitrum One</span>
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
                      className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-2xl font-bold text-sm uppercase tracking-tighter transition-all flex items-center justify-center gap-2"
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
      <div className="fixed bottom-4 left-4 right-4 md:bottom-8 md:right-8 md:left-auto z-[1000] flex flex-col gap-3 pointer-events-none items-center md:items-end">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              className={`pointer-events-auto p-4 md:p-5 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center gap-4 w-full max-w-[380px] md:min-w-[320px] ${
                n.type === 'success' ? 'bg-emerald-500/10' :
                n.type === 'error' ? 'bg-red-500/10' :
                'bg-sky-500/10'
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
          <div className="fixed inset-0 z-[3000] flex items-center justify-center md:p-6 bg-slate-950/60 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full h-full md:h-auto md:max-w-lg bg-slate-900 rounded-none md:rounded-[3rem] shadow-2xl overflow-y-auto"
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
                  <div className="p-6 bg-slate-950/50 rounded-3xl space-y-1">
                    <p className="text-sky-500/60 font-mono text-[10px] uppercase font-bold tracking-widest">Final Mass</p>
                    <p className="text-4xl font-black italic">{gameOverResult.score}</p>
                  </div>
                  <div className="p-6 bg-slate-950/50 rounded-3xl space-y-1">
                    <p className="text-emerald-500/60 font-mono text-[10px] uppercase font-bold tracking-widest">Global Balance</p>
                    <p className="text-2xl font-black italic">${Number(balance || 0).toFixed(2)}</p>
                  </div>
                </div>

                <div className="bg-slate-950/80 rounded-[2rem] overflow-hidden">
                  <div className="px-8 py-6 flex justify-between items-center bg-white/[0.02]">
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold text-slate-400">Financial Summary</span>
                    <TrendingDown className="w-4 h-4 text-red-500/50" />
                  </div>
                  <div className="p-8 space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Session Wager</span>
                      <span className="text-white font-mono">$0.10</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Collected Earnings</span>
                      <span className="text-emerald-400 font-mono">+${Number(gameOverResult.collected || 0).toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-white/5"></div>
                    <div className="flex justify-between text-sm">
                      <div className="flex flex-col">
                        <span className="text-red-400">Survival Penalty (50%)</span>
                        <span className="text-[10px] text-slate-500 uppercase">Clawback Protocol</span>
                      </div>
                      <span className="text-red-400 font-mono">-${Number(gameOverResult.penalty || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-emerald-400">Survival Payout</span>
                      <span className="text-emerald-400 font-mono">+${Number((gameOverResult.collected || 0) - (gameOverResult.penalty || 0)).toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-white/5"></div>
                    <div className="pt-4 flex justify-between items-baseline">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Net Gain</span>
                      <span className={`text-2xl font-black italic ${(gameOverResult.collected - gameOverResult.penalty - 0.10) >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                        ${Number((gameOverResult.collected || 0) - (gameOverResult.penalty || 0) - 0.10).toFixed(2)}
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
          <div className="fixed inset-0 z-[1100] flex items-center justify-center md:p-6">
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
              className="relative w-full h-full md:h-auto md:max-w-md bg-slate-900 rounded-none md:rounded-[2rem] shadow-2xl p-8 space-y-6 overflow-y-auto"
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
