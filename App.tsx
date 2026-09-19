import { StatusBar } from 'expo-status-bar';
import { MobileWalletProvider, type WalletAuthorization } from '@wallet-ui/react-native-web3js';

import { APP_IDENTITY, DEVNET_CHAIN, DEVNET_ENDPOINT, createMemoryCache } from './src/config';
import { ConnectScreen } from './src/screens/ConnectScreen';

// Cache en mémoire seule : aucune autorisation ne survit au redémarrage
// (voir src/config.ts). Devnet uniquement, aucune navigation à ce stade.
const authorizationCache = createMemoryCache<WalletAuthorization | undefined>();

export default function App() {
  return (
    <MobileWalletProvider
      cache={authorizationCache}
      chain={DEVNET_CHAIN}
      endpoint={DEVNET_ENDPOINT}
      identity={APP_IDENTITY}
    >
      <ConnectScreen />
      <StatusBar style="auto" />
    </MobileWalletProvider>
  );
}