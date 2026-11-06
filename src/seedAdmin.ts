import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db";

const admins = [
  // {
  //   email: "sam@longlakeloans.com",
  //   password: "SaH_9jh#kLq-khgvX",
  //   name: "Sam",
  //   role: "reviewer",
  // },
  // {
  //   email: "sophie@longlakeloans.com",
  //   password: "SpH_982#kLq_07aX",
  //   name: "Sophie",
  //   role: "reviewer",
  // },
  // {
  //   email: "max@longlakeloans.com",
  //   password: "Mx_491$pWr_83zQ",
  //   name: "Max",
  //   role: "reviewer",
  // },
  // {
  //   email: "james@longlakeloans.com",
  //   password: "Jms_715#vRt_94kB",
  //   name: "James",
  //   role: "reviewer",
  // },
  // {
  //   email: "jack@longlakeloans.com",
  //   password: "Jck_304$mXy_19pL",
  //   name: "Jack",
  //   role: "reviewer",
  // },
  // {
  //   email: "alex@longlakeloans.com",
  //   password: "Alx_628#zKt_51wN",
  //   name: "Alex",
  //   role: "reviewer",
  // },
  // {
  //   email: "kevin@longlakeloans.com",
  //   password: "Kvn_159$bQr_42sM",
  //   name: "Kevin",
  //   role: "reviewer",
  // },
  // {
  //   email: "angelina@longlakeloans.com",
  //   password: "Ang_837#dLp_60vK",
  //   name: "Angelina",
  //   role: "reviewer",
  // },
  {
    email: "pabitraghara3@gmail.com",
    password: "admin",
    name: "Pabitra",
    role: "admin",
  },
  {
    email: "admin@gmail.com",
    password: "admin!!admin",
    name: "System Admin",
    role: "admin",
  },
  {
    email: "pabitraghara384@gmail.com",
    password: "admin",
    name: "Pabitra",
    role: "reviewer",
  },
  // {
  //   email: "admin@longlakeloans.com",
  //   password: "XhgdjhY_uuye6543",
  //   name: "Administrator",
  //   role: "admin",
  // },
  {
    email: "david@longlakeloans.com",
    password: "XhgdjhY_uuye6543",
    name: "David",
    role: "admin",
  },
] as const;

async function seedAdmins() {
  try {
    console.log("🌱 Starting admin seeder...\n");

    for (const admin of admins) {
      const email = admin.email.trim().toLowerCase();

      console.log(`Checking ${email}...`);

      const existing = await pool.query(
        `
        SELECT id
        FROM admin_users
        WHERE LOWER(email) = $1
        LIMIT 1
        `,
        [email],
      );

      // Hash password
      const passwordHash = await bcrypt.hash(admin.password, 12);

      if (existing.rows.length > 0) {
        // Update existing admin
        await pool.query(
          `
          UPDATE admin_users
          SET
            email = $1,
            password_hash = $2,
            name = $3,
            role = $4,
            is_active = true,
            updated_at = NOW()
          WHERE id = $5
          `,
          [email, passwordHash, admin.name, admin.role, existing.rows[0].id],
        );

        console.log(`✓ Updated ${email}`);
      } else {
        // Create new admin
        await pool.query(
          `
          INSERT INTO admin_users (
            email,
            password_hash,
            name,
            role,
            is_active,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, true, NOW(), NOW())
          `,
          [email, passwordHash, admin.name, admin.role],
        );

        console.log(`✓ Created ${email}`);
      }
    }

    console.log("\n✅ Admin seeding completed successfully!");
  } catch (error) {
    console.error("\n❌ Admin seeding failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedAdmins();
