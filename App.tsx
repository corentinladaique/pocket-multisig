import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MobileWalletProvider, type WalletAuthorization } from '@wallet-ui/react-native-web3js';

import { APP_IDENTITY, DEVNET_CHAIN, DEVNET_ENDPOINT, createMemoryCache } from './src/config';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { colors } from './src/ui/theme';

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
      {/* Fond sombre au niveau racine (thème UI V2 « Seeker style ») : la bande
          réservée sous la barre de statut reste cohérente avec les écrans.
          Correction purement JS : aucun fichier natif n'est modifié. */}
      <View style={styles.root}>
        <ConnectScreen />
        {/* Contenu clair sur fond sombre : lisible sur les écrans V2. */}
        <StatusBar style="light" />
      </View>
    </MobileWalletProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
