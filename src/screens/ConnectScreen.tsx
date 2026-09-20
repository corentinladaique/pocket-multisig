import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import { useRpcHealth } from '../solana/useRpcHealth';
import { useMultisigLookup } from '../squads/useMultisigLookup';
import { useProposals } from '../squads/proposals';

type Phase = 'idle' | 'connecting' | 'disconnecting';

function shortenAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Traduit l'erreur brute remontée par Mobile Wallet Adapter en message lisible.
 * Un refus de l'utilisateur n'est jamais présenté comme une erreur technique
 * (SECURITY.md §6).
 */
function toReadableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|declin|refus/i.test(raw)) {
    return "Connexion refusée dans le wallet. Aucune autorisation n'a été accordée.";
  }
  if (/no wallet|no activity|not found|not installed|unable to (find|open)/i.test(raw)) {
    return 'Aucun wallet Mobile Wallet Adapter trouvé sur cet appareil.';
  }
  return `Échec de la connexion : ${raw}`;
}

export function ConnectScreen() {
  const { account, connect, disconnect } = useMobileWallet();
  const { detail: rpcDetail, retry: retryRpc, status: rpcStatus } = useRpcHealth();
  const msig = useMultisigLookup();
  const proposals = useProposals(
    msig.view?.address ?? null,
    msig.view?.transactionIndex ?? 0,
    msig.view?.staleTransactionIndex ?? 0,
  );
  const [multisigInput, setMultisigInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const onConnect = useCallback(async () => {
    setError(null);
    setPhase('connecting');
    try {
      await connect();
    } catch (caught: unknown) {
      setError(toReadableError(caught));
    } finally {
      setPhase('idle');
    }
  }, [connect]);

  const onDisconnect = useCallback(async () => {
    setError(null);
    setPhase('disconnecting');
    try {
      await disconnect();
    } catch (caught: unknown) {
      setError(toReadableError(caught));
    } finally {
      setPhase('idle');
    }
  }, [disconnect]);

  const busy = phase !== 'idle';

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>DEVNET</Text>
      <Text style={styles.title}>Pocket Multisig</Text>

      {account ? (
        <View style={styles.card}>
          <Text style={styles.label}>Wallet connecté</Text>
          {account.label ? <Text style={styles.walletLabel}>{account.label}</Text> : null}
          <Text style={styles.address}>{shortenAddress(account.address.toString())}</Text>
          <Text style={styles.fullAddress}>{account.address.toString()}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onDisconnect}
            style={[styles.button, styles.secondary, busy && styles.disabled]}
          >
            {phase === 'disconnecting' ? (
              <ActivityIndicator color="#101317" />
            ) : (
              <Text style={styles.secondaryText}>Disconnect</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onConnect}
          style={[styles.button, busy && styles.disabled]}
        >
          {phase === 'connecting' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Connect wallet</Text>
          )}
        </Pressable>
      )}

      {phase === 'connecting' ? (
        <Text style={styles.hint}>Ouverture du wallet…</Text>
      ) : null}

      <View style={styles.rpcBox}>
        <Text style={styles.rpcLine}>Network: Devnet</Text>
        <Text style={styles.rpcLine}>
          RPC:{' '}
          <Text
            style={[
              styles.rpcValue,
              rpcStatus === 'online' && styles.rpcOnline,
              rpcStatus === 'offline' && styles.rpcOffline,
            ]}
          >
            {rpcStatus === 'checking' ? 'Checking…' : rpcStatus === 'online' ? 'Online' : 'Offline'}
          </Text>
        </Text>
        {rpcStatus === 'offline' ? (
          <>
            {rpcDetail ? <Text style={styles.rpcDetail}>{rpcDetail}</Text> : null}
            <Pressable accessibilityRole="button" onPress={retryRpc} style={styles.retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {account ? (
        <View style={styles.msigBlock}>
          <Text style={styles.msigHeading}>Multisig (lecture seule)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={msig.status !== 'loading'}
            onChangeText={setMultisigInput}
            placeholder="Multisig address"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            value={multisigInput}
          />
          <Pressable
            accessibilityRole="button"
            disabled={msig.status === 'loading'}
            onPress={() => msig.load(multisigInput)}
            style={[styles.button, msig.status === 'loading' && styles.disabled]}
          >
            {msig.status === 'loading' ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Load multisig</Text>
            )}
          </Pressable>
          {msig.status === 'loading' ? <Text style={styles.hint}>Lecture…</Text> : null}

          {msig.status === 'error' && msig.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{msig.error}</Text>
              <Pressable accessibilityRole="button" onPress={msig.retry} style={styles.retry}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {msig.status === 'loaded' && msig.view ? (
            <View style={styles.msigResult}>
              <Text style={styles.fieldLabel}>Multisig configuration address</Text>
              <Text style={styles.fieldValue}>{msig.view.address}</Text>

              <Text style={styles.fieldLabel}>Vault address (index 0)</Text>
              <Text style={styles.fieldValue}>{msig.view.vaultAddress}</Text>

              <Text style={styles.fieldLabel}>Threshold</Text>
              <Text style={styles.fieldValue}>
                {msig.view.threshold} / {msig.view.members.length}
              </Text>

              <Text style={styles.fieldLabel}>
                Members ({msig.view.members.length})
              </Text>
              {msig.view.members.map((member) => (
                <Text key={member.address} style={styles.memberLine}>
                  {member.address}
                  {member.roles.length > 0 ? `  ·  ${member.roles.join(' + ')}` : ''}
                </Text>
              ))}

              <Text style={styles.fieldLabel}>Network</Text>
              <Text style={styles.fieldValue}>Devnet</Text>

              <Text style={styles.fieldLabel}>Proposals</Text>
              {proposals.status === 'loading' ? (
                <Text style={styles.fieldValue}>Loading…</Text>
              ) : null}
              {proposals.status === 'loaded' && proposals.list?.proposals.length === 0 ? (
                <Text style={styles.fieldValue}>No proposals yet</Text>
              ) : null}
              {proposals.status === 'loaded' && proposals.list !== null
                ? proposals.list.proposals.map((proposal) => (
                    <Text key={proposal.index} style={styles.memberLine}>
                      #{proposal.index} · {proposal.status} · {proposal.approvals} approval(s)
                    </Text>
                  ))
                : null}
              {proposals.status === 'loaded' && (proposals.list?.unreadable ?? 0) > 0 ? (
                <Text style={styles.rpcDetail}>
                  {proposals.list?.unreadable} compte(s) illisible(s) ignoré(s)
                </Text>
              ) : null}
              {proposals.status === 'error' && proposals.error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{proposals.error}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={proposals.retry}
                    style={styles.retry}
                  >
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMultisigInput('');
                  msig.clear();
                }}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Clear</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          {!account ? (
            <Pressable accessibilityRole="button" onPress={onConnect} style={styles.retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  badge: {
    backgroundColor: '#e8f0fe',
    borderRadius: 999,
    color: '#1a56db',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 24,
  },
  card: {
    alignItems: 'center',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    width: '100%',
  },
  label: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  walletLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  address: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  fullAddress: {
    color: '#6b7280',
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 24,
    width: '100%',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    backgroundColor: '#f3f4f6',
  },
  secondaryText: {
    color: '#101317',
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 12,
  },
  rpcBox: {
    alignItems: 'center',
    marginTop: 28,
  },
  rpcLine: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 2,
  },
  rpcValue: {
    fontWeight: '700',
  },
  rpcOnline: {
    color: '#047857',
  },
  rpcOffline: {
    color: '#b91c1c',
  },
  rpcDetail: {
    color: '#b91c1c',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  msigBlock: {
    alignSelf: 'stretch',
    marginTop: 28,
  },
  msigHeading: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  input: {
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    color: '#101317',
    fontSize: 13,
    marginBottom: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  msigResult: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 14,
  },
  fieldLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  memberLine: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 4,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 20,
    padding: 14,
    width: '100%',
  },
  errorText: {
    color: '#991b1b',
    fontSize: 14,
  },
  retry: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  retryText: {
    color: '#1a56db',
    fontSize: 15,
    fontWeight: '600',
  },
});