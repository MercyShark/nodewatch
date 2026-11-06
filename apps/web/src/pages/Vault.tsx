import { useMemo, useState } from "react";
import { FileArchive, Globe, KeyRound, Lock, Plus, UploadCloud, UserPlus, Wallet } from "lucide-react";
import type { Bundle, VaultResponse } from "@nodewatch/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton, Hex } from "@/components/ui/copy";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineError, LoadingBlock } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge, StatusBadge, type Tone } from "@/components/ui/status";
import { DataTable, type Column } from "@/components/ui/table";
import { useIsAdmin } from "@/lib/auth";
import { isForbidden } from "@/lib/api";
import { useAddRecipient, useCreateBundle, useVault } from "@/lib/queries";
import { connectWallet, recipientMessage, signText, WalletError } from "@/lib/siwe";
import { explorerAddress, explorerEntity, swarmLink } from "@/lib/config";
import { fmtAgo, fmtBytes, fmtDateTime, shortHex } from "@/lib/format";
import { pushToast } from "@/lib/toast";
import { AdminOnlyPanel, Stagger, StaggerItem } from "./admin-shared";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;

const statusTone: Record<Bundle["status"], Tone> = { uploaded: "ok", "local-only": "warn", failed: "crit" };
const statusLabel: Record<Bundle["status"], string> = { uploaded: "Uploaded", "local-only": "Local only", failed: "Failed" };

const KIND_INFO: Record<Bundle["kind"], string> = {
  diagnostic: "Container logs (redacted), 24 h of verdicts, a metrics snapshot and versions.",
  findings: "Latest slow-query findings, including query text.",
  backup: "Nodewatch settings and a SQLite snapshot.",
  sample: "A sanitised diagnostic, unencrypted. Anyone with the link can open it.",
};

function SchemeBadge({ scheme }: { scheme: Bundle["scheme"] }) {
  return scheme === "none" ? (
    <Badge title="Unencrypted public sample">
      <Globe className="size-3.5" aria-hidden /> Public
    </Badge>
  ) : (
    <Badge title="ECIES secp256k1 envelope + AES-256-GCM">
      <Lock className="size-3.5" aria-hidden /> Encrypted
    </Badge>
  );
}

function SwarmRef({ b }: { b: Bundle }) {
  if (!b.swarmRef) return <span className="text-sm text-muted">—</span>;
  if (b.scheme === "none") return <Hex value={b.swarmRef} href={swarmLink(b.swarmRef)} head={8} tail={6} />;
  return (
    <span className="flex flex-col">
      <Hex value={b.swarmRef} head={8} tail={6} />
      <span className="text-[11px] text-muted">ciphertext</span>
    </span>
  );
}

function BundleStatus({ b }: { b: Bundle }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={statusTone[b.status]}>{statusLabel[b.status]}</StatusBadge>
      {b.error ? <span className="max-w-xs text-xs text-crit">{b.error}</span> : null}
    </span>
  );
}

function AddRecipientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [touched, setTouched] = useState({ address: false, signature: false });
  const [walletError, setWalletError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [nonce] = useState(() => `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`);
  const add = useAddRecipient();

  const message = recipientMessage(label.trim() || "<label>", address.trim() || "<address>", nonce);
  const addrErr = address && !ADDR_RE.test(address.trim()) ? "Enter a 0x-prefixed 20-byte address (42 characters)." : null;
  const sigErr = signature && !SIG_RE.test(signature.trim()) ? "A signature is 0x followed by 130 hex characters (65 bytes)." : null;
  const canSubmit = label.trim() && ADDR_RE.test(address.trim()) && SIG_RE.test(signature.trim());

  const reset = () => {
    setLabel("");
    setAddress("");
    setSignature("");
    setTouched({ address: false, signature: false });
    setWalletError(null);
    add.reset();
  };
  const close = () => {
    reset();
    onClose();
  };

  const signWithWallet = async () => {
    setWalletError(null);
    if (!label.trim()) {
      setWalletError("Enter a label first; it is part of the signed message.");
      return;
    }
    setSigning(true);
    try {
      const addr = await connectWallet();
      if (address.trim() && address.trim().toLowerCase() !== addr.toLowerCase()) {
        throw new WalletError(
          "other",
          `The connected wallet is ${shortHex(addr)}, not ${shortHex(address.trim())}. Switch accounts, or clear the address field.`,
        );
      }
      setAddress(addr);
      const sig = await signText(addr, recipientMessage(label.trim(), addr, nonce));
      setSignature(sig);
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : String(e));
    } finally {
      setSigning(false);
    }
  };

  const submit = () => {
    setTouched({ address: true, signature: true });
    if (!canSubmit) return;
    const addr = address.trim();
    add.mutate(
      { label: label.trim(), address: addr, signature: signature.trim(), message: recipientMessage(label.trim(), addr, nonce) },
      {
        onSuccess: () => {
          pushToast({ tone: "ok", title: "Recipient added", body: `${label.trim()} (${shortHex(addr)}) can now decrypt new bundles.` });
          close();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a recipient"
      description="The recipient signs a message. Their public key is recovered from the signature."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={add.isPending} disabled={!canSubmit}>
            <UserPlus className="size-4" aria-hidden /> Add recipient
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Label" htmlFor="rcp-label" hint="e.g. Arkiv engineering">
          <Input id="rcp-label" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" required />
        </Field>
        <Field
          label="Recipient address"
          htmlFor="rcp-address"
          error={touched.address ? addrErr : null}
        >
          <Input
            id="rcp-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, address: true }))}
            placeholder="0x…"
            className="num"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={touched.address && !!addrErr}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg">Message to sign</span>
            <CopyButton text={message} label="Copy message" />
          </div>
          <pre className="num max-w-full overflow-x-auto rounded-lg border border-border bg-bg p-3 text-xs whitespace-pre-wrap text-muted">
            {message}
          </pre>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium text-fg">Signature</legend>
          <div className="flex flex-col gap-1.5">
            
            <Button onClick={signWithWallet} loading={signing} className="self-start">
              <Wallet className="size-4" aria-hidden /> Sign with connected wallet
            </Button>
            <InlineError error={walletError} />
          </div>
          <Field
            label="Or paste a signature"
            htmlFor="rcp-sig"
            hint="personal_sign of the message above."
            error={touched.signature ? sigErr : null}
          >
            <Input
              id="rcp-sig"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, signature: true }))}
              placeholder="0x…"
              className="num"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={touched.signature && !!sigErr}
            />
          </Field>
        </fieldset>
        <InlineError error={add.error} />
      </form>
    </Dialog>
  );
}

function CreateBundleDialog({
  open,
  onClose,
  recipients,
}: {
  open: boolean;
  onClose: () => void;
  recipients: VaultResponse["recipients"];
}) {
  const [kind, setKind] = useState<Bundle["kind"]>("diagnostic");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(recipients.map((r) => r.address)));
  const create = useCreateBundle();
  const isSample = kind === "sample";
  const close = () => {
    create.reset();
    onClose();
  };
  const toggle = (a: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
  const submit = () =>
    create.mutate(
      { kind, recipients: isSample ? [] : [...chosen] },
      {
        onSuccess: (b) => {
          pushToast({
            tone: b.status === "failed" ? "crit" : "ok",
            title: b.status === "failed" ? "Bundle failed" : "Bundle uploaded",
            body: b.swarmRef ? `Swarm ref ${shortHex(b.swarmRef, 8, 6)}${b.entityKey ? ` · entity ${shortHex(b.entityKey)}` : ""}` : (b.error ?? undefined),
          });
          close();
        },
      },
    );

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create a bundle"
      description="Encrypts, uploads to Swarm and indexes on Arkiv."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!isSample && chosen.size === 0}>
            <UploadCloud className="size-4" aria-hidden /> Create and upload
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Kind" htmlFor="bundle-kind" hint={KIND_INFO[kind]}>
          <Select id="bundle-kind" value={kind} onChange={(e) => setKind(e.target.value as Bundle["kind"])}>
            <option value="diagnostic">Diagnostic</option>
            <option value="findings">Findings (slow queries)</option>
            <option value="backup">Backup</option>
            <option value="sample">Public sample (unencrypted)</option>
          </Select>
        </Field>
        {isSample ? (
          <p className="flex items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 p-3 text-sm text-fg">
            <Globe className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            Not encrypted. Anyone with the link can open it.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-fg">Recipients</legend>
            {recipients.length === 0 ? (
              <p className="text-sm text-muted">Add a recipient first.</p>
            ) : (
              recipients.map((r) => (
                <label key={r.address} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={chosen.has(r.address)}
                    onChange={() => toggle(r.address)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{r.label}</span>
                    <span className="num block truncate text-xs text-muted">{r.address}</span>
                  </span>
                </label>
              ))
            )}
          </fieldset>
        )}
        <p className="text-xs text-muted">
          Never included: <code className="num">.env</code>, <code className="num">secrets/</code>, <code className="num">frpc.toml</code>, tokens, keys.
        </p>
        <InlineError error={create.error} />
      </div>
    </Dialog>
  );
}

