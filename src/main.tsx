import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { AuthCoreContextProvider } from '@particle-network/auth-core-modal';
import { walletEntryPlugin } from '@particle-network/wallet';
import { Buffer } from 'buffer';
import App from './App.tsx';
import './index.css';

window.Buffer = window.Buffer || Buffer;
if (typeof window !== 'undefined') {
  window.process = window.process || { env: {} } as any;
}

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
        wallet: {
          visible: false
        }
      }}
    >
      <App />
    </AuthCoreContextProvider>
  </StrictMode>,
);
