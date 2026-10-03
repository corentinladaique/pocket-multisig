import { StyleSheet, View } from 'react-native';
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
      {/* Fond blanc au niveau racine : les écrans sont tous clairs, donc la
          bande réservée sous la barre de statut (inset haut) reste blanche au
          lieu de laisser apparaître le fond de fenêtre sombre du thème.
          Correction purement JS : aucun fichier natif n'est modifié. */}
      <View style={styles.root}>
        <ConnectScreen />
        {/* Contenu sombre sur fond clair : lisible sur les écrans blancs.
            La couleur de fond de la barre est fournie par styles.root ; un
            statusBarColor natif n'est pas nécessaire. */}
        <StatusBar style="dark" />
      </View>
    </MobileWalletProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#ffffff',
    flex: 1,
  },
});
