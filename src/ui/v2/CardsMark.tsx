import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Géométrie relevée sur le SVG de marque (viewBox 512) : cadrage d'une carte
 * et pivot de rotation, qui est le COIN BAS-GAUCHE de la carte — exactement le
 * centre de rotation du `<animateTransform>`.
 * `PIVOT` est exprimé par rapport au COIN HAUT-GAUCHE du cadrage (ce qu'attend
 * `transformOrigin`), pas par rapport au centre.
 */
const VIEWBOX = 512;
/** Le viewBox du SVG n'est pas centré sur l'artwork : on le recentre ici. */
const CENTER = { x: -38.52, y: -47.55 } as const;
const CARD_BOX = { h: 187.39, w: 262.08 } as const;
/** Cadrage de la carte dans la boîte (viewBox), recentré sur l'artwork. */
const CARD_AT = { x: 163.48 + CENTER.x, y: 209.85 + CENTER.y } as const;
/** Pivot de rotation = coin bas-gauche de la carte, DANS le cadrage. */
const PIVOT = { x: 8.52, y: 178.87 } as const;
/**
 * Demi-côté du carré tournant : la distance du pivot au coin opposé de la
 * carte, donc tout point de la carte reste dans le carré quel que soit l'angle.
 *
 * Tourner ce carré autour de SON CENTRE revient EXACTEMENT à tourner la carte
 * autour du pivot. C'est indispensable : le driver natif d'`Animated` n'honore
 * pas `transformOrigin` (vérifié sur le Seeker — l'animation ne jouait pas du
 * tout et la marque restait fermée), et l'émulation translate/rotate/translate
 * décrochait les cartes (ordre de composition non garanti).
 */
const PIVOT_RADIUS = Math.sqrt(CARD_BOX.w ** 2 + CARD_BOX.h ** 2);
/** Rayon de la tuile : même proportion que le masque du launcher (24,5 %). */
const TILE_RADIUS_RATIO = 0.245;

/**
 * Une image par carte, rastérisée du SVG de marque (rotation à 0 ; lignes
 * d'onde, contours et pastille inclus). Aucun paquet SVG n'est nécessaire : la
 * règle « aucun paquet SVG » du projet tient, et l'animation passe par le
 * driver NATIF (transform de style), donc à 60 fps.
 */
const CARDS = [
  { angle: 36, source: require('../../../assets/brand-card-back.png') as number },
  { angle: 18, source: require('../../../assets/brand-card-mid.png') as number },
  { angle: 0, source: require('../../../assets/brand-card-front.png') as number },
] as const;

/**
 * Variante « couleurs du wallet » : les cartes sont rempliees d'un degrade
 * bleu-vert (gris-bleu -> sarcelle -> turquoise) et la VAGUE et le POINT sont en
 * CREUX (le fond noir passe au travers). Fichiers volontairement NOMMES
 * `-wallet` (et non reutilises sous un ancien nom) : Metro met en cache les
 * assets par chemin, donc renommer est ce qui garantit que l'application
 * embarque bien les nouvelles images.
 */
const SOLANA_CARDS = [
  { angle: 36, source: require('../../../assets/brand-card-back-wallet.png') as number },
  { angle: 18, source: require('../../../assets/brand-card-mid-wallet.png') as number },
  { angle: 0, source: require('../../../assets/brand-card-front-wallet.png') as number },
] as const;

/**
 * Fond menthe franc, commun au rideau ET à la tuile. On n'utilise PLUS l'image
 * du dégradé : sur le Seeker elle ne s'affichait pas (seul l'aplat de secours
 * apparaissait, d'ou l'impression de « fond blanc » signalee par Corentin).
 * Un aplat est exactement ce qu'il demande et ne depend d'aucun rendu d'image.
 */
const BRAND_BG = '#A3D9D2';

/**
 * Dégradé de la tuile, identique a celui de l'icône du launcher (mesure sur les
 * icônes natives : #E7F8F8 -> #9FDEDC). Construit en BANDES de `View` plutot
 * qu'avec une image : aucune dépendance, aucun risque de rendu (l'image du
 * dégradé ne s'affichait pas de façon fiable sur le Seeker).
 */
