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
  const smartAccountRef = useRef<SmartAccount | null>(null);

  // Initialize SmartAccount once to avoid WASM re-init crashes
  useEffect(() => {
    if (!provider || smartAccountRef.current || aaInitializing) return;
    
    const initAA = async () => {
      aaInitializing = true;
      try {
        const smartAccount = new SmartAccount(provider, {
          projectId: '3a913b51-6884-4638-bd23-fa0d728c7975',
          clientKey: 'cizt9y8vB1VHrGU4lACTDkZg09rkMwYRDi5RcgZZ',
          appId: '8c38a8da-9800-4764-9007-76d512c5163e',
          aaOptions: {
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
  const ENTRY_FEE = 0.10;

  const notify = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const handleTopUp = async (explicitAmount?: number, explicitType?: string, explicitAddr?: string) => {
    const targetAddr = explicitAddr || (window as any)._targetDepositAddr;
    const targetType = explicitType || (window as any)._targetDepositType;
    const amount = explicitAmount !== undefined ? explicitAmount : Number(topUpAmount);

    if (!userInfo?.uuid || !amount || amount <= 0 || !targetAddr) return;
    
    setIsProcessing(true);
    try {
      notify(`Initiating deposit of ${amount} USDC from ${targetType}...`, 'info');

      if (!provider) throw new Error('No wallet provider found');

      // Find the balance of the specific target address
      const targetNode = detectedAddresses.find(d => d.addr.toLowerCase() === targetAddr.toLowerCase());
      const availableBal = targetNode ? targetNode.bal : 0;
      
      // Cap the amount to the available balance in that specific wallet
      let finalAmount = amount;
      if (finalAmount > availableBal) {
        console.warn(`[TopUp] Requested ${finalAmount} but only ${availableBal} available in target node. Capping.`);
        finalAmount = availableBal;
      }

      if (finalAmount <= 0) throw new Error('Target wallet has no USDC balance');

      // Force correct Biconomy version before proceeding
      if (targetType && targetType.includes('biconomy')) {
        const targetVersion = targetType.includes('v1') ? '1.0.0' : '2.0.0';
        const currentOptions = (smartAccountRef.current as any)?.options;
        const currentVersion = currentOptions?.aaOptions?.accountContracts?.BICONOMY?.[0]?.version;
        
        if (currentVersion !== targetVersion) {
           console.log(`[TopUp] Switching Biconomy from ${currentVersion} to ${targetVersion}`);
           smartAccountRef.current = new (smartAccountRef.current as any).constructor(particle.ethProvider, {
             projectId: "9c3c588e-4a6c-48c9-8d76-5835698b58a1",
             clientKey: "cl6mD9IOfn6H9v3p2SgRCH9oF86tQn6kLg9rL5qN",
             appId: "c29e2f42-7a0e-473d-9d10-3375868a984a",
             aaOptions: {
               accountContracts: {
                 BICONOMY: [{ version: targetVersion, chainIds: [42161] }]
               }
             }
           });
        }
      }

      const activeAddress = await smartAccountRef.current?.getAddress();
      const isSmartAccount = 
        targetType?.toLowerCase().includes('biconomy') || 
        targetType?.toLowerCase().includes('simple') ||
        (activeAddress && targetAddr?.toLowerCase() === activeAddress.toLowerCase());

      let txHash = '';
      if (isSmartAccount) {
        // --- SMART ACCOUNT DEPOSIT ---
        if (!smartAccountRef.current) throw new Error('Smart Account not ready. Please refresh.');
        
        notify(`Preparing Smart Account transfer of ${finalAmount.toFixed(6)} USDC...`, 'info');
        const usdcInterface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
        const callData = usdcInterface.encodeFunctionData("transfer", [PRIMARY_WALLET, ethers.parseUnits(finalAmount.toFixed(6), 6)]);

        // Some SDK versions prefer an array of transactions
        const tx = { to: USDC_ADDRESS, data: callData, value: '0x0' };

        // Get fee quotes to find a paymaster (Smart Account has no ETH for gas)
        console.log('[AA] Estimating gas for:', tx);
        const feeQuotes = await smartAccountRef.current.getFeeQuotes(tx);
        console.log('[AA] Fee quotes received:', JSON.stringify(feeQuotes, null, 2));

        if (feeQuotes.verifyingPaymasterGasless) {
          console.log('[AA] Using gasless paymaster');
          notify('Sponsoring gas fees...', 'info');
          txHash = await smartAccountRef.current.sendTransaction({
            tx,
            feeQuote: feeQuotes.verifyingPaymasterGasless.feeQuote,
          } as any);
        } else if (feeQuotes.tokenPaymaster?.feeQuotes?.length) {
          const usdcFee = feeQuotes.tokenPaymaster.feeQuotes.find(
            (q: any) => q.tokenInfo.address.toLowerCase() === USDC_ADDRESS.toLowerCase()
          ) || feeQuotes.tokenPaymaster.feeQuotes[0];
          
          console.log('[AA] Using token paymaster, fee:', usdcFee);
          
          // DEDUCT FEE: Check if we have enough total balance for amount + fee
          const feeAmount = Number(usdcFee.fee) / 10 ** usdcFee.tokenInfo.decimals;
          if (finalAmount + feeAmount > availableBal) {
            // Deduct fee plus a 5% buffer for slippage/price changes
            const buffer = feeAmount * 0.05;
            const adjustedAmount = Math.max(0, finalAmount - feeAmount - buffer);
            console.log(`[TopUp] Adjusting for fees: ${finalAmount} -> ${adjustedAmount}`);
            
            if (adjustedAmount <= 0) throw new Error(`Insufficient USDC for fees ($${feeAmount.toFixed(4)})`);
            
            // Update the transaction data with the adjusted amount
            const newCallData = usdcInterface.encodeFunctionData("transfer", [PRIMARY_WALLET, ethers.parseUnits(adjustedAmount.toFixed(6), 6)]);
            tx.data = newCallData;
            notify(`Adjusting to $${adjustedAmount.toFixed(3)} to cover gas fees...`, 'info');
          }

          notify(`Paying gas with ${usdcFee.tokenInfo.symbol}...`, 'info');
          txHash = await smartAccountRef.current.sendTransaction({
            tx,
            feeQuote: usdcFee,
            tokenPaymasterAddress: feeQuotes.tokenPaymaster.tokenPaymasterAddress,
          } as any);
        } else {
          console.log('[AA] No paymaster available, attempting native gas');
          notify('Signing transaction...', 'info');
          txHash = await smartAccountRef.current.sendTransaction({ tx } as any);
        }
        
        console.log('[TopUp] TX Hash:', txHash);
        notify('Transaction broadcasted! Syncing credits...', 'info');
      } else {
        // --- STANDARD EOA DEPOSIT ---
        const browserProvider = new ethers.BrowserProvider(provider as any);
        const signer = await browserProvider.getSigner();
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ["function transfer(address to, uint256 amount) returns (bool)"], signer);
        
        notify(`Requesting signature for ${finalAmount.toFixed(6)} USDC...`, 'info');
        const tx = await usdcContract.transfer(PRIMARY_WALLET, ethers.parseUnits(finalAmount.toFixed(6), 6));
        notify('Transaction sent! Confirming on-chain...', 'info');
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error('Transaction failed on-chain');
        txHash = tx.hash;
      }

      // Call backend to verify and add credits
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/game-engine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ action: 'DEPOSIT', payload: { userId: userInfo.uuid, txHash: txHash } })
      });

      const result = await res.json();
      if (result.success) {
        notify(`Successfully added ${result.added} credits!`, 'success');
        // Update local profile state immediately for real-time dashboard feedback
        if (userProfile) {
          const updatedBal = result.newBalance;
          setUserProfile({ ...userProfile, balance: updatedBal });
          setBalance(updatedBal);
        }
        await fetchUserData();
      } else {
        // --- GRACEFUL INDEXING HANDLING ---
        // If the backend says 'not detected yet' but we KNOW the tx was broadcasted successfully
        if (result.error?.toLowerCase().includes('not detected yet')) {
          notify('Confirmed! Your balance is syncing on-chain...', 'success');
          // Start a background polling loop to update the balance once indexed
          let checkCount = 0;
          const poll = setInterval(async () => {
            checkCount++;
            const { data } = await supabase.from('profiles').select('balance').eq('id', userInfo.uuid).single();
            if (data?.balance && data.balance > (userProfile?.balance || 0)) {
              setBalance(data.balance);
              setUserProfile(prev => prev ? { ...prev, balance: data.balance } : null);
              clearInterval(poll);
            }
            if (checkCount > 10) clearInterval(poll);
          }, 3000);
        } else {
          throw new Error(result.error || 'Failed to award credits');
        }
      }
    } catch (err: any) {
      console.error('[TopUp] Error:', err);
      notify(err.reason || err.message || 'Top-up failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const isAdmin = useMemo(() => {
    const eoaWallet = userInfo?.wallets?.find((w: any) => w.type?.toLowerCase() === 'eoa')?.public_address;
    return (
      userInfo?.email?.toLowerCase() === 'ptnmgmt@gmail.com' || 
      userAddress?.toLowerCase() === PRIMARY_WALLET.toLowerCase() ||
      eoaWallet?.toLowerCase() === PRIMARY_WALLET.toLowerCase() ||
      (userInfo as any)?.public_address?.toLowerCase() === PRIMARY_WALLET.toLowerCase()
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
            if (provider) {
              const res = await (provider as any).request({
                method: 'eth_call',
                params: [{ to: contract, data: callData }, 'latest']
              });
              return res;
            }

            const response = await fetch('https://arb1.arbitrum.io/rpc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_call',
                params: [{ to: contract, data: callData }, 'latest']
              })
            });
            const result = await response.json();
            return result?.result || null;
          } catch (e) {
            console.error(`[RPC Error] Failed to fetch balance for ${contract}:`, e);
            return null;
          }
        };

        const [resUSDC, resUSDCe] = await Promise.all([
          fetchCall(USDC_ADDRESS),
          fetchCall(USDC_E_ADDRESS)
        ]);

        console.log(`[Diagnostic] Raw balances for ${targetAddr.slice(0, 8)}...:`, { resUSDC, resUSDCe });

        // If both fail, return null to signal a fetch error
        if (resUSDC === null && resUSDCe === null) return null;

        let total = 0;
        if (resUSDC && resUSDC !== '0x' && resUSDC.length > 2) {
          try {
            total += Number(BigInt(resUSDC)) / Math.pow(10, USDC_DECIMALS);
          } catch (e) { console.warn('Failed to parse USDC balance:', resUSDC); }
        }
        if (resUSDCe && resUSDCe !== '0x' && resUSDCe.length > 2) {
          try {
            total += Number(BigInt(resUSDCe)) / Math.pow(10, USDC_DECIMALS);
          } catch (e) { console.warn('Failed to parse USDC.e balance:', resUSDCe); }
        }

        return total;
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

        const bal = await getBalance(addr);
        if (bal === null) {
          hasError = true;
          continue;
        }
        
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
        
        if (!isTreasury && bal > 0) {
          console.log(`[Diagnostic] Adding ${bal} from ${type} (${addr.slice(0,6)}) to credits`);
          totalWalletBalance += bal;
        }
        
        newDetected.push({ addr, bal, type });
      }
      setDetectedAddresses(newDetected);

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

      const primaryAddr = forcedAddress || userAddress || pWallets[0]?.public_address || (userInfo as any).public_address;
      if (primaryAddr && !userAddress) setUserAddress(primaryAddr);

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
        if (tBal !== null) setTreasuryBalance(tBal);
        
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

  // Sync with Supabase on auth change
  useEffect(() => {
    console.log('Auth State Change:', { 
      connectionStatus, 
      hasUserInfo: !!userInfo, 
      walletsCount: userInfo.wallets?.length,
      hasAuthProvider: !!authProvider,
      hasEthProvider: !!ethProvider,
      ethAddress
    });

    const getAddress = async () => {
      if (connectionStatus === 'connected' && userInfo) {
        console.log('[Diagnostic] Full UserInfo keys:', Object.keys(userInfo));
        
        let biconomyAddress = '';
        let simpleAddress = '';
        
        if (provider) {
          try {
            let chainId = await (provider as any).request({ method: 'eth_chainId' });
            console.log('[Diagnostic] Current Chain ID:', chainId);

            // Force switch to Arbitrum One (0xa4b1) if on wrong chain
            if (chainId !== '0xa4b1' && chainId !== 42161) {
              console.log('[Diagnostic] Attempting to switch to Arbitrum One...');
              try {
                await (provider as any).request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0xa4b1' }]
                });
                // Refresh chainId after switch
                chainId = await (provider as any).request({ method: 'eth_chainId' });
                console.log('[Diagnostic] Chain ID after switch:', chainId);
              } catch (switchErr) {
                console.warn('[Diagnostic] Chain switch failed:', switchErr);
              }
            }

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
                console.warn(`[Diagnostic] Failed to init ${type} ${version} account:`, e);
                return '';
              }
            };
            
            biconomyAddress = await initSA('BICONOMY', '2.0.0');
            const biconomyV1Address = await initSA('BICONOMY', '1.0.0');
            simpleAddress = await initSA('SIMPLE', '1.0.0');
            const simpleV2Address = await initSA('SIMPLE', '2.0.0');
            
            if (biconomyAddress) (userInfo as any).biconomyV2Address = biconomyAddress;
            if (biconomyV1Address) (userInfo as any).biconomyV1Address = biconomyV1Address;
            if (simpleAddress) (userInfo as any).simpleV1Address = simpleAddress;
            if (simpleV2Address) (userInfo as any).simpleV2Address = simpleV2Address;
          } catch (aaInitErr) {
            console.warn('[Diagnostic] AA SDK overall initialization failed:', aaInitErr);
          }
        }
        
        // Log all detected wallet data
        userInfo.wallets?.forEach((w: any, idx: number) => {
          console.log(`[Diagnostic] Wallet ${idx} address:`, w.public_address);
        });

        // Prioritize: Biconomy -> Simple -> ethAddress -> wallets list -> EOA
        const smartAccountFromList = userInfo.wallets?.find((w: any) => 
          w.type?.toLowerCase().includes('smart') || 
          w.type?.toLowerCase().includes('aa') || 
          w.type?.toLowerCase().includes('biconomy') ||
          w.type?.toLowerCase().includes('erc4337') ||
          w.type?.toLowerCase().includes('simple') ||
          w.type?.toLowerCase().includes('light')
        );
        
        const evmWallet = userInfo.wallets?.find((w: any) => 
          w.chain_name?.toLowerCase().includes('evm') || 
          w.public_address?.startsWith('0x')
        );
        
        let address = biconomyAddress || simpleAddress || ethAddress || smartAccountFromList?.public_address || evmWallet?.public_address || userInfo.wallets?.[0]?.public_address || (userInfo as any).public_address;
        
        console.log('Selected Address Logic:', { biconomyAddress, simpleAddress, ethAddress, smartType: smartAccountFromList?.public_address, evmType: evmWallet?.public_address });
        console.log('Final Selected Address:', address);

        if (address) {
          setUserAddress(address);
          fetchUserData(address, 0, { biconomyAddress, simpleAddress });
        }
      }
    };
    getAddress();
  }, [fetchUserData, userInfo?.uuid]);

  // Handle address discovery separately to keep dependencies clean
  useEffect(() => {
    if (connectionStatus !== 'connected' || !userInfo?.uuid) return;
    
    const discoverAddresses = async () => {
      let biconomyAddress = '';
      let simpleAddress = '';
      
      if (provider) {
        try {
          const initSA = async (type: string, version: string = '2.0.0') => {
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
            return await sa.getAddress();
          };
          
          biconomyAddress = await initSA('BICONOMY', '2.0.0');
          simpleAddress = await initSA('SIMPLE', '1.0.0');
        } catch (e) {
          console.warn('Address discovery error:', e);
        }
      }

      const address = biconomyAddress || simpleAddress || ethAddress || userInfo.wallets?.[0]?.public_address;
      if (address && address !== userAddress) {
        setUserAddress(address);
        fetchUserData(address, 0, { biconomyAddress, simpleAddress });
      } else if (!userProfile && userInfo?.uuid) {
        fetchUserData();
      }
    };

    discoverAddresses();
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
       if (!isTestMode && balance < 0.10) {
         setConfirmModal({
           show: true,
           title: 'Insufficient Credits',
           message: '$0.10 Entry Fee required. Please top up your balance to continue.',
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
          if (!isTestMode) notify('Session Started: -$0.10', 'info');
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
    const netPnl = Math.max(0, collectedMoney - ENTRY_FEE);
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
                     <button onClick={fetchUserData} className="flex items-center justify-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-slate-800/60 hover:bg-slate-700 text-sky-400 rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all active:scale-95 shadow-xl border-none">
                        <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                        <span>SYNC</span>
                     </button>
                     <button 
                        disabled={isProcessing}
                        onClick={() => setIsDepositWizardOpen(true)}
                        className="flex items-center justify-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-emerald-500/20 disabled:opacity-50 border-none"
                     >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>TOPUP</span>
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
              {/* Admin Treasury Dashboard - Optimized for Mobile */}
              {(userInfo?.email?.toLowerCase() === 'ptnmgmt@gmail.com' || 
                userAddress === '0x8733E2065B72121cC9a91E5471D2cc1075D050ef') && (
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

            {/* Performance Analytics - Optimized Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8">
              <div className="col-span-2 p-6 md:p-10 premium-glass rounded-[2rem] md:rounded-[3rem] space-y-4 md:space-y-6 shadow-2xl relative overflow-hidden group border-none">
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                   <TrendingUp className="w-32 h-32 md:w-48 md:h-48" />
                </div>
                <div className="relative z-10 space-y-2">
                   <p className="text-sky-400 font-mono text-[10px] md:text-xs uppercase tracking-[0.3em] font-black">Gross Performance</p>
                   <div className={`text-3xl md:text-6xl font-black flex items-center gap-3 md:gap-5 italic tracking-tighter ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                     {isProfitable ? <TrendingUp className="w-8 h-8 md:w-14 md:h-14" /> : <TrendingDown className="w-8 h-8 md:w-14 md:h-14" />}
                     {Number(Math.abs(pnl) || 0).toFixed(2)} <span className="text-lg md:text-3xl font-bold not-italic text-slate-500 uppercase tracking-normal">USDC</span>
                   </div>
                </div>
                
                <div className="pt-4 grid grid-cols-2 gap-3 md:gap-6 relative z-10">
                  <div className="p-4 md:p-6 bg-slate-950/40 rounded-2xl md:rounded-3xl border-none">
                    <p className="text-slate-500 text-[9px] md:text-[11px] uppercase font-black mb-1 tracking-widest">Wagered</p>
                    <p className="text-lg md:text-2xl font-black italic text-white tracking-tighter">{Number(totalInjected || 0).toFixed(2)}</p>
                  </div>
                  <div className="p-4 md:p-6 bg-slate-950/40 rounded-2xl md:rounded-3xl border-none">
                    <p className="text-slate-500 text-[9px] md:text-[11px] uppercase font-black mb-1 tracking-widest">Available</p>
                    <div className="flex items-center justify-between">
                      <p className="text-lg md:text-2xl font-black italic text-white tracking-tighter">
                        {isBalanceVisible ? `${Number(userProfile?.balance || 0).toFixed(2)}` : '••••'}
                      </p>
                      <button onClick={() => setIsBalanceVisible(!isBalanceVisible)} className="text-slate-600 hover:text-sky-400 transition-colors">
                        {isBalanceVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 md:p-10 premium-glass rounded-[2rem] md:rounded-[3rem] flex flex-col justify-between shadow-2xl group border-none">
                <div className="space-y-1">
                   <p className="text-sky-400 font-mono text-[10px] md:text-xs uppercase tracking-[0.2em] font-black">Runtime</p>
                   <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black opacity-60">Sessions</p>
                </div>
                <div className="text-5xl md:text-8xl font-black text-white italic tracking-tighter group-hover:scale-105 transition-transform duration-500">{totalSessions}</div>
                <div className="h-1.5 w-full bg-slate-950/50 rounded-full overflow-hidden mt-4">
                   <div className="h-full bg-sky-500/50 w-2/3"></div>
                </div>
              </div>

              {isAdmin && (
                <div className="p-6 md:p-10 premium-glass rounded-[2rem] md:rounded-[3rem] flex flex-col justify-between shadow-2xl group border-none bg-emerald-500/5">
                  <div className="space-y-1">
                     <p className="text-emerald-400 font-mono text-[10px] md:text-xs uppercase tracking-[0.2em] font-black">Liquidity</p>
                     <p className="text-[10px] text-emerald-500/40 uppercase tracking-widest font-black">Treasury</p>
                  </div>
                  <div className="text-4xl md:text-7xl font-black text-white italic tracking-tighter group-hover:scale-105 transition-transform duration-500">
                    ${treasuryBalance.toFixed(2)}
                  </div>
                  
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-[10px] font-mono text-emerald-500/60 uppercase font-black tracking-widest">
                      Gas Reserve: {treasuryEthBalance.toFixed(4)} ETH
                    </span>
                  </div>

                  <div className="h-1.5 w-full bg-emerald-950/50 rounded-full overflow-hidden mt-4">
                     <div className="h-full bg-emerald-500/50 w-full animate-pulse"></div>
                  </div>
                </div>
              )}

              <div className="p-6 md:p-10 premium-glass rounded-[2rem] md:rounded-[3rem] flex flex-col justify-between shadow-2xl group border-none">
                <div className="space-y-1">
                   <p className="text-yellow-400 font-mono text-[10px] md:text-xs uppercase tracking-[0.2em] font-black">Dominance</p>
                   <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black opacity-60">Max Mass</p>
                </div>
                <div className="text-5xl md:text-8xl font-black text-yellow-400 italic tracking-tighter group-hover:scale-105 transition-transform duration-500">{Math.floor(highScore)}</div>
                <div className="h-1.5 w-full bg-slate-950/50 rounded-full overflow-hidden mt-4">
                   <div className="h-full bg-yellow-500/50 w-1/2"></div>
                </div>
              </div>
            </div>

            {/* Primary Protocol Access */}
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
                          <span className="text-yellow-400 font-mono text-[10px] uppercase font-black tracking-[0.3em]">$0.10 WAGER</span>
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
                      Top Up Balance
                    </h4>
                  </div>

                  <div className="space-y-3">
                    {detectedAddresses.filter(d => {
                      if (d.type === 'House Treasury') return false;
                      const isSmart = d.type.toLowerCase().includes('biconomy') || d.type.toLowerCase().includes('simple');
                      if (isSmart && d.bal <= 0) return false;
                      return true;
                    }).length > 0 ? detectedAddresses.filter(d => {
                      if (d.type === 'House Treasury') return false;
                      const isSmart = d.type.toLowerCase().includes('biconomy') || d.type.toLowerCase().includes('simple');
                      if (isSmart && d.bal <= 0) return false;
                      return true;
                    }).map((d, i) => (
                      <div key={i} className="premium-glass p-4 rounded-2xl border-none flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.05] transition-all group/row">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-slate-800/50 flex items-center justify-center text-sky-400 group-hover/row:scale-110 transition-transform">
                            <Wallet className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-white group-hover/row:text-sky-400 transition-colors uppercase tracking-tight truncate">{d.type}</p>
                            <p className="text-[10px] font-mono text-slate-500 truncate max-w-[180px] sm:max-w-none">{d.addr}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between sm:justify-end gap-6 border-t border-white/5 sm:border-none pt-3 sm:pt-0">
                          <div className="text-right">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Available</p>
                            <p className="text-lg font-black text-white italic tracking-tighter leading-none">${d.bal.toFixed(2)}</p>
                          </div>
                          <button 
                            onClick={() => {
                              setTimeout(() => handleTopUp(d.bal, d.type, d.addr), 100);
                            }}
                            className="px-6 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-sky-500/10 transition-all active:scale-95 whitespace-nowrap"
                          >
                            Top Up
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="text-center py-10 premium-glass rounded-2xl border-none">
                        <p className="text-slate-500 text-xs font-black uppercase tracking-widest italic">No compatible wallets found with USDC</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Account Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 bg-white/[0.03] rounded-2xl space-y-3 border-none">
                    <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest font-bold">Operator Node</p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-white font-mono truncate">
                        {userAddress ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : 'Disconnected'}
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
      <div className="fixed bottom-8 right-8 z-[1000] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.95 }}
              className={`pointer-events-auto p-5 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center gap-4 min-w-[320px] ${
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
