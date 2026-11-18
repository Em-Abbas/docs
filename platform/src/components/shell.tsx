import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, LogOut, Menu } from "lucide-react";
import { MobileMenu, NavLink } from "@/components/client/widgets";
import { Logo } from "@/components/logo";
import { logoutAction } from "@/lib/actions/auth";
import { formatMoney } from "@/lib/format";
import type { User } from "@/lib/db/schema";

export type NavItem = { href: string; label: string; icon: ReactNode; badge?: number; exact?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

function Sidebar({ siteName, groups, user, home }: { siteName: string; groups: NavGroup[]; user: User; home: string }) {
  return (
    <div className="flex h-full flex-col">
      <Link href={home} className="px-3 py-1">
        <Logo name={siteName} />
      </Link>
      <nav className="mt-6 flex-1 space-y-6">
        {groups.map((g, i) => (
          <div key={i}>
            {g.title && <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted">{g.title}</p>}
            <div className="space-y-0.5">
              {g.items.map((item) => (
                <NavLink key={item.href} href={item.href} badge={item.badge} exact={item.exact}>
                  <span className="[&>svg]:size-4">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold uppercase">
          {user.username.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.username}</p>
          <p className="text-xs capitalize text-muted">{user.role}</p>
        </div>
        <form action={logoutAction}>
          <button className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Log out" title="Log out">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export function Shell({
  siteName,
  groups,
  user,
  unread,
  home,
  announcement,
  children,
}: {
  siteName: string;
  groups: NavGroup[];
  user: User;
  unread: number;
  home: string;
  announcement?: string;
  children: ReactNode;
}) {
  const sidebar = <Sidebar siteName={siteName} groups={groups} user={user} home={home} />;
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-r border-border bg-surface p-4 md:block">{sidebar}</aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur sm:px-6">
          <div className="md:hidden">
            <MobileMenu trigger={<Menu className="size-5" />}>{sidebar}</MobileMenu>
          </div>
          <Link href={home} className="md:hidden">
            <Logo name={siteName} />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/wallet"
              className="tabular rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium hover:bg-subtle"
              title="Available balance"
            >
              {formatMoney(user.balance)}
            </Link>
            <Link href="/notifications" className="relative rounded-full p-2 text-muted hover:bg-subtle hover:text-fg" aria-label="Notifications">
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-fg">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          </div>
        </header>
        {announcement && (
          <div className="border-b border-border bg-accent-soft px-4 py-2 text-center text-sm text-accent sm:px-6">{announcement}</div>
        )}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
