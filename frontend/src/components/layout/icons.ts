import {
  BadgeIndianRupee, Book, Building2, Calendar, CalendarCheck, Circle, Coins, Database, FileText, Gavel, Home,
  IdCard, LayoutDashboard, MapPin, PiggyBank, PlayCircle, Receipt, Settings, Shield, SlidersHorizontal,
  TrendingUp, User, Users, Wallet, type LucideIcon,
} from 'lucide-react';

/** Maps core.menu_* icon names to Lucide icons (TNCU used Open Iconic). */
const map: Record<string, LucideIcon> = {
  home: Home, settings: Settings, users: Users, wallet: Wallet, 'piggy-bank': PiggyBank, user: User,
  'layout-dashboard': LayoutDashboard, shield: Shield, building: Building2, 'map-pin': MapPin, calendar: Calendar,
  sliders: SlidersHorizontal, database: Database, 'id-card': IdCard, 'calendar-check': CalendarCheck,
  'trending-up': TrendingUp, gavel: Gavel, 'file-text': FileText, 'play-circle': PlayCircle, coins: Coins,
  book: Book, receipt: Receipt, rupee: BadgeIndianRupee,
};

export const iconFor = (name: string | null | undefined): LucideIcon => (name && map[name]) || Circle;
