import Link from "next/link";
import { and, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { AutoSubmit } from "@/components/client/widgets";
import { Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Users" };
const PAGE = 50;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: SQL[] = [];
  if (sp.q) where.push(ilike(users.username, `%${sp.q}%`));
  if (sp.role && ["user", "reseller", "admin"].includes(sp.role)) where.push(eq(users.role, sp.role as "user"));
  if (sp.status && ["active", "banned", "pending_setup"].includes(sp.status)) where.push(eq(users.status, sp.status as "active"));
  const cond = where.length ? and(...where) : undefined;

  const [rows, [{ total, balances, frozen }]] = await Promise.all([
    db.select().from(users).where(cond).orderBy(desc(users.createdAt)).limit(PAGE).offset((page - 1) * PAGE),
    db
      .select({ total: sql<number>`count(*)::int`, balances: sql<number>`coalesce(sum(${users.balance}),0)::bigint`, frozen: sql<number>`coalesce(sum(${users.frozen}),0)::bigint` })
      .from(users)
      .where(cond),
  ]);

  return (
    <>
      <PageHeader
        title="Users"
        description={`${total.toLocaleString()} accounts · ${formatMoney(Number(balances))} in balances · ${formatMoney(Number(frozen))} frozen`}
      />
      <AutoSubmit action="/admin/users" className="mb-4 flex flex-wrap gap-2">
        <Input name="q" type="search" defaultValue={sp.q} placeholder="Search username…" className="w-64" />
        <Select name="role" defaultValue={sp.role ?? ""} className="w-auto">
          <option value="">All roles</option>
          <option value="user">Users</option>
          <option value="reseller">Resellers</option>
          <option value="admin">Admins</option>
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="w-auto">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="banned">Banned</option>
          <option value="pending_setup">Setup incomplete</option>
        </Select>
      </AutoSubmit>
      {rows.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>User</th>
                <th className={th}>Status</th>
                <th className={th}>Balance</th>
                <th className={th}>Frozen</th>
                <th className={th}>Spent</th>
                <th className={th}>2FA</th>
                <th className={th}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-subtle/50">
                  <td className={td}>
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                      {u.username}
                    </Link>
                    {u.role !== "user" && (
                      <Badge tone={u.role === "admin" ? "accent" : "blue"} className="ml-2">
                        {u.role}
                      </Badge>
                    )}
                  </td>
                  <td className={td}>
                    <StatusBadge status={u.status} />
                  </td>
                  <td className={`${td} tabular`}>{formatMoney(u.balance)}</td>
                  <td className={`${td} tabular text-muted`}>{u.frozen ? formatMoney(u.frozen) : "—"}</td>
                  <td className={`${td} tabular text-muted`}>{formatMoney(u.totalSpent)}</td>
                  <td className={td}>{u.totpEnabled ? <Badge tone="green">on</Badge> : <Badge>off</Badge>}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(u.createdAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pages={Math.ceil(total / PAGE)} href={(p) => `/admin/users?${new URLSearchParams({ ...sp, page: String(p) } as Record<string, string>)}`} />
        </Card>
      )}
    </>
  );
}
