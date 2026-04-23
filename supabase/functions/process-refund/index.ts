import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { stripePaymentIntentId, amount, reason } = await req.json()

    if (stripePaymentIntentId) {
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
        apiVersion: '2023-10-16',
      })

      // Stripe expects amount in cents
      const refund = await stripe.refunds.create({
        payment_intent: stripePaymentIntentId,
        amount: Math.round(amount * 100),
        reason: reason === 'Duplicate order' ? 'duplicate' : 'requested_by_customer',
      })

      return new Response(JSON.stringify({ success: true, refund }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    throw new Error('No valid payment ID provided')
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
