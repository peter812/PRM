import { pool } from "../server/db";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Starting custom database migration...");
  const sqlFile = path.resolve("./migrations/0001_little_colonel_america.sql");
  if (!fs.existsSync(sqlFile)) {
    console.error("Migration file not found:", sqlFile);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlFile, "utf-8");
  
  // Split by the statement-breakpoint comment
  const statements = sqlContent.split("--> statement-breakpoint");
  
  console.log(`Found ${statements.length} SQL statements to execute.`);
  
  const client = await pool.connect();
  try {
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (!statement) continue;
      
      console.log(`[Step ${i+1}/${statements.length}] Executing: ${statement.substring(0, 80).replace(/\r?\n/g, " ")}...`);
      try {
        await client.query(statement);
        console.log("  ✓ Success");
      } catch (err: any) {
        // Ignore errors for already existing relation/column/constraint
        // 42P07: duplicate_table
        // 42701: duplicate_column
        // 42710: duplicate_object (constraint)
        if (err.code === "42P07" || err.code === "42701" || err.code === "42710") {
          console.log(`  ⚠ Ignored: ${err.message}`);
        } else {
          console.error(`  ✗ Failed: ${err.message}`);
          throw err;
        }
      }
    }
    console.log("✓ Custom database migration finished successfully!");
  } catch (error) {
    console.error("✗ Migration process failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
