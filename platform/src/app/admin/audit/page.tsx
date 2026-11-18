import { desc, eq } from "drizzle-orm";
import { Badge, Card, PageHeader, Pagination, Table, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Audit log" };
const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const rows = await db
    .select({ a: auditLogs, actor: users.username })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .orderBy(desc(auditLogs.id))
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE);
  const hasNext = rows.length > PAGE;

  return (
    <>
      <PageHeader title="Audit log" description="Every admin action and sensitive account change." />
      <Card>
        <Table>
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Who</th>
              <th className={th}>Action</th>
              <th className={th}>Target</th>
              <th className={th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, PAGE).map(({ a, actor }) => (
              <tr key={a.id}>
                <td className={`${td} whitespace-nowrap text-xs text-muted`}>{formatDate(a.createdAt)}</td>
                <td className={td}>{actor ?? "system"}</td>
                <td className={td}>
                  <Badge>{a.action}</Badge>
                </td>
                <td className={`${td} text-xs text-muted`}>{a.entity ? `${a.entity} ${a.entityId ?? ""}` : "—"}</td>
                <td className={`${td} max-w-md truncate font-mono text-xs text-muted`} title={a.meta ? JSON.stringify(a.meta) : ""}>
                  {a.meta ? JSON.stringify(a.meta) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={page} pages={hasNext ? page + 1 : page} href={(p) => `/admin/audit?page=${p}`} />
      </Card>
    </>
  );
}
