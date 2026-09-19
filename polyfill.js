// Polyfill natif requis AVANT tout import de bibliothèque Solana.
// react-native-quick-crypto installe un `crypto` (subtle + getRandomValues)
// compatible avec les attentes de @solana/web3.js v1 et de ses dépendances.
// Ce fichier doit rester le premier import de l'entry point (index.ts).
import { install } from 'react-native-quick-crypto';

install();
