import { Status, type StatusWord } from "./Status";

const NODES: { name: string; network: string; lag: string; peers: string; sync: string; status: StatusWord }[] = [
  { name: "mumbai-01", network: "Arkiv Rabdi", lag: "0", peers: "38", sync: "synced", status: "Up" },
  { name: "mumbai-02", network: "Arkiv Rabdi", lag: "1", peers: "41", sync: "synced", status: "Up" },
  { name: "fra-01", network: "Arkiv Rabdi", lag: "14", peers: "9", sync: "catching up", status: "Slow" },
  { name: "sgp-01", network: "Arkiv Rabdi", lag: "—", peers: "0", sync: "stopped", status: "Down" },
];

const HEAD = ["Node", "Network", "Head lag", "Peers", "Sync", "Status"];

/** The nodes an operator runs. A table at desktop width, one card per node on a phone, the status always a word. */
export function Matrix() {
  return (
    <div className="r-one border border-soft bg-paper">
      <table className="matrix w-full text-left text-[15px]">
        <caption className="sr-only">Nodes watched, with head lag, peers, sync state and status</caption>
        <thead>
          <tr className="border-b border-soft text-xs tracking-[0.08em] text-ink/70">
            {HEAD.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-medium sm:px-5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NODES.map((n) => (
            <tr key={n.name} className="border-b border-soft/60 last:border-b-0">
              <td data-label="Node" className="name px-4 py-3 sm:px-5">
                <span className="font-mono text-ink">{n.name}</span>
              </td>
              <td data-label="Network" className="px-4 py-3 text-ink/80 sm:px-5">{n.network}</td>
              <td data-label="Head lag" className="px-4 py-3 sm:px-5">
                <span>
                  <span className="font-mono">{n.lag}</span>
                  {n.lag !== "—" ? <span className="text-ink/60">{n.lag === "1" ? " block" : " blocks"}</span> : null}
                </span>
              </td>
              <td data-label="Peers" className="px-4 py-3 sm:px-5">
                <span className="font-mono">{n.peers}</span>
              </td>
              <td data-label="Sync" className="px-4 py-3 text-ink/80 sm:px-5">{n.sync}</td>
              <td data-label="Status" className="px-4 py-3 sm:px-5">
                <Status value={n.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
