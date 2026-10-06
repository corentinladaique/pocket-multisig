import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { CardsMark } from './CardsMark';

/** Boite de la marque : 330 dp. Dans cette boite, la CARTE fermee mesure
 *  exactement 120 dp (meme cadre que `splashscreen_mark` natif) et l'eventail
 *  s'ouvre dedans — donc aucun saut au passage splash -> rideau. */
const MARK_SIZE = 330;

/** Fond de lancement = fond de l'app : la transition ne se voit pas (comme le
 *  Wallet natif, dont le splash est de la couleur de l'app). */
const BRAND_BG = '#08110F';

/** Duree d'affichage avant le fondu de sortie (ms). */
const HOLD_MS = 1250;
const FADE_MS = 380;

/**
 * Rideau de lancement : reprend EXACTEMENT le fond du splash natif (degrade
 * `#EEF8F6 -> #A3D9D2`) puis joue l'ouverture de l'eventail avant de s'effacer.
 *
 * Le splash natif est un drawable statique : il ne peut rien animer. On le
 * prolonge donc cote JS des que le bundle est pret, ce qui evite le
 * « logo qui clignote » qu'on avait avec l'image de gabarit precedente.
 */
export function LaunchSplash({ onDone }: { onDone: () => void }) {
  const fade = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.delay(HOLD_MS),
      Animated.timing(fade, {
        duration: FADE_MS,
        easing: Easing.out(Easing.quad),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) {
        setGone(true);
        onDone();
      }
    });
    return () => anim.stop();
  }, [fade, onDone]);

  if (gone) {
    return null;
  }

  return (
    <Animated.View pointerEvents="none" style={[styles.fill, { opacity: fade }]}>
      <CardsMark size={MARK_SIZE} solana />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // `StyleSheet.absoluteFillObject` est absent des types RN 0.86 : on detaille.
  // Fond de lancement = fond de l'app : enchainement invisible.
  fill: {
    alignItems: 'center',
    backgroundColor: BRAND_BG,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
