import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { ethers } from "https://esm.sh/ethers@6.10.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const PRIMARY_WALLET = "0xf7dAd3bB9E89502d2e2ea478659875063b4f3F7A";
const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_E_ADDRESS = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";

async function getUSDCBalance(address: string) {
  if (!address) return 0;
  try {
    const provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
    const abi = ["function balanceOf(address) view returns (uint256)"];
    const native = new ethers.Contract(USDC_ADDRESS, abi, provider);
    const bridged = new ethers.Contract(USDC_E_ADDRESS, abi, provider);
    
    const [nBal, bBal] = await Promise.all([
      native.balanceOf(address).catch(() => 0n),
      bridged.balanceOf(address).catch(() => 0n)
    ]);
    
    return Number(nBal + bBal) / 1e6;
  } catch (e) {
    console.error(`[BalanceCheck] Error for ${address}:`, e.message);
    return 0;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { action, payload } = body;
    console.log(`[GameEngine] Action: ${action}`, payload);
    
    // Auth Logic: Prefer Supabase JWT, fallback to payload userId for Particle users
    let userId = payload?.userId;
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      if (token && token !== 'undefined') {
        try {
          const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
          if (!authError && user) {
            userId = user.id;
            console.log(`[GameEngine] Identified user via JWT: ${userId}`);
          }
        } catch (e) {
          console.error('[GameEngine] Auth error:', e.message);
        }
      }
    }

    if (!userId) {
      console.error('[GameEngine] No user ID provided');
      return new Response(JSON.stringify({ error: 'Unauthorized: No user identified' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // --- ADMIN SYSTEM RESET ---
    if (action === 'SYSTEM_RESET') {
      const targetUserId = payload?.targetUserId;
      const forcedBal = payload?.forceMatchBalance;

      let query = supabaseClient.from('profiles').select('id, wallet_address, balance');
      if (targetUserId) query = query.eq('id', targetUserId);

      const { data: profiles, error: pErr } = await query;
      if (pErr) throw pErr;

      const results = [];
      for (const profile of profiles) {
        try {
          // Use forced balance if provided for a specific user, otherwise fetch on-chain
          const onChainBal = (targetUserId === profile.id && forcedBal !== undefined) 
            ? forcedBal 
            : await getUSDCBalance(profile.wallet_address);
          
          if (onChainBal !== null) {
            // Ensure the house wallet doesn't inflate a player profile
            const isHouseWallet = profile.wallet_address?.toLowerCase() === PRIMARY_WALLET.toLowerCase();
            const finalBal = isHouseWallet ? 0 : onChainBal;

            const { error: uErr } = await supabaseClient
              .from('profiles')
              .update({
                balance: finalBal,
                last_wallet_balance: finalBal,
                total_sessions: 0,
                total_earnings: 0,
                total_injected: finalBal 
              })
              .eq('id', profile.id);
            
            if (!uErr) results.push({ id: profile.id, success: true });
          }
        } catch (e) {
          results.push({ id: profile.id, success: false, error: e.message });
        }
      }

      return new Response(JSON.stringify({ 
        message: 'System reset complete', 
        processed: results.length,
        details: results 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'START_SESSION') {
      const { data: profile, error: fetchError } = await supabaseClient
        .from('profiles')
        .select('balance, total_sessions')
        .eq('id', userId)
        .single();

      if (fetchError || !profile) throw new Error('Profile not found');
      
      const isTest = payload.isTest || false;
      if (!isTest && profile.balance < 0.25) throw new Error('Insufficient balance');

      const newBalance = isTest ? profile.balance : Number(profile.balance) - 0.25;

      const { error: updateError } = await supabaseClient
        .from('profiles')
        .update({ 
          balance: newBalance,
          total_sessions: (profile.total_sessions || 0) + 1 
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      const { data: session, error: sessionError } = await supabaseClient
        .from('sessions')
        .insert([{
          user_id: userId,
          buy_in: isTest ? 0 : 0.25,
          status: 'active',
          metadata: { isTest }
        }])
        .select()
        .single();

      if (sessionError) throw sessionError;

      return new Response(JSON.stringify({ newBalance, sessionId: session.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'COLLECT') {
      const { amount, dropId } = payload;
      
      if (dropId) {
        const { data: drop, error: dropError } = await supabaseClient
            .from('drops')
            .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
            .eq('id', dropId)
            .is('claimed_by', null)
            .select()
            .single();
        
        if (dropError || !drop) {
          return new Response(JSON.stringify({ error: 'Drop already claimed' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      const { data: activeSession } = await supabaseClient
        .from('sessions')
        .select('id, collected_money')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (activeSession) {
        await supabaseClient
          .from('sessions')
          .update({ collected_money: (Number(activeSession.collected_money) || 0) + amount })
          .eq('id', activeSession.id);
      }

      const { data: profile, error: fetchError } = await supabaseClient
        .from('profiles')
        .select('balance')
        .eq('id', userId)
        .single();

      if (fetchError) throw fetchError;

      const newBalance = (Number(profile.balance) || 0) + amount;
      const { error: updateError } = await supabaseClient
        .from('profiles')
        .update({ balance: newBalance })
        .eq('id', userId);

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ newBalance }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'WITHDRAW') {
      const { amount } = payload;
      if (typeof amount !== 'number' || amount <= 0) {
        throw new Error(`Invalid withdrawal amount: ${amount}`);
      }

      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('balance, wallet_address, total_withdrawn')
        .eq('id', userId)
        .single();
        
      if (profileError || !profile) throw new Error(`Profile not found for ID: ${userId}`);
      
      const currentBalance = Number(profile.balance);
      const EPSILON = 0.000001; // Handle tiny floating point diffs
      
      if (currentBalance + EPSILON < amount) {
        throw new Error(`Insufficient credits: Have ${currentBalance}, requested ${amount}`);
      }

      // Cap withdrawal at actual balance if precision error occurred
      const finalWithdrawAmount = Math.min(amount, currentBalance);
      console.log(`[GameEngine] Processing withdrawal of ${finalWithdrawAmount} for ${userId}`);

      // Payout Helper (EOA Transfer)
      const sendPayout = async (to: string, amount: number) => {
        try {
          const relayerKey = Deno.env.get('RELAYER_PRIVATE_KEY');
          if (!relayerKey) {
            console.warn('[GameEngine] No RELAYER_PRIVATE_KEY found');
            return null;
          }

          const provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
          const wallet = new ethers.Wallet(relayerKey, provider);
          
          const usdcAbi = ["function transfer(address to, uint256 amount) returns (bool)"];
          const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, wallet);

          const amountUnits = ethers.parseUnits(amount.toFixed(6), 6);
          console.log(`[GameEngine] EOA Payout: ${amount} USDC from ${wallet.address} to ${to}`);
          
          const tx = await usdcContract.transfer(to, amountUnits);
          console.log(`[GameEngine] TX Sent: ${tx.hash}`);
          return tx.hash;
        } catch (err) {
          console.error('[GameEngine] EOA Payout failed:', err.message);
          return null;
        }
      };

      let txHash = null;
      const destinationAddress = payload?.targetAddress || profile.wallet_address;
      
      if (destinationAddress) {
        txHash = await sendPayout(destinationAddress, finalWithdrawAmount);
      } else {
        console.warn('[GameEngine] No destination wallet address found');
      }

      if (txHash) {
        const { error: updateError } = await supabaseClient
          .from('profiles')
          .update({ 
            balance: currentBalance - finalWithdrawAmount,
            total_withdrawn: (Number(profile.total_withdrawn) || 0) + finalWithdrawAmount
          })
          .eq('id', userId);
        if (updateError) throw updateError;
      }

      return new Response(JSON.stringify({ 
        payoutSent: !!txHash, 
        txHash, 
        newBalance: txHash ? currentBalance - finalWithdrawAmount : currentBalance 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'DEPOSIT') {
      const { txHash } = payload;
      if (!txHash) throw new Error('No transaction hash provided');

      console.log(`[GameEngine] Verifying deposit: ${txHash} for user ${userId}`);
      const provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
      
      let totalDeposited = 0;
      let receipt = null;
      let retries = 15; // Increased retries for slow bundlers
      
      // Retry loop for receipt - direct and robust
      while (retries > 0 && !receipt) {
        try {
          receipt = await provider.getTransactionReceipt(txHash);
          if (!receipt) {
            console.log(`[GameEngine] Receipt for ${txHash} not found yet. Retrying... (${retries} left)`);
            retries--;
            if (retries > 0) await new Promise(resolve => setTimeout(resolve, 3000));
          }
        } catch (e) {
          console.warn(`[GameEngine] Error fetching receipt ${txHash}:`, e.message);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      if (receipt && receipt.status === 1) {
        console.log(`[GameEngine] Found receipt with ${receipt.logs.length} logs`);
        const relevantLogs = receipt.logs.filter(l => 
          l.address.toLowerCase() === USDC_ADDRESS.toLowerCase() || 
          l.address.toLowerCase() === USDC_E_ADDRESS.toLowerCase()
        );
        console.log(`[GameEngine] Found ${relevantLogs.length} relevant USDC logs`);

        const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
        
        for (const log of relevantLogs) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed && parsed.name === 'Transfer') {
              const toAddress = parsed.args.to.toLowerCase();
              const fromAddress = parsed.args.from.toLowerCase();
              const value = parsed.args.value;
              const valNum = Number(value) / 1e6;
              
              console.log(`[GameEngine] Log detail: From ${fromAddress} To ${toAddress} Val ${valNum}`);
              
              if (toAddress === PRIMARY_WALLET.toLowerCase()) {
                console.log(`[GameEngine] MATCH! Valid deposit of ${valNum} USDC to treasury detected`);
                totalDeposited += valNum;
              }
            }
          } catch (e) {
            console.warn(`[GameEngine] Failed to parse log:`, e.message);
          }
        }
      } else if (receipt && receipt.status !== 1) {
        console.error(`[GameEngine] Transaction REVERTED on chain: ${txHash}`);
        throw new Error('transaction reverted');
      }

      if (totalDeposited <= 0) {
        console.warn(`[GameEngine] Deposit verification failed for ${txHash}. Total detected: ${totalDeposited}`);
        throw new Error('not detected yet');
      }

      // Award credits
      console.log(`[GameEngine] Awarding ${totalDeposited} credits to user ${userId}`);
      const { data: profile, error: fetchError } = await supabaseClient
        .from('profiles')
        .select('balance, total_injected')
        .eq('id', userId)
        .single();
      
      if (fetchError || !profile) {
        console.error(`[GameEngine] Profile not found for ${userId}. Error:`, fetchError?.message);
        throw new Error('profile not found');
      }

      const newBal = (Number(profile.balance) || 0) + totalDeposited;
      const newInjected = (Number(profile.total_injected) || 0) + totalDeposited;
      
      const { error: updateError, count } = await supabaseClient
        .from('profiles')
        .update({ 
          balance: newBal, 
          total_injected: newInjected 
        })
        .eq('id', userId);

      if (updateError) {
        console.error(`[GameEngine] DB Update failed for ${userId}:`, updateError.message);
        throw new Error('database update failed');
      }

      console.log(`[GameEngine] Success! New balance for ${userId}: ${newBal}`);
      return new Response(JSON.stringify({ success: true, added: totalDeposited, newBalance: newBal }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'DIE') {
      const { x, y, sessionEarnings } = payload;
      
      // 1. Fetch active session and profile simultaneously for efficiency
      const [sessionRes, profileRes] = await Promise.all([
        supabaseClient
          .from('sessions')
          .select('id, buy_in')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single(),
        supabaseClient
          .from('profiles')
          .select('balance')
          .eq('id', userId)
          .single()
      ]);
        
      if (profileRes.error) throw profileRes.error;

      const earnings = Number(sessionEarnings) || 0;
      const buyIn = Number(sessionRes.data?.buy_in) || 0;
      
      // 2. Calculate Session Worth (What the player "has" in the game)
      // Wager (already deducted) + Earnings (already added)
      const sessionWorth = buyIn + earnings;
      
      // 3. Penalty is 50% of the session worth
      const penalty = sessionWorth * 0.50;
      const totalToDrop = sessionWorth * 0.50;
      
      // 4. Update Profile Balance
      const currentBalance = Number(profileRes.data.balance) || 0;
      const newBalance = Math.max(0, currentBalance - penalty);

      console.log(`[GameEngine] DIE: Wager ${buyIn}, Earnings ${earnings}, Worth ${sessionWorth}, Penalty ${penalty}, New Balance ${newBalance}`);

      const { error: updateError } = await supabaseClient
        .from('profiles')
        .update({ 
          balance: newBalance
        })
        .eq('id', userId);

      if (updateError) {
        console.error(`[GameEngine] DIE Balance update failed:`, updateError.message);
      }

      if (sessionRes.data) {
        const { error: sessionUpdateError } = await supabaseClient
          .from('sessions')
          .update({ 
              status: 'finished', 
              finished_at: new Date().toISOString(),
              collected_money: earnings
          })
          .eq('id', sessionRes.data.id);
        
        if (sessionUpdateError) {
          console.error(`[GameEngine] DIE Session update failed:`, sessionUpdateError.message);
        }
      }

      // 5. Handle redistribution drops - Persist to database
      if (totalToDrop > 0) {
        const drops = [];
        const dropCount = Math.min(12, Math.max(1, Math.floor(totalToDrop / 0.05))); 
        const valuePerDrop = totalToDrop / dropCount;

        for (let i = 0; i < dropCount; i++) {
          const offsetX = (Math.random() - 0.5) * 160;
          const offsetY = (Math.random() - 0.5) * 160;
          drops.push({
            money_value: valuePerDrop,
            x: Math.max(50, Math.min(3950, x + offsetX)),
            y: Math.max(50, Math.min(3950, y + offsetY)),
            created_by: userId
          });
        }
        
        console.log(`[GameEngine] Inserting ${drops.length} drops for total $${totalToDrop}`);
        await supabaseClient.from('drops').insert(drops);
      }

      return new Response(JSON.stringify({ 
        penalty, 
        newBalance, 
        payoutSent: false,
        message: `Penalty of $${penalty.toFixed(4)} deducted. Final balance: $${newBalance.toFixed(4)}`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[GameEngine] Fatal Error:', error.message);
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

