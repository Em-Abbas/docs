import { desc, eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Badge, Card, CardHeader, LinkButton, StatusBadge, Table, cn, inputClass, td, th } from "@/components/ui";
import { uploadCsvAction } from "@/lib/actions/catalog";
import { db } from "@/lib/db";
import { uploadBatches, users, type ProductField } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { FIELD_TYPE_LABELS } from "@/lib/inventory";

export async function UploadsTab({ productId, fields }: { productId: number; fields: ProductField[] }) {
  const active = fields.filter((f) => f.enabled);
  const batches = await db
    .select({ b: uploadBatches, uploader: users.username })
    .from(uploadBatches)
    .leftJoin(users, eq(users.id, uploadBatches.uploaderId))
    .where(eq(uploadBatches.productId, productId))
    .orderBy(desc(uploadBatches.createdAt))
    .limit(30);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="1. Download the template"
            description="A CSV with one column per field. Row 2 explains each column and is ignored on upload."
            action={
              <LinkButton href={`/admin/products/${productId}/template`} variant="secondary" size="sm" prefetch={false}>
                <Download className="size-3.5" /> CSV template
              </LinkButton>
            }
          />
          <Table>
            <thead>
              <tr>
                <th className={th}>Column</th>
                <th className={th}>Type</th>
                <th className={th}>Shoppers see</th>
              </tr>
            </thead>
            <tbody>
              {active.map((f) => (
                <tr key={f.key}>
                  <td className={td}>
                    <span className="font-medium">{f.label}</span>
                    <span className="ml-1.5 font-mono text-xs text-muted">{f.key}</span>
                    {f.required && <Badge className="ml-2">required</Badge>}
                  </td>
                  <td className={`${td} text-muted`}>{FIELD_TYPE_LABELS[f.type]}</td>
                  <td className={td}>
                    <Badge tone={f.visibility === "public" ? "green" : f.visibility === "masked" ? "amber" : "neutral"}>{f.visibility}</Badge>
                  </td>
                </tr>
              ))}
              <tr>
                <td className={td}>
                  <span className="font-medium">Price</span> <span className="text-xs text-muted">optional</span>
                </td>
                <td className={`${td} text-muted`} colSpan={2}>
                  Per-row price override, e.g. 9.99
                </td>
              </tr>
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="2. Upload your data" description="Up to 50,000 rows / 25 MB per file. Exact duplicates are skipped automatically." />
          <ActionForm action={uploadCsvAction} resetOnSuccess className="space-y-4 p-5">
            <input type="hidden" name="id" value={productId} />
            <input name="file" type="file" accept=".csv,text/csv" required className={cn(inputClass, "w-full py-2")} />
            <ul className="space-y-1 text-xs text-muted">
              <li>• Headers must match the field labels (or column letters A–J).</li>
              <li>• Rows starting with # are ignored.</li>
              <li>• Invalid rows are rejected individually — the rest are imported.</li>
            </ul>
            <SubmitButton pendingText="Importing…">Upload and import</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card>
        <CardHeader title="Upload history" />
        <Table>
          <thead>
            <tr>
              <th className={th}>File</th>
              <th className={th}>By</th>
              <th className={th}>Rows</th>
              <th className={th}>Added</th>
              <th className={th}>Duplicates</th>
              <th className={th}>Rejected</th>
              <th className={th}>Status</th>
              <th className={th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {batches.map(({ b, uploader }) => (
              <tr key={b.id} className="align-top">
                <td className={td}>
                  <span className="font-medium">{b.filename}</span>
                  {b.errors.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-red-600">Show rejected rows</summary>
                      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs text-muted">
                        {b.errors.map((e, i) => (
                          <li key={i}>
                            <span className="font-mono">Row {e.row}:</span> {e.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className={`${td} text-muted`}>
                  {uploader}
                  {b.isReseller && <Badge className="ml-1.5">reseller</Badge>}
                </td>
                <td className={`${td} tabular`}>{b.totalRows}</td>
                <td className={`${td} tabular text-emerald-600`}>{b.acceptedRows}</td>
                <td className={`${td} tabular text-muted`}>{b.duplicateRows}</td>
                <td className={`${td} tabular ${b.rejectedRows ? "text-red-600" : "text-muted"}`}>{b.rejectedRows}</td>
                <td className={td}>
                  <StatusBadge status={b.status} />
                </td>
                <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(b.createdAt)}</td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td className={`${td} text-center text-muted`} colSpan={8}>
                  No uploads yet.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
