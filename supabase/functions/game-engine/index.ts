import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { action, payload } = await req.json();
    
    // Auth Logic: Prefer Supabase JWT, fallback to payload userId for Particle users
    let userId = payload.userId;
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      if (token && token !== 'undefined') {
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
        if (!authError && user) {
          userId = user.id;
        }
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: No user identified' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (action === 'START_SESSION') {
      // 1. Check balance
      const { data: profile, error: fetchError } = await supabaseClient
        .from('profiles')
        .select('balance, total_sessions')
        .eq('id', userId)
        .single();

      if (fetchError || !profile) throw new Error('Profile not found');
      
      const isTest = payload.isTest || false;
      if (!isTest && profile.balance < 0.10) throw new Error('Insufficient balance');

      const newBalance = isTest ? profile.balance : profile.balance - 0.10;

      // 2. Update balance and create session
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
      
      // 1. If it's a drop, claim it first
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

      // 2. Update session collected money
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

      // 3. Update profile balance
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

    if (action === 'DIE') {
      const { x, y, sessionEarnings } = payload;
      
      // 1. Get profile and active session
      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('balance, wallet_address')
        .eq('id', userId)
        .single();
        
      if (profileError) throw profileError;

      // Calculate Economic Penalty: 50% of SESSION EARNINGS
      const earnings = sessionEarnings || 0;
      const penalty = earnings * 0.5;
      const playerPayout = earnings - penalty;
      
      const newBalance = Math.max(0, (Number(profile.balance) || 0) - penalty);
      
      const entryFeeDrop = 0.10 * 0.5; 
      const houseRake = (penalty + entryFeeDrop) * 0.05;
      const totalToDrop = Math.max(0, (penalty + entryFeeDrop) - houseRake);

      // 2. Update DB balance and close session
      await supabaseClient
        .from('profiles')
        .update({ balance: newBalance })
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

      // 3. Create persistent drops for redistribution
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

      // 4. THE MAGIC: Automatic On-Chain Payout
      let txHash = null;
      if (playerPayout > 0 && profile.wallet_address) {
        try {
          const { ethers } = await import("https://esm.sh/ethers@6.10.0");
          const provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
          const relayerKey = Deno.env.get('RELAYER_PRIVATE_KEY');
          
          if (relayerKey) {
            const wallet = new ethers.Wallet(relayerKey, provider);
            const usdcAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
            const usdcAbi = ["function transfer(address to, uint256 amount) public returns (bool)"];
            const usdcContract = new ethers.Contract(usdcAddress, usdcAbi, wallet);
            
            // Convert to 6 decimals
            const amount = ethers.parseUnits(playerPayout.toFixed(6), 6);
            const tx = await usdcContract.transfer(profile.wallet_address, amount);
            txHash = tx.hash;
            console.log(`Automatic payout sent: ${txHash} for ${playerPayout} USDC`);
          }
        } catch ( payoutErr ) {
          console.error('Relayer Payout Failed:', payoutErr);
        }
      }

      return new Response(JSON.stringify({ penalty, newBalance, payoutSent: !!txHash, txHash }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
