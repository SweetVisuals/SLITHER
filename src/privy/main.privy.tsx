/**
 * PRIVY MIGRATION - main.tsx replacement
 * 
 * When ready to switch:
 * 1. Copy this file's content into src/main.tsx
 * 2. Copy App.privy.tsx content into src/App.tsx
 * 3. Run: npm uninstall @particle-network/aa @particle-network/auth-core @particle-network/auth-core-modal @particle-network/chains @particle-network/wallet
 * 4. Privy is already installed (@privy-io/react-auth)
 * 5. Remove vite-plugin-node-polyfills from vite.config.ts (Privy doesn't need them)
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { arbitrum } from 'viem/chains';
import App from './App.tsx';
import './index.css';

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID || '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#0ea5e9',
          logo: undefined,
        },
        loginMethods: ['email', 'google'],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
        defaultChain: arbitrum,
        supportedChains: [arbitrum],
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
);
