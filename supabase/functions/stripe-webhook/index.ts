import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@11.1.0?target=deno"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2022-11-15' })
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  let event
  try {
    const body = await req.text()
    event = stripe.webhooks.constructEvent(body, signature!, webhookSecret!)
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object
      const userId = paymentIntent.metadata.userId
      const amount = paymentIntent.amount / 100 // Convert cents to dollars
      
      if (userId) {
        // Increment user balance and total_injected
        const { data: profile, error: fetchError } = await supabase
          .from('profiles')
          .select('balance, total_injected')
          .eq('id', userId)
          .single()

        if (profile) {
          const newBalance = (profile.balance || 0) + amount
          const newTotalInjected = (profile.total_injected || 0) + amount
          
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ 
              balance: newBalance,
              total_injected: newTotalInjected,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId)
          
          if (updateError) console.error('Update profile error:', updateError)
        } else if (fetchError) {
          console.error('Fetch profile error:', fetchError)
        }
      }
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
