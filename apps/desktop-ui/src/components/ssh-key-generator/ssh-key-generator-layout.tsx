'use client';

import { useState, useCallback } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconFingerprint } from '@tabler/icons-react';
import { ToolShell } from '@/components/tools/tool-shell';
import { IOPanel } from '@/components/tools/io-panel';
import { CopyTextButton } from '@/components/tools/copy-text-button';
import { ToolErrorBanner } from '@/components/tools/tool-error-banner';
import { downloadFile } from '@/lib/desktop/save-file';

type KeyType = 'ed25519' | 'rsa-2048' | 'rsa-4096';

interface GeneratedKeys {
  privateKey: string;
  publicKey: string;
  publicKeyOpenSSH: string;
}

// --- Helpers ---

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function encodeLength(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x81, n]);
  return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff]);
}

function encodeInteger(bytes: Uint8Array): Uint8Array {
  // Prepend 0x00 if high bit set (DER positive integer)
  const needsPad = bytes[0] & 0x80;
  const content = needsPad ? new Uint8Array([0, ...bytes]) : bytes;
  return new Uint8Array([0x02, ...encodeLength(content.length), ...content]);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

// Export RSA private key as PKCS#8 PEM (browsers give us pkcs8 directly)
async function exportRsaPrivatePem(key: CryptoKey): Promise<string> {
  const der = await crypto.subtle.exportKey('pkcs8', key);
  const b64 = arrayBufferToBase64(der);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  // PEM framing for a key this tool just generated in the user's browser.
  // threatcrush-disable-next-line secret-private-key
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

// Export RSA public key as PKCS#8 SubjectPublicKeyInfo PEM
async function exportRsaPublicPem(key: CryptoKey): Promise<string> {
  const der = await crypto.subtle.exportKey('spki', key);
  const b64 = arrayBufferToBase64(der);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

// RSA OpenSSH public key wire format:
// string "ssh-rsa" | mpint e | mpint n
function encodeSSHString(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  const len = new DataView(new ArrayBuffer(4));
  len.setUint32(0, enc.length);
  return concat(new Uint8Array(len.buffer), enc);
}

function encodeSSHMpint(bytes: Uint8Array): Uint8Array {
  // strip leading zeros
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const stripped = bytes.slice(start);
  // prepend 0x00 if high bit set
  const data = stripped[0] & 0x80 ? concat(new Uint8Array([0]), stripped) : stripped;
  const len = new DataView(new ArrayBuffer(4));
  len.setUint32(0, data.length);
  return concat(new Uint8Array(len.buffer), data);
}

async function buildRsaOpenSSHPublicKey(publicKey: CryptoKey, comment: string): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  // Parse SPKI to extract n and e from RSAPublicKey inside
  // SPKI = SEQUENCE { AlgorithmIdentifier, BIT STRING { RSAPublicKey } }
  // RSAPublicKey = SEQUENCE { INTEGER n, INTEGER e }
  const spkiBytes = new Uint8Array(spki);
  // Find the BIT STRING payload (skip algorithm identifier)
  // Simple DER walk: outer SEQUENCE -> skip AlgId -> BIT STRING -> inner RSAPublicKey
  let pos = 0;
  // outer SEQUENCE
  pos += 1; // tag 0x30
  const outerLen = spkiBytes[pos] & 0x80
    ? (() => { const ll = spkiBytes[pos] & 0x7f; let v = 0; for (let i=0;i<ll;i++) v = (v<<8)|spkiBytes[++pos]; return v; })()
    : spkiBytes[pos];
  pos += 1;
  // AlgorithmIdentifier SEQUENCE
  pos += 1; // tag 0x30
  const algLen = spkiBytes[pos] & 0x80
    ? (() => { const ll = spkiBytes[pos] & 0x7f; let v = 0; for (let i=0;i<ll;i++) v = (v<<8)|spkiBytes[++pos]; return v; })()
    : spkiBytes[pos];
  pos += 1 + algLen;
  // BIT STRING
  pos += 1; // tag 0x03
  const bsLen = spkiBytes[pos] & 0x80
    ? (() => { const ll = spkiBytes[pos] & 0x7f; let v = 0; for (let i=0;i<ll;i++) v = (v<<8)|spkiBytes[++pos]; return v; })()
    : spkiBytes[pos];
  pos += 1;
  pos += 1; // unused bits byte
  // Now at RSAPublicKey SEQUENCE
  pos += 1; // 0x30
  const seqLen = spkiBytes[pos] & 0x80
    ? (() => { const ll = spkiBytes[pos] & 0x7f; let v = 0; for (let i=0;i<ll;i++) v = (v<<8)|spkiBytes[++pos]; return v; })()
    : spkiBytes[pos];
  pos += 1;
  // INTEGER n
  pos += 1; // 0x02
  let nLen = spkiBytes[pos] & 0x80
    ? (() => { const ll = spkiBytes[pos] & 0x7f; let v = 0; for (let i=0;i<ll;i++) v = (v<<8)|spkiBytes[++pos]; return v; })()
    : spkiBytes[pos];
  pos += 1;
  const nBytes = spkiBytes.slice(pos, pos + nLen);
  pos += nLen;
  // INTEGER e
  pos += 1; // 0x02
  let eLen = spkiBytes[pos] & 0x80
    ? (() => { const ll = spkiBytes[pos] & 0x7f; let v = 0; for (let i=0;i<ll;i++) v = (v<<8)|spkiBytes[++pos]; return v; })()
    : spkiBytes[pos];
  pos += 1;
  const eBytes = spkiBytes.slice(pos, pos + eLen);

  const wire = concat(
    encodeSSHString('ssh-rsa'),
    encodeSSHMpint(eBytes),
    encodeSSHMpint(nBytes),
  );
  const b64 = arrayBufferToBase64(wire.buffer as ArrayBuffer);
  return `ssh-rsa ${b64}${comment ? ' ' + comment : ''}`;
}

// Ed25519: Web Crypto gives us raw 32-byte key
async function exportEd25519PrivatePem(key: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
  const b64 = arrayBufferToBase64(pkcs8);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  // threatcrush-disable-next-line secret-private-key
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

async function exportEd25519PublicPem(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  const b64 = arrayBufferToBase64(spki);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

// Ed25519 OpenSSH: string "ssh-ed25519" | string <32-byte pubkey>
async function buildEd25519OpenSSHPublicKey(publicKey: CryptoKey, comment: string): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  // Ed25519 SPKI: last 32 bytes are the raw public key
  const raw = new Uint8Array(spki).slice(-32);
  const typeStr = encodeSSHString('ssh-ed25519');
  const keyLen = new DataView(new ArrayBuffer(4));
  keyLen.setUint32(0, raw.length);
  const keyPart = concat(new Uint8Array(keyLen.buffer), raw);
  const wireCorrect = concat(typeStr, keyPart);
  const b64 = arrayBufferToBase64(wireCorrect.buffer as ArrayBuffer);
  return `ssh-ed25519 ${b64}${comment ? ' ' + comment : ''}`;
}

async function generateKeys(type: KeyType, comment: string): Promise<GeneratedKeys> {
  if (type === 'ed25519') {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const [priv, pub, openssh] = await Promise.all([
      exportEd25519PrivatePem(pair.privateKey),
      exportEd25519PublicPem(pair.publicKey),
      buildEd25519OpenSSHPublicKey(pair.publicKey, comment),
    ]);
    return { privateKey: priv, publicKey: pub, publicKeyOpenSSH: openssh };
  }

  const bits = type === 'rsa-2048' ? 2048 : 4096;
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const [priv, pub, openssh] = await Promise.all([
    exportRsaPrivatePem(pair.privateKey),
    exportRsaPublicPem(pair.publicKey),
    buildRsaOpenSSHPublicKey(pair.publicKey, comment),
  ]);
  return { privateKey: priv, publicKey: pub, publicKeyOpenSSH: openssh };
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  downloadFile(blob, filename);
}

function KeyBlock({
  label,
  value,
  filename,
  copyLabel,
  downloadLabel,
}: {
  label: string;
  value: string;
  filename: string;
  copyLabel: string;
  downloadLabel: string;
}) {
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard();
  if (!value) return null;
  return (
    <IOPanel
      label={label}
      actions={
        <>
          <CopyTextButton
            onCopy={() => copyToClipboard(value, { silent: true, resetMs: 1600 })}
            copied={copied}
            label={copyLabel}
            copiedLabel={copyLabel}
            className="h-8 px-2.5 text-xs"
          />
          <button
            type="button"
            title={downloadLabel}
            onClick={() => downloadText(value, filename)}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/60 bg-muted/30 hover:bg-muted/60 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            {downloadLabel}
          </button>
        </>
      }
    >
      <Textarea
        readOnly
        value={value}
        className="font-mono text-xs resize-none h-36 bg-muted/20 border-border/50"
        spellCheck={false}
      />
    </IOPanel>
  );
}

export function SshKeyGeneratorLayout() {
  const t = useTranslations('SshKeyGenerator');
  const [keyType, setKeyType] = useState<KeyType>('ed25519');
  const [comment, setComment] = useState('');
  const [keys, setKeys] = useState<GeneratedKeys | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setKeys(null);
    try {
      const result = await generateKeys(keyType, comment.trim());
      setKeys(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.generationFailed'));
    } finally {
      setGenerating(false);
    }
  }, [keyType, comment, t]);

  const keyName = keyType === 'ed25519' ? 'id_ed25519' : 'id_rsa';

  const toolbar = (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="key-type">{t('keyTypeLabel')}</Label>
          <Select value={keyType} onValueChange={(v) => setKeyType(v as KeyType)}>
            <SelectTrigger id="key-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ed25519">Ed25519 ({t('recommended')})</SelectItem>
              <SelectItem value="rsa-2048">RSA 2048-bit</SelectItem>
              <SelectItem value="rsa-4096">RSA 4096-bit</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {keyType === 'ed25519'
              ? t('ed25519Desc')
              : keyType === 'rsa-2048'
              ? t('rsa2048Desc')
              : t('rsa4096Desc')}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="comment">{t('commentLabel')}</Label>
          <Input
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="user@hostname"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">{t('commentHint')}</p>
        </div>
      </div>

      <Button onClick={generate} disabled={generating} className="w-full sm:w-auto gap-2">
        <RefreshCw className={cn('h-4 w-4', generating && 'animate-spin')} />
        {generating
          ? (keyType === 'rsa-4096' ? t('generatingLong') : t('generating'))
          : t('generateBtn')}
      </Button>
    </div>
  );

  return (
    <ToolShell
      icon={IconFingerprint}
      title={t('title')}
      description={t('subtitle')}
      toolbar={toolbar}
      contentClassName="gap-4 overflow-auto"
    >
      <ToolErrorBanner message={error} />

      {keys && (
        <div className="space-y-4">
          <KeyBlock
            label={t('privateKeyLabel')}
            value={keys.privateKey}
            filename={keyName}
            copyLabel={t('copy')}
            downloadLabel={t('download')}
          />
          <KeyBlock
            label={t('publicKeyOpenSSHLabel')}
            value={keys.publicKeyOpenSSH}
            filename={`${keyName}.pub`}
            copyLabel={t('copy')}
            downloadLabel={t('download')}
          />
          <KeyBlock
            label={t('publicKeySpkiLabel')}
            value={keys.publicKey}
            filename={`${keyName}_public.pem`}
            copyLabel={t('copy')}
            downloadLabel={t('download')}
          />
          <p className="text-xs text-muted-foreground text-center">
            {t('browserNote')}
          </p>
        </div>
      )}
    </ToolShell>
  );
}
