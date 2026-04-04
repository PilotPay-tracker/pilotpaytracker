'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Plane,
  DollarSign,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Menu,
  X,
} from 'lucide-react'
import { authClient } from '@/lib/auth'
import { useProfile } from '@/lib/hooks'
import { cn } from '@/lib/cn'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/trips', label: 'Trips', icon: Plane },
  { href: '/pay-summary', label: 'Pay Summary', icon: DollarSign },
  { href: '/career', label: 'Career', icon: TrendingUp },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const PAGE_META: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/trips': 'Trips',
  '/pay-summary': 'Pay Summary',
  '/career': 'Career',
  '/settings': 'Settings',
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  collapsed,
  onClick,
}: {
  href: string
  label: string
  icon: typeof LayoutDashboard
  collapsed: boolean
  onClick?: () => void
}) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-150',
        collapsed ? 'justify-center' : '',
        isActive
          ? 'bg-blue-600/15 text-blue-400'
          : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] active:bg-white/[0.08]'
      )}
    >
      <Icon
        size={19}
        strokeWidth={isActive ? 2 : 1.75}
        className="flex-shrink-0"
      />
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}

interface SidebarContentProps {
  collapsed: boolean
  isMobile: boolean
  onClose?: () => void
  onToggleCollapse?: () => void
  onSignOut: () => void
  profile: {
    firstName?: string | null
    lastName?: string | null
    position?: string | null
    base?: string | null
    airline?: string | null
  } | null | undefined
  initials: string
}

function SidebarContent({
  collapsed,
  isMobile,
  onClose,
  onToggleCollapse,
  onSignOut,
  profile,
  initials,
}: SidebarContentProps) {
  const isCollapsed = collapsed && !isMobile

  return (
    <>
      {/* Logo */}
      <div
        className={cn(
          'flex items-center h-14 border-b border-white/[0.05] flex-shrink-0',
          isCollapsed ? 'justify-center px-0' : 'gap-3 px-4'
        )}
      >
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-900/40 text-sm">
          ✈️
        </div>
        {!isCollapsed && (
          <span className="text-white font-bold text-[15px] tracking-tight flex-1">
            Pilot Pay Tracker
          </span>
        )}
        {isMobile && onClose && (
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2.5 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <SidebarLink
            key={item.href}
            {...item}
            collapsed={isCollapsed}
            onClick={isMobile ? onClose : undefined}
          />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="px-2.5 pb-4 space-y-1 border-t border-white/[0.05] pt-3">
        {/* User card */}
        <div
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2 rounded-lg',
            isCollapsed && 'justify-center px-0'
          )}
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white uppercase shadow-sm">
            {initials || '?'}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-slate-200 truncate leading-tight">
                {profile?.firstName} {profile?.lastName}
              </p>
              <p className="text-[11px] text-slate-500 truncate leading-tight">
                {profile?.position ?? ''} · {profile?.base ?? ''}
              </p>
            </div>
          )}
        </div>

        {/* Sign Out */}
        <button
          onClick={onSignOut}
          title={isCollapsed ? 'Sign Out' : undefined}
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10 active:bg-red-500/15 transition-colors w-full',
            isCollapsed && 'justify-center'
          )}
        >
          <LogOut size={16} className="flex-shrink-0" />
          {!isCollapsed && <span>Sign Out</span>}
        </button>

        {/* Collapse toggle - desktop only */}
        {!isMobile && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-400 hover:bg-white/[0.04] transition-colors w-full',
              isCollapsed && 'justify-center'
            )}
          >
            {isCollapsed ? (
              <ChevronRight size={15} />
            ) : (
              <>
                <ChevronLeft size={15} />
                <span>Collapse</span>
              </>
            )}
          </button>
        )}
      </div>
    </>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data: profileData } = useProfile()
  const profile = profileData?.profile
  const router = useRouter()
  const pathname = usePathname()

  // Auto-close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const handleSignOut = async () => {
    await authClient.signOut()
    router.push('/login')
  }

  const initials =
    (profile?.firstName?.[0] ?? '') + (profile?.lastName?.[0] ?? '')

  const currentPageTitle = PAGE_META[pathname] ?? 'Pilot Pay Tracker'

  const sidebarProps: SidebarContentProps = {
    collapsed,
    isMobile: false,
    onToggleCollapse: () => setCollapsed(!collapsed),
    onSignOut: handleSignOut,
    profile,
    initials,
  }

  return (
    <div className="flex h-screen bg-[#060b17] overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r border-white/[0.05] bg-[#080d19] transition-all duration-200 flex-shrink-0',
          collapsed ? 'w-[68px]' : 'w-[220px]'
        )}
      >
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* Mobile Backdrop */}
      <div
        className={cn(
          'lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile Drawer */}
      <aside
        className={cn(
          'lg:hidden fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col border-r border-white/[0.05] bg-[#080d19] transition-transform duration-200 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Navigation"
      >
        <SidebarContent
          {...sidebarProps}
          isMobile={true}
          onClose={() => setMobileOpen(false)}
        />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex-shrink-0 h-14 border-b border-white/[0.05] flex items-center px-4 lg:px-6 gap-3 bg-[#080d19]/80 backdrop-blur-sm">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          <h1 className="text-[15px] font-semibold text-white tracking-tight">
            {currentPageTitle}
          </h1>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            {profile && (
              <span className="text-xs text-slate-500 hidden sm:block">
                {profile.airline ?? 'UPS'} ·{' '}
                <span
                  className={
                    profile.position === 'CPT' ? 'text-amber-400' : 'text-blue-400'
                  }
                >
                  {profile.position ?? 'FO'}
                </span>{' '}
                · {profile.base ?? '—'}
              </span>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto overscroll-contain">
          {children}
        </main>
      </div>
    </div>
  )
}
