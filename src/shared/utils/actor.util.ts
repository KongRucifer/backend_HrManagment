import { PrismaService } from '../../prisma/prisma.service';

/** Minimal reference to the user who authored a row (for display). */
export interface ActorRef {
  id: string;
  username: string | null;
  email: string;
}

type WithActorIds = {
  createdById?: string | null;
  updatedById?: string | null;
};

/**
 * Resolves the created_by / updated_by user ids on a set of rows into
 * `{ createdBy, updatedBy }` objects carrying the username, in a single batched
 * query. Used by the admin list endpoints so tables can show "who created it".
 */
export async function attachActors<T extends WithActorIds>(
  prisma: PrismaService,
  rows: T[],
): Promise<(T & { createdBy: ActorRef | null; updatedBy: ActorRef | null })[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.createdById) ids.add(r.createdById);
    if (r.updatedById) ids.add(r.updatedById);
  }

  const users = ids.size
    ? await prisma.user.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, username: true, email: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const ref = (id?: string | null): ActorRef | null =>
    id ? (byId.get(id) ?? null) : null;

  return rows.map((r) => ({
    ...r,
    createdBy: ref(r.createdById),
    updatedBy: ref(r.updatedById),
  }));
}
