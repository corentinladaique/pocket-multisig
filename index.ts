// Entry point. L'ordre des imports est contractuel :
// 1. polyfill.js  -> crypto natif disponible
// 2. App          -> le reste de l'application (et toute librairie Solana)
// Ne jamais réordonner ces deux imports.
import './polyfill';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