const TILE_GRADIENT = { from: [0xe7, 0xf8, 0xf8], to: [0x9f, 0xde, 0xdc] };
const TILE_BANDS = 24;

/** Mélange linéaire de deux couleurs RGB, t de 0 à 1. */
function mix(from: number[], to: number[], t: number): string {
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Cycle du SVG de marque : ouverture jusqu'à 35 %, maintien, fermeture à 65 %. */
const CYCLE_MS = 3600;
const OPEN_AT = 0.35;
/** Ouverture seule (rideau de lancement) : volontairement plus court. */
const OPEN_MS = 900;

export type CardsMarkProps = {
  size: number;
  /** true = cycle complet en boucle (écran de connexion) ; false = ouverture unique. */
  loop?: boolean;
  /** true = pose la marque sur une tuile arrondie (indispensable sur fond sombre). */
  tile?: boolean;
  /** true = eventail aux couleurs du wallet Solana (page de chargement). */
  solana?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Marque de l'application : les trois cartes en éventail.
 *
 * Rejoue l'animation du SVG de marque fourni par Corentin — mêmes angles
 * d'ouverture (36 / 18 / 0), mêmes keyTimes (0 / .35 / .65 / 1) et mêmes
 * keySplines (`.4 0 .2 1`).
 *
 * Le SVG d'origine s'anime par `<animateTransform>` : aucune icône de lanceur
 * Android ne sait le lire (un drawable d'icône est statique) et une `Image`
 * React Native ne l'anime pas non plus. On anime donc les rotations ici.
 *
 * Attention : les cartes sont SOMBRES. Sur le fond sombre de l'app, passer
 * `tile` pour les poser sur une tuile claire, sinon elles disparaissent.
 */
export function CardsMark({ loop = false, size, solana = false, style, tile = false }: CardsMarkProps) {
  const t = useRef(new Animated.Value(0)).current;
  const k = size / VIEWBOX;
  const cards = solana ? SOLANA_CARDS : CARDS;

  useEffect(() => {
    t.setValue(0);
    const easing = Easing.bezier(0.4, 0, 0.2, 1);
    if (loop) {
      const anim = Animated.loop(
        Animated.timing(t, { duration: CYCLE_MS, easing, toValue: 1, useNativeDriver: true }),
      );
      anim.start();
      return () => anim.stop();
    }
    const anim = Animated.timing(t, {
      duration: OPEN_MS,
      easing,
      toValue: OPEN_AT,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [loop, t]);

  /** Rotation d'une carte, en degrés (0 fermé -> -angle ouvert). */
  const fan = (angle: number) =>
    t.interpolate({
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      inputRange: [0, OPEN_AT, 0.65, 1],
      outputRange: ['0deg', `-${angle}deg`, `-${angle}deg`, '0deg'],
    });

  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: tile ? BRAND_BG : undefined,
          borderRadius: tile ? TILE_RADIUS_RATIO * size : 0,
          height: size,
          width: size,
        },
        style,
      ]}
    >
      {tile
        ? Array.from({ length: TILE_BANDS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.band,
                { backgroundColor: mix(TILE_GRADIENT.from, TILE_GRADIENT.to, i / (TILE_BANDS - 1)) },
              ]}
            />
          ))
        : null}
      {cards.map((card) => (
        <Animated.View
          key={card.angle}
          style={[
            styles.card,
            {
              height: 2 * PIVOT_RADIUS * k,
              left: (CARD_AT.x + PIVOT.x - PIVOT_RADIUS) * k,
              top: (CARD_AT.y + PIVOT.y - PIVOT_RADIUS) * k,
              transform: [{ rotate: fan(card.angle) }],
              width: 2 * PIVOT_RADIUS * k,
            },
          ]}
        >
          <Image
            resizeMode="contain"
            source={card.source}
            style={{
              height: CARD_BOX.h * k,
              left: (PIVOT_RADIUS - PIVOT.x) * k,
              position: 'absolute',
              top: (PIVOT_RADIUS - PIVOT.y) * k,
              width: CARD_BOX.w * k,
            }}
          />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
    position: 'relative',
  },
  card: {
    position: 'absolute',
  },
  // Une bande du dégradé : empilées, elles le composent sans image ni lib.
  band: {
    flex: 1,
    width: '100%',
  },
});
