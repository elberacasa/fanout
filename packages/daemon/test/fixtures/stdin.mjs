import process from "node:process";

let bytes = 0;
process.stdin.on("data", (chunk) => {
  bytes += chunk.length;
});
process.stdin.on("end", () => {
  process.stdout.write(`EOF:${bytes}\n`);
});
process.stdin.resume();
