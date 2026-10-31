// Remove the UI probe user created by probe-ui-bootstrap.ts.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const db = new PrismaClient();
const email = readFileSync("/tmp/probe_ui_email.txt", "utf8").trim();
const user = await db.user.findUnique({ where: { email } });
if (user) {
  await db.license.deleteMany({ where: { userId: user.id } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.traderProfile.deleteMany({ where: { id: user.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log("cleanup ok:", email);
} else {
  console.log("nothing to clean");
}
await db.$disconnect();