function BundleCards({ bundles }: { bundles: Bundle[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border md:hidden">
      {bundles.map((b) => (
        <li key={b.id} className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg capitalize">{b.kind}</span>
            <SchemeBadge scheme={b.scheme} />
            <span className="num ml-auto text-xs text-muted">{fmtBytes(b.sizeBytes)}</span>
          </div>
          <BundleStatus b={b} />
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs">
            <dt className="text-muted">Swarm ref</dt>
            <dd className="min-w-0">
              <SwarmRef b={b} />
            </dd>
            <dt className="text-muted">Arkiv entity</dt>
            <dd className="min-w-0">
              <Hex value={b.entityKey} href={b.entityKey ? explorerEntity(b.entityKey) : null} />
            </dd>
            <dt className="text-muted">Recipient</dt>
            <dd className="min-w-0">{b.recipient ? <Hex value={b.recipient} /> : <span className="text-muted">anyone</span>}</dd>
            <dt className="text-muted">Created</dt>
            <dd className="num">{fmtAgo(b.createdAt)}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export default function Vault() {
  const admin = useIsAdmin();
  const vault = useVault(admin);
  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const labels = useMemo(() => new Map((vault.data?.recipients ?? []).map((r) => [r.address.toLowerCase(), r.label])), [vault.data]);

  const header = (
    <PageHeader
      title="Swarm vault"
      description="Encrypted bundles on Swarm. Only the chosen recipients can open them."
      actions={
        admin && vault.data ? (
          <Button variant="primary" onClick={() => setCreateOpen(true)} disabled={!vault.data.beeConfigured}>
            <Plus className="size-4" aria-hidden /> Create bundle
          </Button>
        ) : null
      }
    />
  );

  if (!admin || (vault.error && isForbidden(vault.error))) {
    return (
      <>
        {header}
        <AdminOnlyPanel what="The vault holds private diagnostics." />
      </>
    );
  }

  const columns: Column<Bundle>[] = [
    {
      key: "kind",
      header: "Kind",
      cell: (b) => (
        <span className="flex flex-col items-start gap-1">
          <span className="text-sm font-medium text-fg capitalize">{b.kind}</span>
          <SchemeBadge scheme={b.scheme} />
        </span>
      ),
      sort: (b) => b.kind,
    },
    { key: "size", header: "Size", align: "right", cell: (b) => fmtBytes(b.sizeBytes), sort: (b) => b.sizeBytes },
    {
      key: "recipient",
      header: "Recipient",
      hideBelow: "lg",
      cell: (b) =>
        b.recipient ? (
          <span className="flex flex-col">
            <span className="text-xs text-muted">{labels.get(b.recipient.toLowerCase()) ?? ""}</span>
            <Hex value={b.recipient} />
          </span>
        ) : (
          <span className="text-sm text-muted">anyone</span>
        ),
    },
    { key: "ref", header: "Swarm ref", cell: (b) => <SwarmRef b={b} /> },
    {
      key: "entity",
      header: "Arkiv entity",
      hideBelow: "lg",
      cell: (b) => <Hex value={b.entityKey} href={b.entityKey ? explorerEntity(b.entityKey) : null} />,
    },
    { key: "status", header: "Status", cell: (b) => <BundleStatus b={b} />, sort: (b) => b.status },
    {
      key: "created",
      header: "Created",
      align: "right",
      cell: (b) => <span title={fmtDateTime(b.createdAt)}>{fmtAgo(b.createdAt)}</span>,
      sort: (b) => b.createdAt,
    },
  ];

  return (
    <>
      {header}
      {vault.isLoading ? (
        <LoadingBlock className="h-72" label="Loading vault" />
      ) : vault.error || !vault.data ? (
        <Card>
          <ErrorState error={vault.error} onRetry={() => void vault.refetch()} />
        </Card>
      ) : (
        <Stagger page="vault" className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <StaggerItem>
              <Card className="h-full">
                <CardHeader title="Bee (Swarm)" icon={<UploadCloud />} />
                <CardBody>
                  <dl className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
                    <dt className="text-muted">Status</dt>
                    <dd>
                      {vault.data.beeConfigured ? (
                        <StatusBadge tone="ok">Configured</StatusBadge>
                      ) : (
                        <StatusBadge tone="warn">Not configured</StatusBadge>
                      )}
                    </dd>
                    <dt className="text-muted">Mode</dt>
                    <dd>
                      {vault.data.beeMode === "external" ? "External" : "Embedded"}
                    </dd>
                    <dt className="text-muted">Postage batch</dt>
                    <dd className="min-w-0">
                      {vault.data.postageBatchId ? <Hex value={vault.data.postageBatchId} head={10} tail={6} /> : <span className="text-muted">not set</span>}
                    </dd>
                  </dl>
                  {!vault.data.beeConfigured ? (
                    <p className="mt-3 text-sm text-muted">
                      Set <code className="num">BEE_API_URL</code> and <code className="num">BEE_POSTAGE_BATCH_ID</code>.
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            </StaggerItem>
            <StaggerItem>
              <Card className="h-full">
                <CardHeader
                  title="Recipients"
                  icon={<KeyRound />}
                  description="Bundles are encrypted to these wallets."
                  actions={
                    <Button size="sm" onClick={() => setAddOpen(true)}>
                      <UserPlus className="size-4" aria-hidden /> Add recipient
                    </Button>
                  }
                />
                <CardBody>
                  {vault.data.recipients.length === 0 ? (
                    <EmptyState title="No recipients yet">Add yourself and the Arkiv engineer.</EmptyState>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {vault.data.recipients.map((r) => (
                        <li key={r.address} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-fg">{r.label}</span>
                            <Hex value={r.address} href={explorerAddress(r.address)} />
                          </span>
                          <span className="text-xs text-muted">added {fmtAgo(r.addedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </StaggerItem>
          </div>
          <StaggerItem>
            <Card>
              <CardHeader
                title="Bundles"
                icon={<FileArchive />}
                description="Indexed on Arkiv as nodewatch.bundle."
              />
              <CardBody>
                {vault.data.bundles.length === 0 ? (
                  <EmptyState title="No bundles yet" />
                ) : (
                  <>
                    <BundleCards bundles={vault.data.bundles} />
                    <div className="hidden md:block">
                      <DataTable
                        rows={vault.data.bundles}
                        columns={columns}
                        rowKey={(b) => b.id}
                        caption="Vault bundles"
                        initialSort={{ key: "created", dir: "desc" }}
                      />
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </StaggerItem>
        </Stagger>
      )}
      {addOpen ? <AddRecipientDialog open={addOpen} onClose={() => setAddOpen(false)} /> : null}
      {createOpen && vault.data ? (
        <CreateBundleDialog open={createOpen} onClose={() => setCreateOpen(false)} recipients={vault.data.recipients} />
      ) : null}
    </>
  );
}
