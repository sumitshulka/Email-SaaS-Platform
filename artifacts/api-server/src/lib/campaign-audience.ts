export interface CampaignAudienceMember {
  listId: string;
  email: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  createdAt?: Date;
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function summarizeCampaignAudience(
  memberships: readonly CampaignAudienceMember[],
  orderedListIds: readonly string[],
): { uniqueRecipients: number; overlappingRecipients: number } {
  const selectedListIds = new Set(orderedListIds);
  const listsByEmail = new Map<string, Set<string>>();

  for (const membership of memberships) {
    if (!selectedListIds.has(membership.listId)) continue;
    const email = normalizedEmail(membership.email);
    if (!email) continue;
    const lists = listsByEmail.get(email) ?? new Set<string>();
    lists.add(membership.listId);
    listsByEmail.set(email, lists);
  }

  return {
    uniqueRecipients: listsByEmail.size,
    overlappingRecipients: [...listsByEmail.values()].filter(
      (lists) => lists.size > 1,
    ).length,
  };
}

export function uniqueCampaignRecipients<T extends CampaignAudienceMember>(
  memberships: readonly T[],
  orderedListIds: readonly string[],
): T[] {
  const listPriority = new Map(
    orderedListIds.map((listId, index) => [listId, index]),
  );
  const seenEmails = new Set<string>();

  return [...memberships]
    .filter((membership) => listPriority.has(membership.listId))
    .sort((left, right) => {
      const listOrder =
        listPriority.get(left.listId)! - listPriority.get(right.listId)!;
      if (listOrder !== 0) return listOrder;
      const createdAt =
        (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
      if (createdAt !== 0) return createdAt;
      return (left.id ?? "").localeCompare(right.id ?? "");
    })
    .filter((membership) => {
      const email = normalizedEmail(membership.email);
      if (!email || seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    });
}
