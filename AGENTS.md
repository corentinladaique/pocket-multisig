# Pocket Multisig

Consultation et gestion d'un multisig Squads Protocol v4 depuis un appareil
Android (Solana Seeker) via React Native / Expo + Mobile Wallet Adapter.

Statut : MVP hackathon, **devnet uniquement**.
Nom de code : pocket-multisig.

Documents liés :
- `PRODUCT.md`      — périmètre, user stories, critères d'acceptation
- `ARCHITECTURE.md` — stack, arborescence, décisions techniques (ADR courts)
- `SECURITY.md`     — règles de sécurité non négociables
- `TASKS.md`        — plan de réalisation en tâches atomiques

## Règle d'or

Aucune transaction n'est signée ni envoyée sans passage par l'écran de
confirmation (`SECURITY.md` §4). Toute PR qui contourne cet écran est refusée.

## Versions de référence (vérifiées le 2026-09-19)

| Paquet | Version | Rôle |
| --- | --- | --- |
| expo | 57.0.x | runtime + build system |
| react-native | 0.86.3 | runtime natif (épinglé par Expo SDK 57) |
| typescript | 6.0.3, `strict: true` | langage |
| @solana/web3.js | 1.99.x (v1) | RPC, transactions |
| @wallet-ui/react-native-web3js | 4.3.0 | Mobile Wallet Adapter (React Native) |
| @sqds/multisig | 2.1.4 | Squads Protocol v4 SDK |
| react-native-quick-crypto | 1.1.x | polyfill `crypto` |
| react-native-nitro-modules | 0.3x | requis par quick-crypto |
| expo-dev-client | 57.0.x | development build (obligatoire) |

Programme Squads v4 : `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
(présent et exécutable sur devnet **et** mainnet — ne jamais pointer mainnet).

## GitHub safety

- Never create, delete, rename, transfer, archive, fork or change visibility
  of a repository without explicit user authorization.
- Never push, force-push, merge, publish a release or modify repository
  settings without explicit user authorization.
- Always show git status, staged files, target repository and target branch
  before the first push.
- Never use `git push --force`.
- Never expose authentication tokens or credential files.
