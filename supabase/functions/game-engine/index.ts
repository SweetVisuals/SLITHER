import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { ethers } from "https://esm.sh/ethers@6.10.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

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

    if (action === 'START_SESSION') {
      const { data: profile, error: fetchError } = await supabaseClient
        .from('profiles')
        .select('balance, total_sessions')
        .eq('id', userId)
        .single();

      if (fetchError || !profile) throw new Error('Profile not found');
      
      const isTest = payload.isTest || false;
      if (!isTest && profile.balance < 0.10) throw new Error('Insufficient balance');

      const newBalance = isTest ? profile.balance : Number(profile.balance) - 0.10;

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
          buy_in: isTest ? 0 : 0.10,
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
        .select('balance, wallet_address, last_wallet_balance')
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

      let txHash = null;
      if (profile.wallet_address) {
        try {
          const relayerKey = Deno.env.get('RELAYER_PRIVATE_KEY');
          const projectId = Deno.env.get('PARTICLE_PROJECT_ID');
          const clientKey = Deno.env.get('PARTICLE_CLIENT_KEY');
          
          if (relayerKey && projectId && clientKey) {
            const usdcAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
            const amountHex = "0x" + Math.floor(finalWithdrawAmount * 10**6).toString(16);
            const data = "0xa9059cbb" + 
                         profile.wallet_address.replace("0x", "").padStart(64, "0") + 
                         amountHex.replace("0x", "").padStart(64, "0");

            const response = await fetch(`https://api.particle.network/server/rpc?chainId=42161&projectUuid=${projectId}&projectKey=${clientKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "particle_aa_sendUserOperation",
                params: [{
                  name: "BICONOMY",
                  version: "2.0.0",
                  owner: new ethers.Wallet(relayerKey).address
                }, {
                  tx: { to: usdcAddress, value: "0x0", data: data },
                  feeQuote: "native"
                }]
              })
            });

            const res = await response.json();
            if (res.result && res.result.userOpHash) {
               txHash = res.result.userOpHash;
               console.log(`[GameEngine] Withdrawal success, tx: ${txHash}`);
            } else {
               console.error('[GameEngine] Particle AA Error:', JSON.stringify(res.error));
            }
          } else {
            console.warn('[GameEngine] Missing environment variables for payout');
          }
        } catch (err) {
          console.error('[GameEngine] Payout logic crash:', err.message);
        }
      } else {
        console.warn('[GameEngine] No wallet address found for user profile');
      }

      if (txHash) {
        const { error: updateError } = await supabaseClient
          .from('profiles')
          .update({ 
            balance: currentBalance - finalWithdrawAmount,
            last_wallet_balance: (Number(profile.last_wallet_balance) || 0) + finalWithdrawAmount
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

    if (action === 'DIE') {
      const { x, y, sessionEarnings } = payload;
      
      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('balance, wallet_address, last_wallet_balance')
        .eq('id', userId)
        .single();
        
      if (profileError) throw profileError;

      const earnings = Number(sessionEarnings) || 0;
      const penalty = earnings * 0.5;
      const playerPayout = earnings - penalty;
      
      let currentBalance = Number(profile.balance) || 0;
      let newBalance = Math.max(0, currentBalance - penalty);
      let newLastWalletBalance = Number(profile.last_wallet_balance) || 0;
      
      const entryFeeDrop = 0.50; 
      const houseRake = (penalty + entryFeeDrop) * 0.05;
      const totalToDrop = Math.max(0, (penalty + entryFeeDrop) - houseRake);

      let txHash = null;
      if (playerPayout > 0 && profile.wallet_address) {
        try {
          const relayerKey = Deno.env.get('RELAYER_PRIVATE_KEY');
          const projectId = Deno.env.get('PARTICLE_PROJECT_ID');
          const clientKey = Deno.env.get('PARTICLE_CLIENT_KEY');
          
          if (relayerKey && projectId && clientKey) {
            const usdcAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
            const amountHex = "0x" + Math.floor(playerPayout * 10**6).toString(16);
            const data = "0xa9059cbb" + 
                         profile.wallet_address.replace("0x", "").padStart(64, "0") + 
                         amountHex.replace("0x", "").padStart(64, "0");

            const response = await fetch(`https://api.particle.network/server/rpc?chainId=42161&projectUuid=${projectId}&projectKey=${clientKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "particle_aa_sendUserOperation",
                params: [{
                  name: "BICONOMY",
                  version: "2.0.0",
                  owner: new ethers.Wallet(relayerKey).address
                }, {
                  tx: { to: usdcAddress, value: "0x0", data: data },
                  feeQuote: "native"
                }]
              })
            });

            const res = await response.json();
            if (res.result && res.result.userOpHash) {
               txHash = res.result.userOpHash;
               newBalance = Math.max(0, newBalance - playerPayout);
               newLastWalletBalance += playerPayout;
            }
          }
        } catch (err) {
          console.error('[GameEngine] Auto-payout error:', err.message);
        }
      }

      await supabaseClient
        .from('profiles')
        .update({ 
          balance: newBalance,
          last_wallet_balance: newLastWalletBalance
        })
        .eq('id', userId);

      await supabaseClient
        .from('sessions')
        .update({ 
            status: 'finished', 
            finished_at: new Date().toISOString(),
            collected_money: earnings
        })
        .eq('user_id', userId)
        .eq('status', 'active');

      if (totalToDrop > 0) {
        const drops = [];
        const dropCount = Math.min(10, Math.max(1, Math.floor(totalToDrop / 0.05))); 
        const valuePerDrop = totalToDrop / dropCount;

        for (let i = 0; i < dropCount; i++) {
          const offsetX = (Math.random() - 0.5) * 150;
          const offsetY = (Math.random() - 0.5) * 150;
          drops.push({
            money_value: valuePerDrop,
            x: x + offsetX,
            y: y + offsetY,
            created_by: userId
          });
        }
        await supabaseClient.from('drops').insert(drops);
      }

      return new Response(JSON.stringify({ penalty, newBalance, payoutSent: !!txHash, txHash }), {
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

