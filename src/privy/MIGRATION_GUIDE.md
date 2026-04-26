# Privy Migration Guide

## When Ready to Switch

1. Replace `src/main.tsx` with `src/privy/main.privy.tsx`
2. Replace `src/App.tsx` with `src/privy/App.privy.tsx`  
3. Run: `npm uninstall @particle-network/aa @particle-network/auth-core @particle-network/auth-core-modal @particle-network/chains @particle-network/wallet`
4. Privy SDK is already installed (`@privy-io/react-auth`)
5. Update `vite.config.ts` — remove `vite-plugin-node-polyfills`

## Key Differences
- Auth: Privy `usePrivy()` replaces Particle `useConnect()/useAuthCore()/useEthereum()`
- Wallet: Privy auto-creates embedded wallet on login (Arbitrum)
- Withdrawals: Users **request** withdrawal → row in `withdrawal_requests` table → admin processes
- Treasury wallet: `0x8733E2065B72121cC9a91E5471D2cc1075D050ef`
- Balance: Virtual credits in Supabase, no on-chain scanning

## Database
- `withdrawal_requests` table already created via migration
- Columns: id, user_id, amount, wallet_address, status (pending/processing/completed/rejected), tx_hash, created_at, processed_at
