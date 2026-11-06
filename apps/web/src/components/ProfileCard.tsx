import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, IdCard } from "lucide-react";
import { validateProfile, type NodeProfileFields } from "@nodewatch/shared";
import { useProfile, usePublishProfile, useSaveProfile } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { pushToast } from "@/lib/toast";
import { useIsAdmin } from "@/lib/auth";
import { COUNTRIES, countryName } from "@/lib/country";
import { explorerEntity, explorerTx } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/status";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorState, Skeleton } from "@/components/ui/feedback";

/**
 * Name this node on Arkiv. The provider key signs the profile (a signature, not a transaction); the heartbeat key
 * writes it. Anyone can check the signature, so the name can be trusted without asking a website to add it.
 */
export function ProfileCard() {
  const admin = useIsAdmin();
  const q = useProfile(admin);
  const save = useSaveProfile();
  const publish = usePublishProfile();
  const id = useId();
  const [f, setF] = useState<NodeProfileFields>({ name: "", country: "", contact: "" });
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const s = q.data;
    if (!s) return;
    const base = s.draft ?? s.published?.fields ?? null;
    setF(base ?? { name: "", country: s.suggestedCountry ?? "", contact: "" });
  }, [q.data]);

  if (!admin) return null;
  const s = q.data;
  const err = f.name ? validateProfile(f) : null;
  const dirty = !!s && JSON.stringify(f) !== JSON.stringify(s.draft ?? s.published?.fields ?? null);
  const pub = s?.published ?? null;

  const onSave = () =>
    save.mutate(f, {
      onSuccess: () => pushToast({ tone: "ok", title: "Profile saved", body: "Publish it to put it on Arkiv." }),
      onError: (e) => pushToast({ tone: "crit", title: "Not saved", body: errorMessage(e) }),
    });
  const onPublish = () =>
    publish.mutate(undefined, {
      onSuccess: () => {
        setConfirm(false);
        pushToast({ tone: "ok", title: "Profile published on Arkiv", body: "Fleet views show it once the next block lands." });
      },
      onError: (e) => {
        setConfirm(false);
        pushToast({ tone: "crit", title: "Not published", body: errorMessage(e) });
      },
    });

  return (
    <Card>
      <CardHeader
        icon={<IdCard />}
        title="Node profile"
        description="A name and country for this node, signed by the provider key and stored on Arkiv."
        actions={
          pub ? (
            pub.verified ? (
              <Badge>
                <BadgeCheck className="size-3.5 text-ok" aria-hidden /> Signed and live
              </Badge>
            ) : (
              <Badge>Published, not yet visible</Badge>
            )
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-4">
        {q.isLoading ? (
          <Skeleton className="h-40" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" htmlFor={`${id}-name`} hint="Up to 48 characters.">
                <Input id={`${id}-name`} value={f.name} maxLength={48} autoComplete="off" onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field
                label="Country"
                htmlFor={`${id}-country`}
                hint={s?.suggestedCountry ? `This server runs in ${countryName(s.suggestedCountry)}.` : undefined}
              >
                <Select id={`${id}-country`} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
                  <option value="">Choose…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Contact (optional)" htmlFor={`${id}-contact`} hint="A handle or link other operators can reach.">
                <Input id={`${id}-contact`} value={f.contact} maxLength={96} autoComplete="off" onChange={(e) => setF({ ...f, contact: e.target.value })} />
              </Field>
            </div>
            {err ? (
              <p role="alert" className="text-sm text-crit">
                {err}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onSave} disabled={!dirty || !!err || !f.name || !f.country} loading={save.isPending}>
                Save
              </Button>
              <Button variant="primary" onClick={() => setConfirm(true)} disabled={dirty || !s?.canPublish} loading={publish.isPending}>
                {pub ? "Publish update" : "Publish on Arkiv"}
              </Button>
              {s && !s.canPublish && s.reason ? (
                <span className="text-sm text-muted">
                  {s.reason.startsWith("unlock") ? (
                    <>
                      Unlock the provider key in{" "}
                      <Link className="underline underline-offset-2 hover:text-fg" to="/pool">
                        Pool → Autopilot
                      </Link>{" "}
                      to sign.
                    </>
                  ) : (
                    s.reason
                  )}
                </span>
              ) : dirty ? (
                <span className="text-sm text-muted">Save first.</span>
              ) : null}
            </div>
            {pub ? (
              <p className="text-sm text-muted">
                Live as <span className="text-fg">{pub.fields.name}</span>, {countryName(pub.fields.country)}.{" "}
                <a className="underline underline-offset-2 hover:text-fg" href={explorerEntity(pub.entityKey)} target="_blank" rel="noreferrer noopener">
                  Entity
                </a>
                {pub.txHash ? (
                  <>
                    {" · "}
                    <a className="underline underline-offset-2 hover:text-fg" href={explorerTx(pub.txHash)} target="_blank" rel="noreferrer noopener">
                      Last write
                    </a>
                  </>
                ) : null}
                . Renewed automatically every few weeks.
              </p>
            ) : null}
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={onPublish}
        title="Publish this profile on Arkiv?"
        description={`The provider key signs "${f.name}, ${f.country ? countryName(f.country) : ""}" without sending a transaction. The heartbeat key writes it to Arkiv, which costs a little gas. The profile is public.`}
        confirmLabel="Sign and publish"
        loading={publish.isPending}
      />
    </Card>
  );
}
