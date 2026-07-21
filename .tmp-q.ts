import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const customers = await sql`
  select c.phone, c.first_name from customers c
  join users u on u.id = c.user_id
  join services s on s.customer_id = c.id and s.status = 'active'
  where u.status = 'active' limit 3`;
console.log(JSON.stringify(customers));
await sql.end();
