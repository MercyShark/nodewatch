// The container swap behind "Update Nodewatch". Runs in the one-off updater container (helper.ts), never in the
// Nodewatch process it replaces: stopping that container would kill the code doing the swap.
//
//   1. create <name>-next from the new image with the old container's settings (env, mounts, network, limits, labels)
//   2. stop the old one (its own grace period), rename it <name>-old, give the new one the real name, start it
//   3. wait for the new one's health check (3 min); healthy -> remove the old one; otherwise put the old one back
//
// Only settings the operator chose are carried over. Values that came from the OLD image (its ENV defaults, labels,
// health check) are dropped, so the new image's own defaults, such as NODEWATCH_REVISION, take effect.
import type Docker from "dockerode";

export interface SwapResult {
  ok: boolean;
  rolledBack: boolean;
  message: string;
  from: string | null;
  to: string | null;
}

type Inspect = Docker.ContainerInspectInfo;
type ImageInspect = Docker.ImageInspectInfo;

const revisionOf = (env: string[] | undefined | null) => env?.find((e) => e.startsWith("NODEWATCH_REVISION="))?.slice("NODEWATCH_REVISION=".length) ?? null;

/** Create options for the replacement: the operator's settings from `old`, the defaults of `newImage`. */
export function cloneOptions(old: Inspect, oldImage: ImageInspect | null, newImage: string, name: string): Docker.ContainerCreateOptions {
  const imageEnv = new Set(oldImage?.Config?.Env ?? []);
  const imageLabels = oldImage?.Config?.Labels ?? {};
  const env = (old.Config.Env ?? []).filter((e) => !imageEnv.has(e));
  const labels = Object.fromEntries(Object.entries(old.Config.Labels ?? {}).filter(([k, v]) => imageLabels[k] !== v));
  labels["nodewatch.updated-at"] = new Date().toISOString();
  const hcOld = JSON.stringify(old.Config.Healthcheck ?? null);
  const hcImage = JSON.stringify((oldImage?.Config as { Healthcheck?: unknown } | undefined)?.Healthcheck ?? null);
  const mode = old.HostConfig?.NetworkMode ?? "default";
  const nets = Object.keys(old.NetworkSettings?.Networks ?? {});
  const opts: Docker.ContainerCreateOptions = {
    name,
    Image: newImage,
    Env: env,
    Labels: labels,
    ExposedPorts: old.Config.ExposedPorts,
    HostConfig: old.HostConfig,
    ...(hcOld !== hcImage && old.Config.Healthcheck ? { Healthcheck: old.Config.Healthcheck } : {}),
  };
  if (mode !== "host" && mode !== "none" && nets.length) opts.NetworkingConfig = { EndpointsConfig: Object.fromEntries(nets.map((n) => [n, {}])) };
  return opts;
}

async function removeIfStopped(docker: Docker, name: string): Promise<void> {
  try {
    const c = docker.getContainer(name);
    const i = await c.inspect();
    if (!i.State.Running) await c.remove({ force: true });
  } catch {
    /* not there */
  }
}

async function waitHealthy(c: Docker.Container, timeoutMs: number): Promise<{ ok: boolean; why: string }> {
  const until = Date.now() + timeoutMs;
  let lastStatus = "starting";
  while (Date.now() < until) {
    const i = await c.inspect();
    if (!i.State.Running) return { ok: false, why: `the new container exited (code ${i.State.ExitCode})` };
    const h = i.State.Health?.Status;
    if (!h) {
      // No health check at all: running for 30 s counts as up.
      if (Date.now() - new Date(i.State.StartedAt).getTime() > 30_000) return { ok: true, why: "running" };
    } else if (h === "healthy") return { ok: true, why: "healthy" };
    else if (h === "unhealthy") return { ok: false, why: "the new container reported unhealthy" };
    lastStatus = h ?? "running";
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { ok: false, why: `the new container was still ${lastStatus} after ${Math.round(timeoutMs / 1000)} s` };
}

export async function swap(docker: Docker, targetId: string, newImage: string, healthTimeoutMs = 180_000): Promise<SwapResult> {
  const old = docker.getContainer(targetId);
  const info = await old.inspect();
  const name = info.Name.replace(/^\//, "");
  if (info.Config.Labels?.["nodewatch.role"] === "updater") throw new Error("refusing to replace an updater container");
  const oldImage = await docker
    .getImage(info.Image)
    .inspect()
    .catch(() => null);
  const from = revisionOf(info.Config.Env) ?? info.Image.slice(7, 19);

  await removeIfStopped(docker, `${name}-next`);
  await removeIfStopped(docker, `${name}-old`);
  const next = await docker.createContainer(cloneOptions(info, oldImage, newImage, `${name}-next`));
  const nextInfo = await next.inspect();
  const to = revisionOf(nextInfo.Config.Env) ?? nextInfo.Image.slice(7, 19);

  const stopT = (info.Config as { StopTimeout?: number }).StopTimeout ?? 30;
  if (info.State.Running) await old.stop({ t: stopT });
  await old.rename({ name: `${name}-old` });
  await next.rename({ name });
  try {
    await next.start();
    const h = await waitHealthy(next, healthTimeoutMs);
    if (h.ok) {
      await old.remove({ force: true });
      return { ok: true, rolledBack: false, message: `updated ${from} → ${to} (${h.why})`, from, to };
    }
    throw new Error(h.why);
  } catch (err) {
    // Put the old container back exactly as it was.
    const why = (err as Error).message;
    await next.stop({ t: 10 }).catch(() => undefined);
    await next.remove({ force: true }).catch(() => undefined);
    await old.rename({ name });
    await old.start();
    return { ok: false, rolledBack: true, message: `update to ${to} failed (${why}); the previous version is running again`, from, to };
  }
}
