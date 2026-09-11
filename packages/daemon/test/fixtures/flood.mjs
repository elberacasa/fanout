import process from "node:process";

for (let i = 0; i < 100; i += 1) {
  process.stdout.write(`line ${i}\n`);
}
process.stderr.write("after log cap\n");
