import './polyfills';


import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { ArbitrumOne } from '@particle-network/chains';
console.log('[Diagnostic] ArbitrumOne:', ArbitrumOne);
import { AuthCoreContextProvider } from '@particle-network/auth-core-modal';
// walletEntryPlugin will be initialized dynamically in App.tsx
import App from './App.tsx';
import './index.css';

// Wallet entry initialization moved to App.tsx

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthCoreContextProvider
      options={{
        projectId: '3a913b51-6884-4638-bd23-fa0d728c7975',
        clientKey: 'cizt9y8vB1VHrGU4lACTDkZg09rkMwYRDi5RcgZZ',
        appId: '8c38a8da-9800-4764-9007-76d512c5163e',
        erc4337: {
          name: 'BICONOMY',
          version: '2.0.0',
        },
        chainConfig: {
          name: 'Arbitrum',
          id: 42161,
        },
        // Enable external wallet support (MetaMask, Rainbow, etc.)
        wallet: {
          visible: false,
          themeType: 'dark',
          customStyle: {
            primaryColor: '#0ea5e9',
          }
        },
        // Allow these social and external methods
        authTypes: ['google', 'email', 'apple', 'twitter', 'github'],
      }}
    >
      <App />
    </AuthCoreContextProvider>
  </StrictMode>,
);
