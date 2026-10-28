const envText = await Bun.file("/home/z/my-project/.env").text();
const line = envText.split("\n").find((l) => l.startsWith("METAAPI_TOKEN")) ?? "";
const t = line.slice("METAAPI_TOKEN=".length).trim();

const parts = t.split(".");
console.log("segments:", parts.map((x) => x.length).join("/"), "total:", t.length);
for (let i = 0; i < parts.length; i++) {
  console.log(`seg${i} head: ${parts[i].slice(0, 48)}`);
  console.log(`seg${i} tail: ${parts[i].slice(-48)}`);
}
const dec = (b: string) => Buffer.from(b.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
for (let i = 0; i < 2; i++) {
  const s = dec(parts[i]);
  console.log(`seg${i} decoded first 120:`, JSON.stringify(s.slice(0, 120)));
}
