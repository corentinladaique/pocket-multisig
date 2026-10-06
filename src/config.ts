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
 * `name` est ce que le wallet AFFICHE à l'utilisateur (accorde avec le label du
 * lanceur, `app.json` -> name).
 * `uri` identifie l'application. ATTENTION : le wallet en affiche l'HOTE, pas
 * le chemin — `.../github.com/...` faisait apparaitre « github.com » comme nom
 * d'application. On pointe donc l'hote qui nous appartient
 * (`<utilisateur>.github.io`, servi par GitHub Pages), et non plus le domaine
 * de demonstration de la bibliotheque.
 * La bibliotheque ne verifie QUE le schema de cette URI
 * (`assertValidIdentityUri`), et ne la lit jamais sur le reseau.
 * Pas d'`icon` ici pour ne pas declencher une verification reseau.
 */
export const APP_IDENTITY: AppIdentity = {
  name: 'Multisig',
  uri: 'https://corentinladaique.github.io/pocket-multisig/',
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