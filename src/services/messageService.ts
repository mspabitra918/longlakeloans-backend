import { query, queryOne } from "../db";

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  ip_address: string;
  is_read: boolean;
  replied_at: string | null;
  created_at: string;
}

export interface ListMessagesOptions {
  page?: number;
  limit?: number;
  search?: string;
}

export async function listMessages(options: ListMessagesOptions): Promise<{
  messages: ContactMessage[];
  total: number;
}> {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const offset = (page - 1) * limit;
  const search = options.search || "";

  let whereClause = "";
  const params: any[] = [];

  if (search) {
    whereClause = "WHERE name ILIKE $1 OR email ILIKE $1 OR subject ILIKE $1 OR message ILIKE $1";
    params.push(`%${search}%`);
  }

  const countParams = [...params];
  const totalResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) FROM contact_messages ${whereClause}`,
    countParams,
  );
  const total = parseInt(totalResult?.count || "0", 10);

  const queryParams = [...params, limit, offset];
  const messages = await query<ContactMessage>(
    `SELECT * FROM contact_messages
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    queryParams,
  );

  return { messages, total };
}
