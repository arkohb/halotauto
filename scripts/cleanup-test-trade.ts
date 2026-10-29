import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const t = await p.trade.deleteMany({ where: { entry: 4100, sl: 0, tp: 0, status: "OPEN", symbol: "XAUUSD" } });
console.log("deleted:", t.count);
await p.$disconnect();
