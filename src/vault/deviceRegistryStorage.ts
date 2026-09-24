import AsyncStorage from '@react-native-async-storage/async-storage';

import { REGISTRY_STORAGE_KEY, type RegistryStorage } from './multisigRegistryStorage';

/**
 * Backend appareil de la persistance du registre (v1).
 *
 * Seul fichier de la couche qui importe la dependance native : le reste est pur
 * et testable sans React Native. Une seule cle est utilisee, et son contenu ne
 * contient que des donnees publiques (aucun secret, aucune cle privee).
 */
export const deviceRegistryStorage: RegistryStorage = {
  load: async () => await AsyncStorage.getItem(REGISTRY_STORAGE_KEY),
  save: async (raw: string) => {
    await AsyncStorage.setItem(REGISTRY_STORAGE_KEY, raw);
  },
};