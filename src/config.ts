// Constantes gelées de l'application. DEVNET uniquement (SECURITY.md §1).
// Aucune de ces valeurs ne doit être modifiée sans instruction explicite.
import type { AppIdentity, Cache } from '@wallet-ui/react-native-web3js';

/**
 * Cluster MWA. Doit valoir 'solana:devnet' : verrou principal anti-mainnet.
 * Le type `Chain` du protocole vaut `IdentifierString | Cluster` ; on s'appuie
 * sur le littéral pour ne pas importer le paquet MWA en dépendance directe.
 */
export const DEVNET_CHAIN = 'solana:devnet' as const;

/** RPC public devnet. Non appelé à cette étape (aucune requête réseau). */
export const DEVNET_ENDPOINT = 'https://api.devnet.solana.com';

/**
 * Identité présentée au wallet lors de l'autorisation.
 * `uri` doit être absolu : les wallets vérifient le Digital Asset Links de ce
 * domaine. Pas d'`icon` ici pour ne pas déclencher une vérification réseau.
 */
export const APP_IDENTITY: AppIdentity = {
  name: 'Pocket Multisig',
  uri: 'https://paperclip.ing',
};

/**
 * Cache d'autorisation en mémoire seule.
 * Passé explicitement au provider pour éviter le cache persistant par défaut
 * (AsyncStorage) : à cette étape, aucune autorisation ne doit survivre au
 * redémarrage de l'application.
 */
export function createMemoryCache<T>(initial: T | undefined = undefined): Cache<T> {
  let value = initial;
  return {
    async clear(): Promise<void> {
      value = undefined;
    },
    async get(): Promise<T | undefined> {
      return value;
    },
    async set(next: T): Promise<void> {
      value = next;
    },
  };
}