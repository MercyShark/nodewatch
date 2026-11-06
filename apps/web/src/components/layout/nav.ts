import {
  Activity,
  Bell,
  Boxes,
  Coins,
  Cpu,
  Gauge,
  HardDriveDownload,
  Link2,
  Network,
  Radio,
  Settings,
  Timer,
  Vault,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { to: "/", label: "Overview", icon: Gauge },
      { to: "/queries", label: "Live queries", icon: Radio },
      { to: "/resources", label: "Resources", icon: Cpu },
      { to: "/chain", label: "Chain", icon: Link2 },
      { to: "/pool", label: "Pool & earnings", icon: Coins },
      { to: "/rpc", label: "RPC traffic", icon: Activity },
      { to: "/fleet", label: "Fleet", icon: Network },
    ],
  },
  {
    label: "Operate",
    items: [
      { to: "/slow-queries", label: "Slow queries", icon: Timer, adminOnly: true },
      { to: "/alerts", label: "Alerts", icon: Bell },
      { to: "/backups", label: "Backups", icon: HardDriveDownload, adminOnly: true },
      { to: "/vault", label: "Swarm vault", icon: Vault, adminOnly: true },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings & about", icon: Settings }],
  },
];

export const ALL_NAV = NAV.flatMap((g) => g.items);
export const LogoIcon = Boxes;
