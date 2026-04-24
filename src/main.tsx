import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { AuthCoreContextProvider } from '@particle-network/auth-core-modal';
import { walletEntryPlugin } from '@particle-network/wallet';
import App from './App.tsx';
import './index.css';

walletEntryPlugin.init(
  {
    projectId: '3a913b51-6884-4638-bd23-fa0d728c7975',
    clientKey: 'cizt9y8vB1VHrGU4lACTDkZg09rkMwYRDi5RcgZZ',
    appId: '8c38a8da-9800-4764-9007-76d512c5163e',
  },
  {
    walletEntranceStyle: {
      pointerEvents: 'none',
      opacity: 0,
      width: 0,
      height: 0,
      display: 'none',
    }
  }
);

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
        wallet: {
          visible: false,
          themeType: 'dark',
          customStyle: {
            primaryColor: '#0ea5e9',
          }
        }
      }}
    >
      <App />
    </AuthCoreContextProvider>
  </StrictMode>,
);
