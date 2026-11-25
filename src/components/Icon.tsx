import {
  Activity, ArrowUpRight, BarChart3, BookOpen, Box, Briefcase, ChartNoAxesCombined, Check, CheckCircle2,
  ClipboardCheck, CloudSun, Code2, Compass, Database, Feather, FlaskConical, FolderKanban, GraduationCap,
  Layers, LayoutGrid, LifeBuoy, Link2, type LucideIcon, MessageSquareText, MessagesSquare, Package,
  PenTool, Plug, Puzzle, Rocket, Search, ShieldCheck, Sparkles, Store, Telescope, TrendingUp, Users,
  WandSparkles, Workflow, Wrench, X, Zap,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  'arrow-up-right': ArrowUpRight,
  'bar-chart': BarChart3,
  'book-open': BookOpen,
  box: Box,
  briefcase: Briefcase,
  'chart-no-axes-combined': ChartNoAxesCombined,
  check: Check,
  'check-circle': CheckCircle2,
  'clipboard-check': ClipboardCheck,
  'cloud-sun': CloudSun,
  code: Code2,
  compass: Compass,
  database: Database,
  feather: Feather,
  'flask-conical': FlaskConical,
  'folder-kanban': FolderKanban,
  'graduation-cap': GraduationCap,
  layers: Layers,
  'layout-grid': LayoutGrid,
  'life-buoy': LifeBuoy,
  link: Link2,
  'message-square': MessageSquareText,
  'messages-square': MessagesSquare,
  package: Package,
  'pen-tool': PenTool,
  plug: Plug,
  puzzle: Puzzle,
  rocket: Rocket,
  search: Search,
  'shield-check': ShieldCheck,
  sparkles: Sparkles,
  store: Store,
  telescope: Telescope,
  'trending-up': TrendingUp,
  users: Users,
  'wand-sparkles': WandSparkles,
  workflow: Workflow,
  wrench: Wrench,
  x: X,
  zap: Zap,
};

export function Icon({ name, size = 16, strokeWidth = 1.8, className }: { name?: string; size?: number; strokeWidth?: number; className?: string }) {
  const Component = (name && ICONS[name]) || Sparkles;
  return <Component size={size} strokeWidth={strokeWidth} className={className} />;
}

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="17" r="9.5" stroke="currentColor" strokeWidth="2.4" opacity="0.9" />
      <circle cx="25" cy="9" r="3.8" fill="currentColor" />
      <circle cx="16" cy="17" r="2.2" fill="currentColor" opacity="0.65" />
    </svg>
  );
}
